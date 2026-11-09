import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { JSONContent } from '@tiptap/core';
import { applyTransaction, History, updateOp, type ElementMap, type Op, type Transaction } from './ops';
import {
  DEFAULT_WIDTH,
  EMPTY_DOC,
  fitsInColumn,
  HOME_ID,
  TRASH_RETENTION_DAYS,
  type BoardElement,
  type CardElement,
  type ElementFields,
  type ElementPatch,
  type LabelElement,
  type ZElement,
} from './types';
import type { Repo } from '../storage/repo';
import { seedElements } from './seed';

export interface Camera {
  /** Screen position (px) of the canvas origin. */
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
export const DEFAULT_CAMERA: Camera = { x: 120, y: 40, zoom: 1 };

export type Theme = 'light' | 'dark';
export type Panel = 'inbox' | 'trash' | 'search' | null;

interface State {
  ready: boolean;
  elements: ElementMap;
  boardId: string;
  back: string[];
  forward: string[];
  selection: string[];
  editingId: string | null;
  cameras: Record<string, Camera>;
  /** When each board was last opened (for "recently viewed" in search). */
  viewedAt: Record<string, number>;
  theme: Theme;
  panel: Panel;
  canUndo: boolean;
  canRedo: boolean;
  toast: string | null;
}

const history = new History();
let repo: Repo | null = null;

// ---------- persistence (batched) ----------
const pendingChanged = new Set<string>();
const pendingRemoved = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(changed: Iterable<string>, removed: Iterable<string>) {
  for (const id of changed) {
    pendingChanged.add(id);
    pendingRemoved.delete(id);
  }
  for (const id of removed) {
    pendingRemoved.add(id);
    pendingChanged.delete(id);
  }
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushPersist(), 250);
}

export async function flushPersist(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (!repo || (pendingChanged.size === 0 && pendingRemoved.size === 0)) return;
  const elements = useStore.getState().elements;
  const changed = [...pendingChanged].map((id) => elements[id]).filter((e): e is ZElement => Boolean(e));
  const removed = [...pendingRemoved];
  pendingChanged.clear();
  pendingRemoved.clear();
  try {
    await repo.save(changed, removed);
  } catch (error) {
    console.error('Не удалось сохранить изменения', error);
    // Put the batch back so the next flush retries it.
    changed.forEach((e) => pendingChanged.add(e.id));
    removed.forEach((id) => pendingRemoved.add(id));
    useStore.setState({ toast: 'Не удалось сохранить изменения — повторю попытку' });
  }
}

// ---------- local preferences ----------
const PREFS_KEY = 'zadum.prefs';

function loadPrefs(): { theme?: Theme; cameras?: Record<string, Camera>; viewedAt?: Record<string, number> } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function savePrefs() {
  const { theme, cameras, viewedAt } = useStore.getState();
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme, cameras, viewedAt }));
  } catch {
    /* storage unavailable: preferences are a convenience only */
  }
}

let prefsTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePrefs() {
  if (prefsTimer) clearTimeout(prefsTimer);
  prefsTimer = setTimeout(savePrefs, 400);
}

function systemTheme(): Theme {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// ---------- store ----------
export const useStore = create<State>(() => ({
  ready: false,
  elements: {},
  boardId: HOME_ID,
  back: [],
  forward: [],
  selection: [],
  editingId: null,
  cameras: {},
  viewedAt: {},
  theme: 'light',
  panel: null,
  canUndo: false,
  canRedo: false,
  toast: null,
}));

const get = useStore.getState;
const set = useStore.setState;

function now() {
  return Date.now();
}

/** Applies a transaction, records it for undo (unless `record` is false) and persists it. */
export function commit(tx: Transaction, record = true) {
  if (tx.length === 0) return;
  const stamped = tx.map((op) => (op.kind === 'update' ? { ...op, after: { ...op.after, updatedAt: now() } } : op));
  const { elements, changed, removed } = applyTransaction(get().elements, stamped);
  if (record) history.record(stamped);
  set({ elements, canUndo: history.canUndo, canRedo: history.canRedo });
  schedulePersist(changed, removed);
}

/** Forgets undo history: earlier steps may refer to elements that are gone for good. */
export function clearHistory() {
  history.clear();
  set({ canUndo: false, canRedo: false });
}

function applyHistory(tx: Transaction | null) {
  if (!tx) return;
  const { elements, changed, removed } = applyTransaction(get().elements, tx);
  const selection = get().selection.filter((id) => elements[id] && elements[id].section !== 'TRASH');
  set({ elements, selection, editingId: null, canUndo: history.canUndo, canRedo: history.canRedo, toast: null });
  schedulePersist(changed, removed);
}

function makeBase(parentId: string | null, x: number, y: number, z: number, width: number) {
  return { id: nanoid(), parentId, section: 'CANVAS' as const, x: Math.round(x), y: Math.round(y), width, z, createdAt: now(), updatedAt: now() };
}

const LABEL_COLORS: LabelElement['color'][] = ['blue', 'orange', 'green', 'purple', 'pink', 'yellow', 'red', 'gray'];

type NewElement =
  | { type: 'CARD'; content?: JSONContent; color?: CardElement['color'] }
  | { type: 'BOARD'; title?: string }
  | { type: 'COLUMN'; title?: string }
  | { type: 'TASK_LIST'; title?: string };

function makeElement(spec: NewElement, parentId: string, x: number, y: number, z: number, width?: number): ZElement {
  const base = {
    id: nanoid(),
    parentId,
    section: 'CANVAS' as const,
    x: Math.round(x),
    y: Math.round(y),
    width: width ?? DEFAULT_WIDTH[spec.type],
    z,
    createdAt: now(),
    updatedAt: now(),
  };
  switch (spec.type) {
    case 'CARD':
      return { ...base, type: 'CARD', content: spec.content ?? EMPTY_DOC, color: spec.color ?? 'default' };
    case 'BOARD':
      return { ...base, type: 'BOARD', title: spec.title ?? 'Новая доска', color: nextBoardColor(parentId) };
    case 'COLUMN':
      return { ...base, type: 'COLUMN', title: spec.title ?? 'Новая колонка', collapsed: false };
    case 'TASK_LIST':
      return {
        ...base,
        type: 'TASK_LIST',
        title: spec.title ?? 'Задачи',
        showTitle: true,
        items: [{ id: nanoid(), text: '', done: false, due: null, indent: 0 }],
      };
  }
}

export const actions = {
  async init(r: Repo) {
    repo = r;
    const prefs = loadPrefs();
    let loaded = await r.loadAll();
    if (!loaded.some((e) => e.id === HOME_ID)) {
      loaded = [...loaded, ...seedElements(now())];
      await r.save(loaded, []);
    }
    const elements: ElementMap = {};
    for (const e of loaded) elements[e.id] = e;
    // Items kept in the trash longer than the retention period are deleted for good.
    const expired = Object.values(elements).filter((e) => e.section === 'TRASH' && now() - e.updatedAt > TRASH_RETENTION_DAYS * 86_400_000);
    const purge = new Set(expired.flatMap((e) => [e.id, ...descendants(elements, e.id)]));
    purge.forEach((id) => delete elements[id]);
    if (purge.size) await r.save([], [...purge]);
    set({
      ready: true,
      elements,
      theme: prefs.theme ?? systemTheme(),
      cameras: prefs.cameras ?? {},
      viewedAt: prefs.viewedAt ?? {},
    });
  },

  undo() {
    applyHistory(history.undo());
  },

  redo() {
    applyHistory(history.redo());
  },

  // ----- creation -----
  /** Creates an element on a board canvas (or at the end of a column) and starts editing it. */
  create(spec: NewElement, parentId: string, x: number, y: number, opts: { edit?: boolean; width?: number } = {}): string {
    const parent = get().elements[parentId];
    const inColumn = parent?.type === 'COLUMN';
    const element = makeElement(spec, parentId, x, y, (inColumn ? lastOrder(parentId) : topZ(parentId)) + 1, opts.width);
    commit([{ kind: 'create', element }]);
    set({ selection: [element.id], editingId: opts.edit === false ? null : element.id });
    return element.id;
  },

  /**
   * Adds a fully described element (media, links) to a board canvas or, if the
   * parent is a column, at its end. Returns the new id.
   */
  insert(fields: ElementFields, parentId: string, x: number, y: number, width?: number): string {
    const inColumn = get().elements[parentId]?.type === 'COLUMN';
    const element = {
      ...fields,
      id: nanoid(),
      parentId,
      section: 'CANVAS',
      x: Math.round(x),
      y: Math.round(y),
      width: width ?? DEFAULT_WIDTH[fields.type],
      z: (inColumn ? lastOrder(parentId) : topZ(parentId)) + 1,
      createdAt: now(),
      updatedAt: now(),
    } as unknown as ZElement;
    commit([{ kind: 'create', element }]);
    return element.id;
  },

  /** Swaps an element for another with the same id (e.g. a note converted to a document), as one undo step. */
  replace(before: ZElement, after: ZElement) {
    commit([{ kind: 'delete', element: before }, { kind: 'create', element: after }]);
    set({ selection: [after.id], editingId: null });
  },

  /** Removes an element without leaving an undo step if its creation is the latest one. */
  discard(id: string) {
    const element = get().elements[id];
    if (!element) return;
    const forgotten = history.forgetCreate(id);
    commit([{ kind: 'delete', element }], !forgotten);
    set({ selection: get().selection.filter((s) => s !== id), editingId: get().editingId === id ? null : get().editingId, canUndo: history.canUndo });
  },

  createCard(boardId: string, x: number, y: number, opts: { edit?: boolean; content?: JSONContent; width?: number } = {}): string {
    return actions.create({ type: 'CARD', content: opts.content }, boardId, x, y, opts);
  },

  createBoard(boardId: string, x: number, y: number): string {
    return actions.create({ type: 'BOARD' }, boardId, x, y);
  },

  // ----- editing -----
  update(id: string, patch: ElementPatch) {
    const element = get().elements[id];
    if (!element) return;
    const changed = Object.entries(patch).some(([k, v]) => JSON.stringify((element as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v));
    if (changed) commit([updateOp(element, patch)]);
  },

  /** Applies the same change to several elements as one undo step (the properties bar). */
  updateMany(ids: string[], patch: ElementPatch) {
    const elements = get().elements;
    const ops = ids
      .map((id) => elements[id])
      .filter((e): e is ZElement => !!e && Object.entries(patch).some(([k, v]) => JSON.stringify((e as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)))
      .map((e) => updateOp(e, patch));
    commit(ops);
  },

  /** Saves edits while typing without creating undo steps (synced notes follow along). */
  setLive(id: string, patch: ElementPatch) {
    const elements = get().elements;
    const targets = 'content' in patch ? syncPeers(elements, id) : [id];
    commit(targets.map((t) => elements[t]).filter(Boolean).map((e) => updateOp(e, patch)), false);
  },

  /** Records a whole editing session as one undo step (covering every synced copy). */
  recordEdit(id: string, before: ElementPatch, after: ElementPatch) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const targets = 'content' in after ? syncPeers(get().elements, id) : [id];
    history.record(targets.map((t) => ({ kind: 'update' as const, id: t, before, after })));
    set({ canUndo: history.canUndo, canRedo: history.canRedo });
  },

  /** Makes a copy of a note that stays in sync with the original. */
  createSyncedCopy(id: string) {
    const card = get().elements[id];
    if (card?.type !== 'CARD') return;
    const group = card.syncGroup ?? nanoid();
    const copy: CardElement = { ...structuredClone(card), id: nanoid(), x: card.x + 2, y: card.y + 2, z: topZ(card.parentId ?? '') + 1, syncGroup: group, createdAt: now(), updatedAt: now() };
    const ops: Op[] = [{ kind: 'create', element: copy }];
    if (!card.syncGroup) ops.unshift(updateOp(card, { syncGroup: group }));
    commit(ops);
    set({ selection: [copy.id], toast: 'Синхронная копия: правка в одной меняет все' });
  },

  /** Stops a note from following its synced copies. */
  unsync(id: string) {
    const card = get().elements[id];
    if (card?.type !== 'CARD' || !card.syncGroup) return;
    commit([updateOp(card, { syncGroup: undefined })]);
  },

  // ----- board shortcuts and templates -----
  createAlias(targetId: string, parentId: string, x: number, y: number): string {
    const id = actions.insert({ type: 'ALIAS', targetId }, parentId, x, y);
    set({ selection: [id] });
    return id;
  },

  setTemplate(boardId: string, isTemplate: boolean) {
    actions.update(boardId, { isTemplate });
    set({ toast: isTemplate ? 'Доска стала шаблоном — она появится в выборе шаблонов' : 'Шаблон снова стал обычной доской' });
  },

  /** Copies the content of a template board onto a board. */
  applyTemplate(templateId: string, intoId: string) {
    const elements = get().elements;
    const tx: Op[] = [];
    let z = topZ(intoId);
    for (const child of Object.values(elements)) {
      if (child.parentId === templateId && child.section !== 'TRASH') copyTree(elements, child, intoId, tx, { z: ++z });
    }
    commit(tx);
  },

  // ----- comments -----
  addCommentMessage(id: string, text: string) {
    const c = get().elements[id];
    if (c?.type !== 'COMMENT' || !text.trim()) return;
    actions.update(id, { messages: [...c.messages, { id: nanoid(), text: text.trim(), at: now(), reactions: [] }] });
  },

  toggleReaction(id: string, messageId: string, emoji: string) {
    const c = get().elements[id];
    if (c?.type !== 'COMMENT') return;
    actions.update(id, {
      messages: c.messages.map((m) => (m.id !== messageId ? m : { ...m, reactions: m.reactions.includes(emoji) ? m.reactions.filter((r) => r !== emoji) : [...m.reactions, emoji] })),
    });
  },

  setContentLive(id: string, content: JSONContent) {
    actions.setLive(id, { content });
  },

  recordContentEdit(id: string, before: JSONContent, after: JSONContent) {
    actions.recordEdit(id, { content: before }, { content: after });
  },

  /**
   * Removes a note that was left empty. If the only undo step is its creation,
   * that step is dropped too, so the abandoned note leaves no trace.
   */
  discardEmptyCard(id: string) {
    const element = get().elements[id];
    if (!element || element.type !== 'CARD') return;
    const forgotten = history.forgetCreate(id);
    commit([{ kind: 'delete', element }], !forgotten);
    set({ selection: get().selection.filter((s) => s !== id), canUndo: history.canUndo });
  },

  setEditing(id: string | null) {
    set({ editingId: id, selection: id ? [id] : get().selection });
  },

  // ----- selection -----
  select(ids: string[]) {
    set({ selection: ids, editingId: null });
  },

  toggleSelect(id: string) {
    const selection = get().selection;
    set({ selection: selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id], editingId: null });
  },

  selectAll() {
    set({ selection: canvasChildren(get().elements, get().boardId).map((e) => e.id), editingId: null });
  },

  clearSelection() {
    set({ selection: [], editingId: null });
  },

  // ----- arrangement -----
  moveTo(moves: { id: string; x: number; y: number }[]) {
    const elements = get().elements;
    const tx: Op[] = [];
    for (const m of moves) {
      const e = elements[m.id];
      if (!e || e.locked) continue;
      const x = Math.round(m.x);
      const y = Math.round(m.y);
      if (e.x !== x || e.y !== y) tx.push(updateOp(e, { x, y }));
    }
    commit(tx);
  },

  /**
   * Puts elements on a board's canvas at the given positions, taking them out of
   * columns or panels if needed.
   */
  placeOnCanvas(boardId: string, moves: { id: string; x: number; y: number }[]) {
    const elements = get().elements;
    let z = topZ(boardId);
    const tx = moves
      .filter((m) => elements[m.id] && !elements[m.id].locked)
      .map((m) => {
        const e = elements[m.id];
        const patch: ElementPatch = { x: Math.round(m.x), y: Math.round(m.y) };
        if (e.parentId !== boardId || e.section !== 'CANVAS') Object.assign(patch, { parentId: boardId, section: 'CANVAS', z: ++z });
        return updateOp(e, patch);
      });
    commit(tx);
  },

  nudge(dx: number, dy: number) {
    const { elements, selection } = get();
    actions.moveTo(
      selection
        .map((id) => elements[id])
        .filter((e) => e && elements[e.parentId ?? '']?.type !== 'COLUMN' && e.section === 'CANVAS')
        .map((e) => ({ id: e.id, x: e.x + dx, y: e.y + dy })),
    );
  },

  resize(id: string, width: number) {
    actions.update(id, { width: Math.max(12, Math.round(width)) });
  },

  /** Inserts elements into a column before the item at `index` (end if omitted). */
  insertIntoColumn(ids: string[], columnId: string, index?: number) {
    const elements = get().elements;
    const items = columnChildren(elements, columnId).filter((e) => !ids.includes(e.id));
    const at = index === undefined ? items.length : Math.max(0, Math.min(index, items.length));
    const prev = at > 0 ? items[at - 1].z : (items[0]?.z ?? 1) - 1;
    const next = at < items.length ? items[at].z : prev + ids.length + 1;
    const movable = ids.filter((id) => elements[id] && fitsInColumn(elements[id].type) && !elements[id].locked);
    const step = (next - prev) / (movable.length + 1);
    commit(movable.map((id, i) => updateOp(elements[id], { parentId: columnId, section: 'CANVAS', z: prev + step * (i + 1) })));
    if (movable.length < ids.length) set({ toast: 'Колонку нельзя положить в колонку' });
  },

  /** Moves elements into the Unsorted panel of a board. */
  moveToInbox(ids: string[], boardId: string) {
    const elements = get().elements;
    let z = lastInboxOrder(boardId);
    commit(ids.filter((id) => elements[id] && id !== boardId).map((id) => updateOp(elements[id], { parentId: boardId, section: 'INBOX', z: ++z })));
    set({ selection: [], editingId: null });
  },

  /** Moves elements into another board; like the reference app, they land in its Unsorted panel. */
  moveToBoard(ids: string[], targetId: string) {
    const elements = get().elements;
    const target = elements[targetId];
    if (!target || target.type !== 'BOARD') return;
    const movable = ids.filter((id) => id !== targetId && elements[id] && !isAncestor(elements, id, targetId));
    if (movable.length === 0) return;
    actions.moveToInbox(movable, targetId);
    set({ toast: `Перемещено в «${target.title}» → Неразобранное: ${movable.length}` });
  },

  bringToFront() {
    const { elements, selection, boardId } = get();
    let z = topZ(boardId);
    commit(sortByZ(selection.map((id) => elements[id]).filter((e) => e?.parentId === boardId)).map((e) => updateOp(e, { z: ++z })));
  },

  sendToBack() {
    const { elements, selection, boardId } = get();
    let z = bottomZ(boardId);
    commit(sortByZ(selection.map((id) => elements[id]).filter((e) => e?.parentId === boardId)).reverse().map((e) => updateOp(e, { z: --z })));
  },

  setLocked(ids: string[], locked: boolean) {
    const elements = get().elements;
    commit(ids.map((id) => elements[id]).filter(Boolean).map((e) => updateOp(e, { locked })));
  },

  /** Copies elements (boards and columns with all their content), offset by dx/dy grid units. */
  duplicate(ids: string[], dx = 2, dy = 2) {
    const elements = get().elements;
    const tx: Op[] = [];
    const newIds: string[] = [];
    for (const id of ids) {
      const original = elements[id];
      if (!original) continue;
      const inColumn = elements[original.parentId ?? '']?.type === 'COLUMN';
      const overrides = inColumn ? { z: original.z + 0.5 / (newIds.length + 1) } : { x: Math.round(original.x + dx), y: Math.round(original.y + dy), z: topZ(original.parentId ?? '') + newIds.length + 1 };
      newIds.push(copyTree(elements, original, original.parentId, tx, overrides));
    }
    commit(tx);
    set({ selection: newIds, editingId: null });
  },

  /** Wraps the given canvas elements into a new column placed where the first one was. */
  groupIntoColumn(ids: string[]) {
    const { elements, boardId } = get();
    const items = ids.map((id) => elements[id]).filter((e) => e && fitsInColumn(e.type) && e.parentId === boardId);
    if (items.length === 0) return;
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const column = makeElement({ type: 'COLUMN' }, boardId, Math.min(...items.map((e) => e.x)), Math.min(...items.map((e) => e.y)), topZ(boardId) + 1);
    const tx: Op[] = [{ kind: 'create', element: column }, ...items.map((e, i) => updateOp(e, { parentId: column.id, section: 'CANVAS', z: i + 1 }))];
    commit(tx);
    set({ selection: [column.id], editingId: column.id });
  },

  /** Moves elements to the trash (they can be restored later). */
  trash(ids: string[]) {
    const elements = get().elements;
    commit(ids.map((id) => elements[id]).filter((e) => e && !e.locked && e.id !== HOME_ID).map((e) => updateOp(e, { section: 'TRASH' })));
    set({ selection: [], editingId: null });
  },

  /** Brings trashed elements back to where they were. */
  restore(ids: string[]) {
    const elements = get().elements;
    commit(ids.map((id) => elements[id]).filter((e) => e?.section === 'TRASH').map((e) => updateOp(e, { section: 'CANVAS' })));
    set({ selection: ids, toast: 'Восстановлено' });
  },

  /** Permanently deletes everything in a board's trash. */
  emptyTrash(boardId: string) {
    const elements = get().elements;
    const ops: Op[] = [];
    for (const e of trashChildren(elements, boardId)) {
      for (const id of [...descendants(elements, e.id), e.id]) ops.push({ kind: 'delete', element: elements[id] });
    }
    commit(ops);
  },

  /** Recreates copied elements (with all their content) at a grid position on the current board. */
  paste(roots: ZElement[], all: ZElement[], at: { x: number; y: number }) {
    const { boardId } = get();
    const byId: ElementMap = {};
    for (const e of all) byId[e.id] = e;
    const minX = Math.min(...roots.map((e) => e.x));
    const minY = Math.min(...roots.map((e) => e.y));
    const tx: Op[] = [];
    let z = topZ(boardId);
    const ids = roots.map((root) => copyTree(byId, root, boardId, tx, { x: Math.round(at.x + root.x - minX), y: Math.round(at.y + root.y - minY), z: ++z, section: 'CANVAS' }));
    commit(tx);
    set({ selection: ids, editingId: null });
  },

  // ----- labels -----
  createLabel(name: string, applyTo: string[] = []): string {
    const existing = allLabels(get().elements).length;
    const element = {
      ...makeBase(null, 0, 0, 0, 0),
      type: 'LABEL' as const,
      name: name.trim(),
      color: LABEL_COLORS[existing % LABEL_COLORS.length],
    };
    const elements = get().elements;
    const ops: Op[] = [{ kind: 'create', element }];
    for (const id of applyTo) {
      const e = elements[id];
      if (e) ops.push(updateOp(e, { labels: [...(e.labels ?? []), element.id] }));
    }
    commit(ops);
    return element.id;
  },

  /** Adds the label to all given elements, or removes it if they all have it already. */
  toggleLabel(ids: string[], labelId: string) {
    const elements = get().elements;
    const targets = ids.map((id) => elements[id]).filter(Boolean);
    const all = targets.every((e) => e.labels?.includes(labelId));
    commit(
      targets
        .filter((e) => all || !e.labels?.includes(labelId))
        .map((e) => updateOp(e, { labels: all ? (e.labels ?? []).filter((l) => l !== labelId) : [...(e.labels ?? []), labelId] })),
    );
  },

  updateLabel(labelId: string, patch: { name?: string; color?: LabelElement['color'] }) {
    if (get().elements[labelId]?.type !== 'LABEL') return;
    const after: ElementPatch = {};
    if (patch.name?.trim()) after.name = patch.name.trim();
    if (patch.color) after.color = patch.color;
    actions.update(labelId, after);
  },

  /** Deletes a label everywhere it is used. */
  deleteLabel(labelId: string) {
    const elements = get().elements;
    const label = elements[labelId];
    if (!label) return;
    const ops: Op[] = Object.values(elements)
      .filter((e) => e.labels?.includes(labelId))
      .map((e) => updateOp(e, { labels: e.labels!.filter((l) => l !== labelId) }));
    ops.push({ kind: 'delete', element: label });
    commit(ops);
  },

  // ----- navigation -----
  openBoard(id: string) {
    const { boardId, back, elements, viewedAt } = get();
    if (id === boardId || !elements[id] || elements[id].type !== 'BOARD') return;
    set({ boardId: id, back: [...back, boardId], forward: [], selection: [], editingId: null, viewedAt: { ...viewedAt, [id]: now() } });
    schedulePrefs();
  },

  goBack() {
    const { back, boardId, forward } = get();
    const prev = back[back.length - 1];
    if (!prev) return;
    set({ boardId: prev, back: back.slice(0, -1), forward: [boardId, ...forward], selection: [], editingId: null });
  },

  goForward() {
    const { back, boardId, forward } = get();
    const next = forward[0];
    if (!next) return;
    set({ boardId: next, back: [...back, boardId], forward: forward.slice(1), selection: [], editingId: null });
  },

  goParent() {
    const { boardId, elements } = get();
    const parent = elements[boardId]?.parentId;
    if (parent) actions.openBoard(parent);
  },

  // ----- view -----
  setCamera(boardId: string, camera: Camera) {
    set({ cameras: { ...get().cameras, [boardId]: camera } });
    schedulePrefs();
  },

  setPanel(panel: Panel) {
    set({ panel: get().panel === panel ? null : panel });
  },

  toggleTheme() {
    set({ theme: get().theme === 'dark' ? 'light' : 'dark' });
    savePrefs();
  },

  showToast(message: string) {
    set({ toast: message });
  },

  hideToast() {
    set({ toast: null });
  },
};

// ---------- queries ----------
export function canvasChildren(elements: ElementMap, boardId: string): ZElement[] {
  return sortByZ(Object.values(elements).filter((e) => e.parentId === boardId && e.section === 'CANVAS'));
}

export function columnChildren(elements: ElementMap, columnId: string): ZElement[] {
  return sortByZ(Object.values(elements).filter((e) => e.parentId === columnId && e.section !== 'TRASH'));
}

export function inboxChildren(elements: ElementMap, boardId: string): ZElement[] {
  return sortByZ(Object.values(elements).filter((e) => e.parentId === boardId && e.section === 'INBOX'));
}

/** Trashed elements that belonged to this board, directly or inside its columns. */
export function trashChildren(elements: ElementMap, boardId: string): ZElement[] {
  return Object.values(elements)
    .filter((e) => e.section === 'TRASH' && (e.parentId === boardId || (elements[e.parentId ?? '']?.type === 'COLUMN' && elements[e.parentId ?? ''].parentId === boardId)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Ids of a note and its live synced copies (just the note if it is not synced). */
export function syncPeers(elements: ElementMap, id: string): string[] {
  const card = elements[id];
  if (card?.type !== 'CARD' || !card.syncGroup) return [id];
  return Object.values(elements)
    .filter((e) => e.type === 'CARD' && e.syncGroup === card.syncGroup && e.section !== 'TRASH')
    .map((e) => e.id);
}

/** All label definitions, alphabetically. */
export function allLabels(elements: ElementMap): LabelElement[] {
  return Object.values(elements)
    .filter((e): e is LabelElement => e.type === 'LABEL')
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** How many elements use each label. */
export function labelUsage(elements: ElementMap): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const e of Object.values(elements)) {
    if (e.section === 'TRASH') continue;
    for (const l of e.labels ?? []) usage[l] = (usage[l] ?? 0) + 1;
  }
  return usage;
}

/** Number of cards on a board, counting what is inside its columns. */
export function countChildren(elements: ElementMap, boardId: string): number {
  let n = 0;
  for (const e of Object.values(elements)) {
    if (e.section === 'TRASH' || e.type === 'LINE') continue;
    if (e.parentId === boardId) n += e.type === 'COLUMN' ? 0 : 1;
    else if (elements[e.parentId ?? '']?.type === 'COLUMN' && elements[e.parentId ?? ''].parentId === boardId && elements[e.parentId ?? ''].section !== 'TRASH') n++;
  }
  return n;
}

/** The board an element is shown on (walking up through columns). */
export function containingBoard(elements: ElementMap, id: string): string | null {
  let parent = elements[id]?.parentId ?? null;
  while (parent && elements[parent]?.type === 'COLUMN') parent = elements[parent].parentId;
  return parent;
}

/** Board ids from home down to `boardId`. */
export function boardPath(elements: ElementMap, boardId: string): BoardElement[] {
  const path: BoardElement[] = [];
  let current: ZElement | undefined = elements[boardId];
  while (current) {
    if (current.type === 'BOARD') path.unshift(current);
    current = current.parentId ? elements[current.parentId] : undefined;
  }
  return path;
}

/** All ids contained in an element (boards and columns), recursively. */
export function descendants(elements: ElementMap, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  const all = Object.values(elements);
  while (stack.length) {
    const current = stack.pop()!;
    for (const e of all) {
      if (e.parentId === current) {
        out.push(e.id);
        stack.push(e.id);
      }
    }
  }
  return out;
}

function sortByZ(list: ZElement[]): ZElement[] {
  return list.slice().sort((a, b) => a.z - b.z);
}

function topZ(parentId: string): number {
  const list = canvasChildren(get().elements, parentId);
  return list.length ? list[list.length - 1].z : 0;
}

function bottomZ(boardId: string): number {
  const list = canvasChildren(get().elements, boardId);
  return list.length ? list[0].z : 0;
}

function lastOrder(columnId: string): number {
  const list = columnChildren(get().elements, columnId);
  return list.length ? list[list.length - 1].z : 0;
}

function lastInboxOrder(boardId: string): number {
  const list = inboxChildren(get().elements, boardId);
  return list.length ? list[list.length - 1].z : 0;
}

const BOARD_COLORS: BoardElement['color'][] = ['blue', 'orange', 'green', 'purple', 'pink', 'yellow'];
function nextBoardColor(parentId: string): BoardElement['color'] {
  const boards = Object.values(get().elements).filter((e) => e.parentId === parentId && e.type === 'BOARD').length;
  return BOARD_COLORS[boards % BOARD_COLORS.length];
}

/** True if `ancestorId` contains `id` somewhere above it (or is it). */
function isAncestor(elements: ElementMap, ancestorId: string, id: string): boolean {
  let current: string | null = id;
  while (current) {
    if (current === ancestorId) return true;
    current = elements[current]?.parentId ?? null;
  }
  return false;
}

function copyTree(elements: ElementMap, original: ZElement, parentId: string | null, tx: Op[], overrides: Partial<ZElement> = {}): string {
  const id = nanoid();
  const copy = { ...structuredClone(original), ...overrides, id, parentId, createdAt: now(), updatedAt: now() } as ZElement;
  if (copy.type === 'TASK_LIST') copy.items = copy.items.map((item) => ({ ...item, id: nanoid() }));
  // Duplicates are ordinary notes; only "synced copy" links them.
  if (copy.type === 'CARD') delete copy.syncGroup;
  tx.push({ kind: 'create', element: copy });
  if (original.type === 'BOARD' || original.type === 'COLUMN') {
    for (const child of Object.values(elements)) {
      if (child.parentId === original.id && child.section !== 'TRASH') copyTree(elements, child, id, tx);
    }
  }
  return id;
}

/** Test hook: resets module state between tests. */
export function __resetForTests() {
  repo = null;
  pendingChanged.clear();
  pendingRemoved.clear();
}
