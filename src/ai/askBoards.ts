import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { useStore } from '../model/store';
import type { ZElement } from '../model/types';
import { Anthropic, claude } from './client';
import { boardForModel, boardTree, hitLine, readElement, searchBoards } from './boardText';
import { AiError, baseParams, recordSpend, refusalMessage, toAiError, type AiAnswer, type AiHooks } from './run';
import { costOf, type Usage } from './settings';

/**
 * "Ask the boards": Claude answers a question about everything on the boards.
 * It does not get the boards wholesale; it looks through them with tools
 * (search, the outline of boards, one board, one card), so only what it reads
 * is sent, and the answer points at the cards it used as [[id]].
 */

export const ASK_SYSTEM = [
  'Ты помощник в приложении Zadum: это доски одного человека с заметками, сценариями, таблицами, задачами, ссылками и картинками. Ты отвечаешь на его вопросы по содержимому досок.',
  'Сначала найди нужное инструментами:',
  '- search_cards — поиск карточек по словам; пробуй несколько формулировок и синонимов, если первая ничего не дала;',
  '- list_boards — дерево всех досок с их id;',
  '- read_board — карточки одной доски;',
  '- read_card — полный текст карточки (сценария, документа, таблицы).',
  'Отвечай только по тому, что нашёл. Если на досках этого нет — так и скажи, не додумывай.',
  'После каждого утверждения укажи источник в виде [[id]], где id — идентификатор карточки или доски из результатов инструментов, ровно как он там написан.',
  'Отвечай кратко и по делу, на языке вопроса, в Markdown. Не описывай, как ты искал.',
].join('\n');

export interface Turn {
  question: string;
  answer: string;
}

type Elements = Record<string, ZElement>;

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** The tools, as functions of the boards (also what the tests call). */
export function boardTools(elements: () => Elements, onStatus: (status: string) => void = () => {}) {
  return {
    search_cards: (input: { query?: unknown }) => {
      const query = text(input.query, 200);
      if (!query) return 'Пустой запрос.';
      onStatus(`Ищу: «${query}»`);
      const hits = searchBoards(elements(), query, 20);
      if (!hits.length) return `По запросу «${query}» ничего не найдено. Попробуй другие слова.`;
      return hits.map((h) => hitLine(elements(), h, query)).join('\n');
    },
    list_boards: () => {
      onStatus('Смотрю список досок');
      return boardTree(elements());
    },
    read_board: (input: { board_id?: unknown }) => {
      const id = text(input.board_id, 80);
      const board = elements()[id];
      if (board?.type !== 'BOARD') return `Доски с id «${id}» нет. Возьми id из list_boards или из результатов поиска.`;
      onStatus(`Читаю доску «${board.title}»`);
      return boardForModel(elements(), id).slice(0, 24000);
    },
    read_card: (input: { card_id?: unknown }) => {
      const id = text(input.card_id, 80);
      const body = readElement(elements(), id);
      if (!body) return `Карточки с id «${id}» нет. Возьми id из результатов поиска или read_board.`;
      onStatus('Читаю карточку');
      return body;
    },
  };
}

const idSchema = (name: string, description: string) => ({ type: 'object', properties: { [name]: { type: 'string', description } }, required: [name], additionalProperties: false }) as const;

export async function askBoards(question: string, history: Turn[], hooks: AiHooks & { onStatus?: (status: string) => void } = {}): Promise<AiAnswer<null>> {
  const run = boardTools(() => useStore.getState().elements, hooks.onStatus);
  const tools = [
    betaTool({ name: 'search_cards', description: 'Ищет карточки на всех досках по словам запроса (в любой форме слова). Возвращает до 20 карточек: id, вид, доска и фрагмент текста.', inputSchema: idSchema('query', 'Слова для поиска, 1–5 слов'), run: (input) => run.search_cards(input) }),
    betaTool({ name: 'list_boards', description: 'Дерево всех досок: id, название и число карточек на каждой.', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, run: () => run.list_boards() }),
    betaTool({ name: 'read_board', description: 'Карточки одной доски в порядке чтения, с их id и началом текста.', inputSchema: idSchema('board_id', 'id доски'), run: (input) => run.read_board(input) }),
    betaTool({ name: 'read_card', description: 'Полный текст одной карточки: заметки, документа, сценария, таблицы, списка задач.', inputSchema: idSchema('card_id', 'id карточки'), run: (input) => run.read_card(input) }),
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [...history.flatMap((t) => [{ role: 'user' as const, content: t.question }, { role: 'assistant' as const, content: t.answer }]), { role: 'user', content: question }];
  const { effort, ...base } = baseParams();
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } satisfies Usage;
  let cost = 0;
  let usedFallback = false;
  let last: Anthropic.Beta.BetaMessage | null = null;
  try {
    const runner = claude.beta.messages.toolRunner(
      {
        ...base,
        max_tokens: 16000,
        system: [{ type: 'text', text: ASK_SYSTEM }],
        tools,
        messages,
        output_config: { effort },
        // The growing conversation is cached, so each look through the boards re-reads the earlier ones cheaply.
        cache_control: { type: 'ephemeral' },
        stream: true,
        max_iterations: 14,
        // The full history goes with every turn: no conversation is kept on the provider's side.
        thread: false,
      },
      { signal: hooks.signal },
    );
    for await (const stream of runner) {
      if (hooks.onText) stream.on('text', (_delta, snapshot) => hooks.onText!(snapshot));
      if (hooks.onThinking) stream.on('thinking', (_delta, snapshot) => hooks.onThinking!(snapshot));
      const message = await stream.finalMessage();
      last = message;
      usage.input_tokens += message.usage.input_tokens;
      usage.output_tokens += message.usage.output_tokens;
      usage.cache_creation_input_tokens += message.usage.cache_creation_input_tokens ?? 0;
      usage.cache_read_input_tokens += message.usage.cache_read_input_tokens ?? 0;
      const spent = costOf(message.model, message.usage);
      cost += spent;
      recordSpend(spent);
      usedFallback ||= (message.usage.iterations ?? []).some((entry) => entry.type === 'fallback_message');
      if (message.stop_reason === 'refusal') throw new AiError('refusal', refusalMessage(message.stop_details?.category));
      // A tool call cut off by the length limit must not run.
      if (message.stop_reason === 'max_tokens' && message.content.some((b) => b.type === 'tool_use')) throw new AiError('too-long', 'Ответ не поместился. Задайте вопрос уже.');
      if (message.stop_reason === 'tool_use') hooks.onText?.('');
    }
  } catch (error) {
    throw toAiError(error);
  }
  if (!last) throw new AiError('other', 'Модель не ответила. Повторите вопрос.');
  const answer = last.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  if (last.stop_reason === 'tool_use' || !answer) throw new AiError('other', 'Модель искала слишком долго и не дошла до ответа. Задайте вопрос точнее.');
  return { text: answer, data: null, model: last.model, usage, cost, usedFallback, truncated: last.stop_reason === 'max_tokens' };
}
