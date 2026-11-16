import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZElement } from '../model/types';
import { __resetForTests, useStore } from '../model/store';
import { textToDoc } from '../model/text';
import { askBoards, boardTools } from './askBoards';
import { ARRANGE_SCHEMA, IMAGE_SCHEMA, LABELS_SCHEMA, TASKS_SCHEMA, checkGroups, checkImageNote, checkLabels, checkTasks, imageSearchText } from './boardPrompts';
import { boardForModel, boardTree, readElement, searchBoards, withCardLinks } from './boardText';
import { fitSide } from './images';
import { setAiSettings } from './settings';
import { fakeStream, type FakeAnswer } from './testing';

const base = (id: string, type: string, parentId: string | null, x = 0, y = 0, extra: object = {}) => ({ id, type, parentId, section: 'CANVAS', x, y, z: 1, width: 20, createdAt: 0, updatedAt: 0, ...extra }) as unknown as ZElement;
const note = (id: string, parentId: string, text: string, x = 0, y = 0, extra: object = {}) => base(id, 'CARD', parentId, x, y, { content: textToDoc(text), color: 'default', ...extra });

const ELEMENTS: Record<string, ZElement> = Object.fromEntries(
  [
    base('home', 'BOARD', null, 0, 0, { title: 'Главная', color: 'blue' }),
    base('proj', 'BOARD', 'home', 0, 0, { title: 'Ролик про маяк', color: 'green' }),
    base('refs', 'BOARD', 'proj', 30, 0, { title: 'Референсы', color: 'pink' }),
    note('n1', 'proj', 'Свет для ночных сцен: тёплый практический свет, лампы накаливания', 0, 0, { labels: ['lab1'] }),
    note('n2', 'proj', 'Позвонить оператору насчёт крана', 0, 10),
    base('col', 'COLUMN', 'proj', 40, 0, { title: 'Идеи', collapsed: false }),
    note('n3', 'col', 'Финал: маяк гаснет на рассвете', 0, 0),
    note('n4', 'refs', 'Референсы по свету: «Маяк» Эггерса, ночные сцены при керосиновой лампе'),
    base('img', 'IMAGE', 'refs', 0, 20, { media: { id: 'm', ext: 'jpg' }, name: 'IMG_1.jpg', caption: '', showCaption: false, naturalWidth: 10, naturalHeight: 10, aiText: 'Керосиновая лампа на столе, ночь\nSHIP LOG 1890' }),
    note('gone', 'proj', 'Свет в корзине', 0, 30, { section: 'TRASH' }),
    base('lab1', 'LABEL', null, 0, 0, { name: 'Свет', color: 'yellow' }),
    base('tbl', 'TABLE', 'proj', 0, 40, { cells: [['Статья', 'Сумма'], ['Свет', '5000']], colWidths: [100, 100], formats: {}, header: true }),
  ].map((e) => [e.id, e]),
);

/** Every object of a schema the API accepts: closed, with all properties required. */
function assertStrict(schema: unknown) {
  if (!schema || typeof schema !== 'object') return;
  const s = schema as Record<string, unknown>;
  if (s.type === 'object') {
    expect(s.additionalProperties).toBe(false);
    expect([...(s.required as string[])].sort()).toEqual(Object.keys(s.properties as object).sort());
    Object.values(s.properties as object).forEach(assertStrict);
  }
  if (s.type === 'array') assertStrict(s.items);
}

describe('boards as text', () => {
  it('writes a board in reading order with ids, columns and labels', () => {
    const text = boardForModel(ELEMENTS, 'proj');
    expect(text.split('\n')[0]).toBe('Доска: Главная / Ролик про маяк');
    expect(text).toContain('[n1] заметка (метки: Свет): Свет для ночных сцен');
    expect(text).toContain('[col] колонка: Идеи\n  [n3] заметка: Финал: маяк гаснет на рассвете');
    expect(text).toContain('[refs] доска: Референсы');
    expect(text).not.toContain('корзине');
    expect(boardForModel(ELEMENTS, 'proj', new Set(['n2']))).toBe('Доска: Главная / Ролик про маяк\n\n[n2] заметка: Позвонить оператору насчёт крана');
  });

  it('outlines all boards', () => {
    expect(boardTree(ELEMENTS)).toBe('[home] Главная (карточек: 0)\n  [proj] Ролик про маяк (карточек: 4)\n    [refs] Референсы (карточек: 2)');
  });

  it('searches by words in any form, across boards, labels and picture descriptions, never in the trash', () => {
    const ids = (q: string) => searchBoards(ELEMENTS, q).map((h) => h.element.id);
    expect(ids('ночная сцена свет').slice(0, 2).sort()).toEqual(['n1', 'n4']);
    expect(ids('керосиновую лампу')).toEqual(expect.arrayContaining(['img', 'n4']));
    expect(ids('ship log')).toEqual(['img']);
    expect(ids('свет')).not.toContain('gone');
    expect(ids('zzz')).toEqual([]);
  });

  it('reads a card in full and refuses what does not exist', () => {
    expect(readElement(ELEMENTS, 'tbl')).toContain('Статья | Сумма\nСвет | 5000');
    expect(readElement(ELEMENTS, 'gone')).toBeNull();
    expect(readElement(ELEMENTS, 'nope')).toBeNull();
    const tools = boardTools(() => ELEMENTS);
    expect(tools.search_cards({ query: 'кран' })).toContain('[n2] заметка на доске «Главная / Ролик про маяк»');
    expect(tools.read_board({ board_id: 'n1' })).toContain('нет');
    expect(tools.read_card({ card_id: 42 })).toContain('нет');
    expect(tools.search_cards({})).toBe('Пустой запрос.');
  });

  it('turns references of an answer into links to cards that exist', () => {
    const linked = withCardLinks('Свет тёплый [[n1]]. Есть референсы [[refs]] и выдумка [[nope]].', ELEMENTS);
    expect(linked).toMatch(/^Свет тёплый \[↗ Свет для ночных сцен: [^\]]{5,30}…\]\(https:\/\/zadum\.local\/card\/n1\)\. Есть референсы \[↗ Референсы\]\(https:\/\/zadum\.local\/card\/refs\) и выдумка\.$/);
  });
});

describe('answers about boards are checked before use', () => {
  it('uses schemas the API accepts', () => {
    [ARRANGE_SCHEMA, LABELS_SCHEMA, IMAGE_SCHEMA, TASKS_SCHEMA].forEach(assertStrict);
  });

  it('keeps each note in one column and drops unknown ids', () => {
    const groups = checkGroups([{ title: ' Свет ', ids: ['n1', 'n4', 'ghost'] }, { title: '', ids: ['n1', 'n2'] }, { title: 'Пусто', ids: [] }], new Set(['n1', 'n2', 'n4']));
    expect(groups).toEqual([{ title: 'Свет', ids: ['n1', 'n4'] }, { title: 'Без названия', ids: ['n2'] }]);
  });

  it('merges labels by name and skips cards that already have them', () => {
    const has = (id: string, name: string) => id === 'n1' && name.toLowerCase() === 'свет';
    expect(checkLabels([{ name: '#Свет', ids: ['n1', 'n4'] }, { name: 'свет', ids: ['n2', 'x'] }, { name: '', ids: ['n2'] }, { name: 'Пустая', ids: ['n1x'] }], new Set(['n1', 'n2', 'n4']), has)).toEqual([{ name: 'Свет', ids: ['n4', 'n2'] }]);
  });

  it('tidies picture notes and review tasks', () => {
    const noteOut = checkImageNote({ description: '  Лампа   на столе ', text: ' SHIP LOG ' });
    expect(noteOut).toEqual({ description: 'Лампа на столе', text: 'SHIP LOG' });
    expect(imageSearchText(noteOut)).toBe('Лампа на столе\nSHIP LOG');
    expect(checkImageNote(null)).toEqual({ description: '', text: '' });
    expect(checkTasks([{ text: ' Укоротить паузу ', timecodes: ['00:00:05:00', 'bad'] }, { text: '', timecodes: [] }], new Set(['00:00:05:00']))).toEqual([{ text: 'Укоротить паузу', timecodes: ['00:00:05:00'] }]);
    expect(fitSide(4000, 2000)).toEqual({ width: 1568, height: 784 });
    expect(fitSide(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('asking the boards', () => {
  beforeEach(() => {
    __resetForTests();
    useStore.setState({ elements: ELEMENTS as never, boardId: 'home' });
    setAiSettings({ model: 'claude-opus-5-5', effort: 'medium', spent: 0 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lets the model look through the boards with tools, then answers with sources', async () => {
    const answers: FakeAnswer[] = [
      { text: 'Сейчас поищу.', toolUses: [{ id: 'tu_1', name: 'search_cards', input: { query: 'свет ночные сцены' } }], inputTokens: 500, outputTokens: 50 },
      { toolUses: [{ id: 'tu_2', name: 'read_card', input: { card_id: 'n4' } }], inputTokens: 900, outputTokens: 40 },
      { text: 'Референсы по свету лежат на доске «Референсы» [[n4]], заметка про тёплый свет — в проекте [[n1]].', inputTokens: 1300, outputTokens: 80 },
    ];
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(fakeStream(answers.shift()!), { headers: { 'content-type': 'text/event-stream' } });
      }),
    );
    const status: string[] = [];
    const answer = await askBoards('Где у меня референсы по свету для ночных сцен?', [], { onStatus: (s) => status.push(s) });
    expect(answer.text).toContain('[[n4]]');
    expect(status).toEqual(['Ищу: «свет ночные сцены»', 'Читаю карточку']);
    expect(bodies).toHaveLength(3);
    // Tools are offered, never forced; the model and the fallback are as everywhere else.
    expect(bodies[0]).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', stream: true });
    expect(bodies[0]).not.toHaveProperty('tool_choice');
    expect((bodies[0].tools as { name: string }[]).map((t) => t.name)).toEqual(['search_cards', 'list_boards', 'read_board', 'read_card']);
    // The second request carries the first tool call and what the search found.
    const second = bodies[1].messages as { role: string; content: { type: string; content?: unknown; tool_use_id?: string }[] }[];
    expect(second).toHaveLength(3);
    expect(second[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' });
    expect(JSON.stringify(second[2].content[0].content)).toContain('[n4] заметка на доске');
    const third = bodies[2].messages as { content: { type: string; content?: unknown }[] }[];
    expect(JSON.stringify(third[4].content[0].content)).toContain('Эггерса');
    // All three requests are paid for.
    expect(answer.usage.input_tokens).toBe(2700);
    expect(answer.cost).toBeCloseTo((2700 * 4 + 170 * 20) / 1e6, 6);
  });

  it('keeps earlier questions and answers for a follow-up', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(fakeStream({ text: 'Да.' }), { headers: { 'content-type': 'text/event-stream' } });
      }),
    );
    await askBoards('А по звуку?', [{ question: 'Что по свету?', answer: 'Тёплый.' }]);
    const messages = bodies[0].messages as { role: string; content: unknown }[];
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});
