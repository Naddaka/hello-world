import { useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { actions, allLabels, asOneStep, canvasChildren, columnChildren, commit, useStore } from '../model/store';
import { updateOp } from '../model/ops';
import { DEFAULT_WIDTH, type ImageElement, type ZElement } from '../model/types';
import { elementText } from '../model/text';
import { freeSpot } from '../canvas/placement';
import { centreOn } from '../canvas/runtime';
import { newDocumentFields } from '../doc/DocumentView';
import { reveal } from '../ui/SearchPanel';
import { IconSparkle } from '../ui/icons';
import { openAiJob } from './AiDialog';
import type { BoardAiItem } from './BoardAiMenu';
import { Markdown } from './MarkdownView';
import { askBoards, ASK_SYSTEM, type Turn } from './askBoards';
import { boardForModel, shortName, withCardLinks } from './boardText';
import { IMAGE_SCHEMA, IMAGE_SYSTEM, arrangeRequest, checkGroups, checkImageNote, checkLabels, imageSearchText, labelsRequest, summaryRequest, type Group, type ImageNote, type LabelProposal } from './boardPrompts';
import { imageForModel } from './images';
import { markdownToDoc } from './markdown';
import { ask, type AiAnswer } from './run';
import { costOf, useAiSettings, type Usage } from './settings';

const copy = (text: string) => navigator.clipboard.writeText(text).then(() => actions.showToast('Скопировано'), () => actions.showToast('Не удалось скопировать'));

const state = () => useStore.getState();

/** Cards of the open board the action applies to: the selection, or everything on the board (with what sits in its columns). */
function scope(): { boardId: string; all: ZElement[]; selected: ZElement[]; picked: boolean } {
  const { elements, boardId, selection } = state();
  const top = canvasChildren(elements, boardId);
  const all = [...top, ...top.filter((e) => e.type === 'COLUMN').flatMap((c) => columnChildren(elements, c.id))];
  const selected = selection
    .map((id) => elements[id])
    .filter((e): e is ZElement => !!e && e.section !== 'TRASH')
    .flatMap((e) => (e.type === 'COLUMN' ? [e, ...columnChildren(elements, e.id)] : [e]));
  return { boardId, all, selected, picked: selected.length > 0 };
}

const withText = (e: ZElement) => !['LINE', 'DRAWING', 'COLUMN', 'BOARD', 'ALIAS', 'LABEL'].includes(e.type) && !!elementText(e).trim();
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`;
};
const cards = (n: number) => plural(n, 'карточка', 'карточки', 'карточек');

// ---------- ask the boards ----------

export const useAskBoards = create<{ open: boolean; history: Turn[] }>(() => ({ open: false, history: [] }));

function startAsk(question: string, history: Turn[]) {
  openAiJob<null>({
    title: 'Спросить доски',
    sends: 'ваш вопрос и те карточки, которые ИИ найдёт на ваших досках поиском и прочитает, чтобы ответить',
    request: { system: ASK_SYSTEM, prompt: question },
    wide: true,
    run: (hooks) => askBoards(question, history, hooks),
    Result: ({ answer, close }) => <AskResult question={question} history={history} answer={answer} close={close} />,
  });
}

function AskResult({ question, history, answer, close }: { question: string; history: Turn[]; answer: AiAnswer<null>; close: () => void }) {
  const [next, setNext] = useState('');
  const linked = useMemo(() => withCardLinks(answer.text, state().elements), [answer.text]);
  const follow = () => {
    const q = next.trim();
    if (q) startAsk(q, [...history, { question, answer: answer.text }].slice(-6));
  };
  return (
    <>
      <p className="ai-question">{question}</p>
      <Markdown
        text={linked}
        className="ai-answer"
        onCard={(id) => {
          const element = state().elements[id];
          if (!element) return actions.showToast('Этой карточки уже нет');
          close();
          reveal(element);
        }}
      />
      <form
        className="ai-ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          follow();
        }}
      >
        <input aria-label="Уточняющий вопрос" placeholder="Уточнить или спросить ещё…" value={next} onChange={(e) => setNext(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button type="submit" className="btn-accent" disabled={!next.trim()}>Спросить</button>
      </form>
      <footer className="modal-foot">
        <button type="button" className="ibtn wide" onClick={() => void copy(answer.text.replace(/\s*\[\[[\w-]+\]\]/g, ''))}>Копировать ответ</button>
        <button type="button" className="ibtn wide" onClick={close}>Закрыть</button>
      </footer>
    </>
  );
}

/** The question box of "Ask the boards". */
export function AskBoardsDialog() {
  const open = useAskBoards((s) => s.open);
  const [question, setQuestion] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  if (!open) return null;
  const close = () => useAskBoards.setState({ open: false });
  const submit = () => {
    const q = question.trim();
    if (!q) return;
    close();
    setQuestion('');
    startAsk(q, []);
  };
  return (
    <div className="modal-backdrop ai-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal panel ai-dialog" role="dialog" aria-modal="true" aria-labelledby="ask-title" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <header className="modal-head">
          <h2 id="ask-title"><IconSparkle size={17} /> Спросить доски</h2>
          <button type="button" className="ibtn" aria-label="Закрыть" onClick={close}>✕</button>
        </header>
        <div className="modal-body">
          <p>Задайте вопрос по всему, что есть на ваших досках. ИИ сам найдёт нужные карточки и ответит со ссылками на них.</p>
          <textarea
            ref={input}
            className="ai-ask"
            autoFocus
            rows={3}
            aria-label="Вопрос"
            placeholder="Например: где у меня референсы по свету для ночных сцен? Что осталось сделать по ролику про маяк?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <footer className="modal-foot">
            <button type="button" className="ibtn wide" onClick={close}>Отмена</button>
            <button type="button" className="btn-accent" disabled={!question.trim()} onClick={submit}>Спросить</button>
          </footer>
        </div>
      </div>
    </div>
  );
}

// ---------- summary ----------

function insertNear(fields: Parameters<typeof actions.insert>[0], width: number, height: number): string {
  const { boardId, elements } = state();
  const kids = canvasChildren(elements, boardId);
  const right = kids.length ? Math.max(...kids.map((e) => e.x + e.width)) : 0;
  const top = kids.length ? Math.min(...kids.map((e) => e.y)) : 0;
  const spot = freeSpot(boardId, right + 4, top, width, height);
  const id = actions.insert(fields, boardId, spot.x, spot.y);
  actions.select([id]);
  centreOn(spot.x + width / 2, spot.y);
  return id;
}

function summarize() {
  const { boardId, all, selected, picked } = scope();
  const elements = state().elements;
  const targets = (picked ? selected : all).filter(withText);
  if (!targets.length) return actions.showToast(picked ? 'В выделенном нет текста' : 'На доске пока нечего пересказывать');
  const board = elements[boardId];
  const title = board?.type === 'BOARD' ? board.title : 'Доска';
  const material = boardForModel(elements, boardId, picked ? new Set(selected.map((e) => e.id)) : undefined);
  openAiJob<null>({
    title: picked ? 'Сводка выделенного' : 'Сводка доски',
    sends: picked ? `текст выделенных карточек (${targets.length}) с доски «${title}»` : `текст всех карточек доски «${title}» (${targets.length})`,
    request: summaryRequest(material, !picked),
    wide: true,
    Result: ({ answer, close }) => (
      <>
        <Markdown text={answer.text} className="ai-answer" />
        <footer className="modal-foot">
          <button type="button" className="ibtn wide" onClick={() => void copy(answer.text)}>Копировать</button>
          <button
            type="button"
            className="ibtn wide"
            onClick={() => {
              insertNear({ type: 'CARD', content: markdownToDoc(answer.text), color: 'yellow' }, DEFAULT_WIDTH.CARD, 30);
              actions.showToast('Сводка добавлена заметкой справа на доске');
              close();
            }}
          >
            Заметкой на доску
          </button>
          <button
            type="button"
            className="btn-accent"
            onClick={() => {
              insertNear({ ...newDocumentFields(), title: `Сводка · ${title}`, content: markdownToDoc(answer.text) }, DEFAULT_WIDTH.DOCUMENT, 12);
              actions.showToast('Сводка сохранена документом справа на доске');
              close();
            }}
          >
            Документом на доску
          </button>
        </footer>
      </>
    ),
  });
}

// ---------- arrange notes into columns ----------

/** Notes lying loose on the board (not in a column): the selected ones, or all of them. */
function looseNotes(): ZElement[] {
  const { boardId, selected, picked } = scope();
  const elements = state().elements;
  const loose = (e: ZElement) => e.type === 'CARD' && e.parentId === boardId && e.section === 'CANVAS' && !e.locked && !!elementText(e).trim();
  return (picked ? selected : canvasChildren(elements, boardId)).filter(loose);
}

function arrange() {
  const notes = looseNotes();
  if (notes.length < 3) return actions.showToast('Нужно хотя бы три заметки вне колонок — выделите их или снимите выделение, чтобы взять все');
  const { boardId } = scope();
  const elements = state().elements;
  const ids = new Set(notes.map((n) => n.id));
  openAiJob<{ groups: Group[] }>({
    title: 'Разложить по колонкам',
    sends: `текст ${plural(notes.length, 'заметки', 'заметок', 'заметок')} с этой доски`,
    request: arrangeRequest(boardForModel(elements, boardId, ids), notes.length),
    wide: true,
    Result: ({ answer, close }) => <ArrangeResult groups={checkGroups(answer.data?.groups, ids)} total={notes.length} close={close} />,
  });
}

function ArrangeResult({ groups, total, close }: { groups: Group[]; total: number; close: () => void }) {
  const elements = state().elements;
  const [titles, setTitles] = useState(() => groups.map((g) => g.title));
  const placed = groups.reduce((n, g) => n + g.ids.length, 0);
  if (!groups.length) {
    return (
      <>
        <p>Модель не смогла разложить заметки. Попробуйте ещё раз.</p>
        <footer className="modal-foot"><button type="button" className="btn-accent" onClick={close}>Закрыть</button></footer>
      </>
    );
  }
  const apply = () => {
    const { boardId } = state();
    const now = state().elements;
    const kids = canvasChildren(now, boardId);
    const first = groups.flatMap((g) => g.ids).map((id) => now[id]).filter(Boolean);
    let x = Math.max(...kids.map((e) => e.x + e.width)) + 6;
    const y = Math.min(...first.map((e) => e.y));
    const made: string[] = [];
    asOneStep(() => {
      groups.forEach((g, i) => {
        const alive = g.ids.filter((id) => state().elements[id]?.parentId === boardId);
        if (!alive.length) return;
        const column = actions.insert({ type: 'COLUMN', title: titles[i].trim() || g.title, collapsed: false }, boardId, x, y);
        actions.insertIntoColumn(alive, column);
        made.push(column);
        x += DEFAULT_WIDTH.COLUMN + 3;
      });
    });
    if (made.length) {
      actions.select(made);
      const firstColumn = state().elements[made[0]];
      if (firstColumn) centreOn(firstColumn.x + (made.length * (DEFAULT_WIDTH.COLUMN + 3)) / 2, firstColumn.y);
    }
    actions.showToast(`Заметки разложены по колонкам: ${made.length}. Отменить — ⌘Z`);
    close();
  };
  return (
    <>
      <p>
        Колонок: {groups.length}, заметок в них: {placed} из {total}. Названия можно поправить. Колонки появятся справа от содержимого доски; заметки переедут в них.
      </p>
      <ul className="ai-check-list" aria-label="Предложенные колонки">
        {groups.map((g, i) => (
          <li key={i} style={{ display: 'block' }}>
            <input className="ai-group-title" aria-label={`Название колонки ${i + 1}`} value={titles[i]} onChange={(e) => setTitles(titles.map((t, k) => (k === i ? e.target.value : t)))} onKeyDown={(e) => e.stopPropagation()} />
            <ul className="ai-group-notes">
              {g.ids.map((id) => (
                <li key={id}>{elements[id] ? shortName(elements[id]) : '—'}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <footer className="modal-foot">
        <button type="button" className="ibtn wide" onClick={close}>Оставить как есть</button>
        <button type="button" className="btn-accent" onClick={apply}>Разложить</button>
      </footer>
    </>
  );
}

// ---------- labels ----------

function suggestLabels() {
  const { boardId, all, selected, picked } = scope();
  const elements = state().elements;
  const targets = (picked ? selected : all.filter((e) => e.type === 'CARD')).filter(withText);
  if (targets.length < 2) return actions.showToast('Нужно хотя бы две карточки с текстом');
  const ids = new Set(targets.map((t) => t.id));
  const existing = allLabels(elements);
  openAiJob<{ labels: LabelProposal[] }>({
    title: 'Предложить метки',
    sends: `текст ${plural(targets.length, 'карточки', 'карточек', 'карточек')} с этой доски и названия ваших меток`,
    request: labelsRequest(boardForModel(elements, boardId, ids), existing.map((l) => l.name)),
    wide: true,
    Result: ({ answer, close }) => <LabelsResult proposals={answer.data?.labels} ids={ids} close={close} />,
  });
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase('ru-RU') === b.trim().toLocaleLowerCase('ru-RU');

function LabelsResult({ proposals, ids, close }: { proposals: LabelProposal[] | undefined; ids: Set<string>; close: () => void }) {
  const elements = state().elements;
  const labels = useMemo(() => {
    const existing = allLabels(elements);
    const has = (id: string, name: string) => {
      const label = existing.find((l) => sameName(l.name, name));
      return !!label && !!elements[id]?.labels?.includes(label.id);
    };
    return checkLabels(proposals, ids, has).map((l) => ({ ...l, known: existing.find((e) => sameName(e.name, l.name)) ?? null }));
    // The proposal is fixed once the answer is in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposals]);
  const [picked, setPicked] = useState(() => new Set(labels.map((_, i) => i)));
  if (!labels.length) {
    return (
      <>
        <p>Новых меток не нашлось: подходящие уже стоят.</p>
        <footer className="modal-foot"><button type="button" className="btn-accent" onClick={close}>Закрыть</button></footer>
      </>
    );
  }
  const apply = () => {
    let count = 0;
    asOneStep(() => {
      labels.forEach((l, i) => {
        if (!picked.has(i)) return;
        const now = state().elements;
        const targets = l.ids.filter((id) => now[id]);
        const known = allLabels(now).find((e) => sameName(e.name, l.name));
        if (!known) actions.createLabel(l.name, targets);
        else commit(targets.filter((id) => !now[id].labels?.includes(known.id)).map((id) => updateOp(now[id], { labels: [...(now[id].labels ?? []), known.id] })));
        count++;
      });
    });
    actions.showToast(`Меток поставлено: ${count}. Отменить — ⌘Z`);
    close();
  };
  return (
    <>
      <p>Отметьте метки, которые поставить. Цвет и название метки потом можно поменять в окне «Метки».</p>
      <ul className="ai-check-list" aria-label="Предложенные метки">
        {labels.map((l, i) => (
          <li key={l.name}>
            <input
              type="checkbox"
              id={`ai-label-${i}`}
              checked={picked.has(i)}
              onChange={() => setPicked((prev) => {
                const next = new Set(prev);
                if (next.has(i)) next.delete(i);
                else next.add(i);
                return next;
              })}
            />
            <label htmlFor={`ai-label-${i}`} className="grow">
              <b>{l.known?.name ?? l.name}</b> <span className="sub">· {l.known ? 'уже есть' : 'новая'} · {cards(l.ids.length)}</span>
              <br />
              <span className="sub">{l.ids.slice(0, 4).map((id) => (elements[id] ? shortName(elements[id]) : '')).filter(Boolean).join(' · ')}{l.ids.length > 4 ? ' …' : ''}</span>
            </label>
          </li>
        ))}
      </ul>
      <footer className="modal-foot">
        <button type="button" className="ibtn wide" onClick={close}>Не ставить</button>
        <button type="button" className="btn-accent" disabled={!picked.size} onClick={apply}>Поставить метки ({picked.size})</button>
      </footer>
    </>
  );
}

// ---------- pictures: description and text for search ----------

/** Rough input size of one picture with its instructions. */
const TOKENS_PER_IMAGE = 1700;

function imagesToDescribe(): { images: ImageElement[]; skipped: number } {
  const { all, selected, picked } = scope();
  const pool = (picked ? selected : all).filter((e): e is ImageElement => e.type === 'IMAGE');
  // On the whole board, pictures that already have a description are left alone; a selection is described again.
  const images = picked ? pool : pool.filter((e) => !e.aiText);
  return { images, skipped: pool.length - images.length };
}

export function describeImages(only?: ImageElement[]) {
  const { images, skipped } = only ? { images: only, skipped: 0 } : imagesToDescribe();
  if (!images.length) return actions.showToast(skipped ? 'У всех картинок на доске уже есть описание. Выделите картинку, чтобы описать её заново' : 'На доске нет картинок — выделите их или снимите выделение');
  type Described = { id: string; note: ImageNote | null; error?: string };
  openAiJob<Described[]>({
    title: images.length === 1 ? 'Описать картинку' : 'Описать картинки',
    sends: `${plural(images.length, 'картинка', 'картинки', 'картинок')} с этой доски (уменьшенные копии)`,
    request: { system: IMAGE_SYSTEM, prompt: 'Опиши это изображение.', schema: IMAGE_SCHEMA },
    approxTokens: images.length * TOKENS_PER_IMAGE,
    wide: true,
    run: async (hooks) => {
      const out: Described[] = [];
      const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } satisfies Usage;
      let model = '';
      let usedFallback = false;
      let done = 0;
      const queue = [...images];
      const worker = async () => {
        for (let image = queue.shift(); image; image = queue.shift()) {
          if (hooks.signal?.aborted) return;
          try {
            const picture = await imageForModel(image.media);
            const answer = await ask<ImageNote>({ system: IMAGE_SYSTEM, prompt: 'Опиши это изображение.', images: [picture], schema: IMAGE_SCHEMA, effort: 'low', maxTokens: 4000 }, { signal: hooks.signal });
            out.push({ id: image.id, note: checkImageNote(answer.data) });
            usage.input_tokens += answer.usage.input_tokens;
            usage.output_tokens += answer.usage.output_tokens;
            usage.cache_creation_input_tokens += answer.usage.cache_creation_input_tokens ?? 0;
            usage.cache_read_input_tokens += answer.usage.cache_read_input_tokens ?? 0;
            model = answer.model;
            usedFallback ||= answer.usedFallback;
          } catch (error) {
            const e = error as { kind?: string; message?: string };
            // A problem with the key or the connection stops the whole batch; one bad picture does not.
            if (e.kind === 'cancelled' || e.kind === 'auth' || e.kind === 'no-key' || e.kind === 'network' || (e.kind === 'rate' && !out.some((o) => o.note))) throw error;
            out.push({ id: image.id, note: null, error: e.message ?? 'не удалось' });
          }
          done++;
          if (images.length > 1) hooks.onStatus(`Готово ${done} из ${images.length}`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, images.length) }, worker));
      const order = new Map(images.map((image, i) => [image.id, i]));
      out.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      return { text: '', data: out, model: model || useAiSettings.getState().model, usage, cost: model ? costOf(model, usage) : 0, usedFallback, truncated: false };
    },
    Result: ({ answer, close }) => <ImagesResult described={answer.data} close={close} />,
  });
}

function ImagesResult({ described, close }: { described: { id: string; note: ImageNote | null; error?: string }[]; close: () => void }) {
  const elements = state().elements;
  const good = described.filter((d) => d.note && (d.note.description || d.note.text) && elements[d.id]?.type === 'IMAGE');
  const failed = described.length - good.length;
  const [captions, setCaptions] = useState(false);
  if (!good.length) {
    return (
      <>
        <p className="mn-warn">Не удалось описать {described.length === 1 ? 'картинку' : 'картинки'}{described[0]?.error ? `: ${described[0].error}` : '.'}</p>
        <footer className="modal-foot"><button type="button" className="btn-accent" onClick={close}>Закрыть</button></footer>
      </>
    );
  }
  const apply = () => {
    const now = state().elements;
    commit(
      good
        .map((d) => ({ d, image: now[d.id] }))
        .filter((x): x is { d: (typeof good)[number]; image: ImageElement } => x.image?.type === 'IMAGE')
        .map(({ d, image }) => updateOp(image, { aiText: imageSearchText(d.note!), ...(captions && !image.caption.trim() && d.note!.description ? { caption: d.note!.description, showCaption: true } : {}) })),
    );
    actions.showToast(`Описания сохранены: ${good.length}. Теперь эти картинки находятся поиском`);
    close();
  };
  return (
    <>
      <p>
        Описано: {good.length}
        {failed ? `, не получилось: ${failed}` : ''}. Описание и текст с картинки сохранятся при ней, и поиск по доскам начнёт их находить.
      </p>
      <ul className="ai-check-list" aria-label="Описания картинок">
        {good.map((d) => (
          <li key={d.id} style={{ display: 'block' }}>
            <b>{(elements[d.id] as ImageElement).name}</b>
            <br />
            {d.note!.description}
            {d.note!.text && (
              <>
                <br />
                <span className="sub">Текст на картинке: {d.note!.text.length > 220 ? `${d.note!.text.slice(0, 219)}…` : d.note!.text}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      <label className="mn-check">
        <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Поставить описание подписью там, где подписи нет
      </label>
      <footer className="modal-foot">
        <button type="button" className="ibtn wide" onClick={close}>Не сохранять</button>
        <button type="button" className="btn-accent" onClick={apply}>Сохранить описания</button>
      </footer>
    </>
  );
}

// ---------- the menu ----------

/** AI actions offered for the open board and the current selection. */
export function boardAiItems(): BoardAiItem[] {
  const { all, selected, picked } = scope();
  const texts = (picked ? selected : all).filter(withText).length;
  const notes = looseNotes().length;
  const pictures = (picked ? selected : all).filter((e) => e.type === 'IMAGE').length;
  return [
    { label: 'Спросить доски…', hint: 'Вопрос по всем доскам; ответ со ссылками на карточки', run: () => useAskBoards.setState({ open: true }) },
    { label: picked ? `Сводка выделенного (${texts})` : 'Сводка доски', hint: 'Главное из карточек — заметкой или документом', disabled: !texts, run: summarize },
    { label: picked ? `Разложить выделенные заметки (${notes})` : 'Разложить заметки по колонкам', hint: notes >= 3 ? `Соберёт ${plural(notes, 'заметку', 'заметки', 'заметок')} вне колонок в колонки по смыслу` : 'Нужно хотя бы три заметки вне колонок', disabled: notes < 3, run: arrange },
    { label: 'Предложить метки', hint: picked ? `Для выделенных карточек (${texts})` : 'Для заметок этой доски', disabled: texts < 2, run: suggestLabels },
    { label: pictures === 1 ? 'Описать картинку' : 'Описать картинки', hint: pictures ? `Что на ${pictures === 1 ? 'картинке' : `картинках (${pictures})`} и текст с них — чтобы находить поиском` : 'На доске нет картинок', disabled: !pictures, run: () => describeImages() },
  ];
}
