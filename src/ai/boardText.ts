import { boardPath, canvasChildren, columnChildren, containingBoard, inboxChildren } from '../model/store';
import { elementText } from '../model/text';
import { HOME_ID, type ZElement } from '../model/types';
import { scriptForModel } from './scriptPrompts';

/**
 * Boards as text for the model, and the tools it uses to look through them.
 * Every card is written as "[id] kind: text", so answers can point at cards.
 */

type Elements = Record<string, ZElement>;

const KIND: Record<ZElement['type'], string> = {
  CARD: 'заметка',
  BOARD: 'доска',
  COLUMN: 'колонка',
  TASK_LIST: 'задачи',
  IMAGE: 'картинка',
  FILE: 'файл',
  LINK: 'ссылка',
  LINE: 'линия',
  COLOR_SWATCH: 'цвет',
  LABEL: 'метка',
  TABLE: 'таблица',
  DOCUMENT: 'документ',
  DRAWING: 'рисунок',
  SKETCH: 'кадр',
  ALIAS: 'ярлык доски',
  COMMENT: 'комментарий',
  SCRIPT: 'сценарий',
};

const alive = (elements: Elements, e: ZElement | undefined): e is ZElement => {
  for (let cur = e, hops = 0; cur && hops < 100; cur = cur.parentId ? elements[cur.parentId] : undefined, hops++) if (cur.section === 'TRASH') return false;
  return !!e;
};

const clip = (text: string, max: number) => {
  const flat = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const labelNames = (elements: Elements, e: ZElement) =>
  (e.labels ?? [])
    .map((id) => elements[id])
    .filter((l) => l?.type === 'LABEL')
    .map((l) => (l as { name: string }).name);

/** A short name of an element for links in answers. */
export function shortName(e: ZElement): string {
  const text = e.type === 'BOARD' || e.type === 'COLUMN' || e.type === 'DOCUMENT' || e.type === 'SCRIPT' ? e.title : elementText(e).split('\n')[0];
  return clip(text || KIND[e.type], 40);
}

/** "Главная / Проект / Референсы" */
export function pathOf(elements: Elements, id: string): string {
  const e = elements[id];
  const board = e?.type === 'BOARD' ? e.id : containingBoard(elements, id);
  return board ? boardPath(elements, board).map((b) => b.title).join(' / ') : '';
}

/** One card as a line (several lines for long text): "[id] заметка: текст". */
export function cardLine(elements: Elements, e: ZElement, max = 600): string {
  const labels = labelNames(elements, e);
  const text = e.type === 'SCRIPT' ? `${e.title} (сценарий, ${e.blocks.length} строк)` : e.type === 'SKETCH' && e.shot ? [`кадр ${[e.shot.scene, e.shot.shot].filter(Boolean).join('.')}`, e.shot.size, e.shot.movement, e.caption].filter(Boolean).join(', ') : elementText(e);
  return `[${e.id}] ${KIND[e.type]}${labels.length ? ` (метки: ${labels.join(', ')})` : ''}: ${clip(text, max) || '—'}`;
}

/** The cards of a board in reading order (columns with their cards), as lines. `only` limits it to some cards. */
export function boardLines(elements: Elements, boardId: string, only?: Set<string>, max = 600): string[] {
  const lines: string[] = [];
  const top = canvasChildren(elements, boardId)
    .filter((e) => e.type !== 'LINE' && e.type !== 'DRAWING')
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const e of top) {
    if (e.type === 'COLUMN') {
      const kids = columnChildren(elements, e.id).filter((k) => !only || only.has(k.id) || only.has(e.id));
      if (!kids.length && only && !only.has(e.id)) continue;
      lines.push(`[${e.id}] колонка: ${e.title || 'без названия'}`);
      for (const k of kids) lines.push(`  ${cardLine(elements, k, max)}`);
    } else if (!only || only.has(e.id)) lines.push(cardLine(elements, e, max));
  }
  if (!only) for (const e of inboxChildren(elements, boardId)) lines.push(`${cardLine(elements, e, max)} (в «Неразобранном»)`);
  return lines;
}

/** A board (or some of its cards) as the material of a request. */
export function boardForModel(elements: Elements, boardId: string, only?: Set<string>): string {
  const lines = boardLines(elements, boardId, only);
  return [`Доска: ${pathOf(elements, boardId)}`, '', ...(lines.length ? lines : ['(пусто)'])].join('\n');
}

/** All boards as an outline with ids and the number of cards on each. */
export function boardTree(elements: Elements, max = 400): string {
  const lines: string[] = [];
  const visit = (id: string, depth: number) => {
    if (lines.length >= max) return;
    const board = elements[id];
    if (!board || board.type !== 'BOARD' || !alive(elements, board)) return;
    const kids = canvasChildren(elements, id);
    const inColumns = kids.filter((k) => k.type === 'COLUMN').flatMap((c) => columnChildren(elements, c.id));
    const all = [...kids, ...inColumns];
    lines.push(`${'  '.repeat(depth)}[${id}] ${board.title} (карточек: ${all.filter((k) => k.type !== 'BOARD' && k.type !== 'COLUMN' && k.type !== 'LINE').length})`);
    for (const child of all.filter((k) => k.type === 'BOARD').sort((a, b) => a.y - b.y || a.x - b.x)) visit(child.id, depth + 1);
  };
  visit(HOME_ID, 0);
  if (lines.length >= max) lines.push('… (досок больше; ищите поиском)');
  return lines.join('\n');
}

const stem = (word: string) => {
  const w = word.toLocaleLowerCase('ru-RU');
  return [...w].length >= 6 ? [...w].slice(0, -2).join('') : [...w].length >= 4 ? [...w].slice(0, -1).join('') : w;
};

export interface Hit {
  element: ZElement;
  score: number;
}

/** Cards whose text contains the words of the query (in any grammatical form); the more words and the rarer, the higher. */
export function searchBoards(elements: Elements, query: string, limit = 20): Hit[] {
  const words = [...new Set(query.split(/[^\p{L}\p{N}]+/u).filter((w) => [...w].length >= 2).map(stem))];
  if (!words.length) return [];
  const hits: Hit[] = [];
  for (const e of Object.values(elements)) {
    if (e.type === 'LABEL' || e.type === 'LINE' || e.type === 'DRAWING' || e.type === 'ALIAS' || !alive(elements, e)) continue;
    const labels = labelNames(elements, e).join(' ');
    const text = `${elementText(e)}\n${labels}`.toLocaleLowerCase('ru-RU');
    if (!text.trim()) continue;
    let score = 0;
    for (const w of words) {
      const first = text.indexOf(w);
      if (first < 0) continue;
      score += 10 + Math.min(5, text.split(w).length - 2) + (first < 80 ? 2 : 0);
    }
    if (!score) continue;
    // Every word found beats many repeats of one.
    const matched = words.filter((w) => text.includes(w)).length;
    hits.push({ element: e, score: score + matched * 20 + (e.type === 'BOARD' ? 3 : 0) });
  }
  return hits.sort((a, b) => b.score - a.score || b.element.updatedAt - a.element.updatedAt).slice(0, limit);
}

/** A hit as text for the model: where it is, and the part of its text around the first word found. */
export function hitLine(elements: Elements, hit: Hit, query: string): string {
  const e = hit.element;
  const text = elementText(e);
  const words = query.split(/[^\p{L}\p{N}]+/u).filter((w) => [...w].length >= 2).map(stem);
  const lower = text.toLocaleLowerCase('ru-RU');
  const at = Math.max(0, Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0), text.length) - 120);
  const part = clip(`${at > 0 ? '…' : ''}${text.slice(at, at + 420)}`, 440);
  return `[${e.id}] ${KIND[e.type]} на доске «${pathOf(elements, e.id)}»: ${part}`;
}

/** The whole text of one card (a script in script form, a table row by row), cut if it is very long. */
export function readElement(elements: Elements, id: string, max = 14000): string | null {
  const e = elements[id];
  if (!alive(elements, e)) return null;
  if (e.type === 'BOARD') return boardForModel(elements, e.id);
  let text: string;
  if (e.type === 'SCRIPT') text = scriptForModel(e);
  else if (e.type === 'TABLE') text = e.cells.map((row) => row.join(' | ')).join('\n');
  else if (e.type === 'COLUMN') text = [`Колонка: ${e.title}`, ...columnChildren(elements, e.id).map((k) => cardLine(elements, k, 1200))].join('\n');
  else text = elementText(e);
  const cut = text.length > max;
  return `${KIND[e.type]} [${e.id}] на доске «${pathOf(elements, e.id)}»:\n${cut ? `${text.slice(0, max)}\n… (текст обрезан: ещё ${text.length - max} знаков)` : text}`;
}

export const CARD_LINK = 'https://zadum.local/card/';

/** Turns [[id]] references of an answer into links to the cards (unknown ids are dropped). */
export function withCardLinks(text: string, elements: Elements): string {
  return text.replace(/\s*\[\[([\w-]{1,64})\]\]/g, (_all, id: string) => {
    const e = elements[id];
    if (!alive(elements, e)) return '';
    return ` [↗ ${shortName(e).replace(/[[\]()]/g, '')}](${CARD_LINK}${id})`;
  });
}
