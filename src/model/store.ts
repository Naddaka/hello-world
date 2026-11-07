import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { JSONContent } from '@tiptap/core';
import { applyTransaction, History, updateOp, type ElementMap, type Op, type Transaction } from './ops';
import {
  DEFAULT_WIDTH,
  EMPTY_DOC,
  HOME_ID,
  type BoardElement,
  type CardElement,
  type ElementPatch,
  type Section,
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

interface State {
  ready: boolean;
  elements: ElementMap;
  boardId: string;
  back: string[];
  forward: string[];
  selection: string[];
  editingId: string | null;
  cameras: Record<string, Camera>;
  theme: Theme;
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

function loadPrefs(): { theme?: Theme; cameras?: Record<string, Camera> } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function savePrefs() {
  const { theme, cameras } = useStore.getState();
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme, cameras }));
  } catch {
    /* storage unavailable: preferences are a convenience only */
  }
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
  theme: 'light',
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

function applyHistory(tx: Transaction | null) {
  if (!tx) return;
  const { elements, changed, removed } = applyTransaction(get().elements, tx);
  const selection = get().selection.filter((id) => elements[id] && elements[id].section === 'CANVAS');
  set({ elements, selection, editingId: null, canUndo: history.canUndo, canRedo: history.canRedo, toast: null });
  schedulePersist(changed, removed);
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
    set({
      ready: true,
      elements,
      theme: prefs.theme ?? systemTheme(),
      cameras: prefs.cameras ?? {},
    });
  },

  undo() {
    applyHistory(history.undo());
  },

  redo() {
    applyHistory(history.redo());
  },

  // ----- creation -----
  createCard(boardId: string, x: number, y: number, opts: { edit?: boolean; content?: JSONContent; width?: number } = {}): string {
    const element: CardElement = {
      id: nanoid(),
      type: 'CARD',
      parentId: boardId,
      section: 'CANVAS',
      x: Math.round(x),
      y: Math.round(y),
      width: opts.width ?? DEFAULT_WIDTH.CARD,
      z: topZ(boardId) + 1,
      content: opts.content ?? EMPTY_DOC,
      color: 'default',
      createdAt: now(),
      updatedAt: now(),
    };
    commit([{ kind: 'create', element }]);
    set({ selection: [element.id], editingId: opts.edit === false ? null : element.id });
    return element.id;
  },

  createBoard(boardId: string, x: number, y: number): string {
    const element: BoardElement = {
      id: nanoid(),
      type: 'BOARD',
      parentId: boardId,
      section: 'CANVAS',
      x: Math.round(x),
      y: Math.round(y),
      width: DEFAULT_WIDTH.BOARD,
      z: topZ(boardId) + 1,
      title: 'Новая доска',
      color: nextBoardColor(boardId),
      createdAt: now(),
      updatedAt: now(),
    };
    commit([{ kind: 'create', element }]);
    set({ selection: [element.id], editingId: element.id });
    return element.id;
  },

  // ----- editing -----
  update(id: string, patch: ElementPatch) {
    const element = get().elements[id];
    if (!element) return;
    const changed = Object.entries(patch).some(([k, v]) => JSON.stringify((element as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v));
    if (changed) commit([updateOp(element, patch)]);
  },

  /** Saves note text while typing without creating undo steps. */
  setContentLive(id: string, content: JSONContent) {
    const element = get().elements[id];
    if (!element || element.type !== 'CARD') return;
    commit([updateOp(element, { content })], false);
  },

  /** Records the whole editing session of a note as one undo step. */
  recordContentEdit(id: string, before: JSONContent, after: JSONContent) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    history.record([{ kind: 'update', id, before: { content: before }, after: { content: after } }]);
    set({ canUndo: history.canUndo, canRedo: history.canRedo });
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

  nudge(dx: number, dy: number) {
    const { elements, selection } = get();
    actions.moveTo(selection.map((id) => elements[id]).filter(Boolean).map((e) => ({ id: e.id, x: e.x + dx, y: e.y + dy })));
  },

  resize(id: string, width: number) {
    actions.update(id, { width: Math.max(12, Math.round(width)) });
  },

  /** Moves elements into another board's canvas, cascading them from its top-left. */
  moveToBoard(ids: string[], targetId: string) {
    const elements = get().elements;
    const target = elements[targetId];
    if (!target || target.type !== 'BOARD') return;
    const movable = ids.filter((id) => id !== targetId && elements[id] && !isAncestor(elements, id, targetId));
    if (movable.length === 0) return;
    let z = topZ(targetId);
    const tx = movable.map((id, i) => updateOp(elements[id], { parentId: targetId, section: 'CANVAS', x: 4 + i * 3, y: 4 + i * 3, z: ++z }));
    commit(tx);
    set({ selection: [], editingId: null, toast: `Перемещено в «${target.title}»: ${movable.length}` });
  },

  bringToFront() {
    const { elements, selection, boardId } = get();
    let z = topZ(boardId);
    commit(sortByZ(selection.map((id) => elements[id]).filter(Boolean)).map((e) => updateOp(e, { z: ++z })));
  },

  sendToBack() {
    const { elements, selection, boardId } = get();
    let z = bottomZ(boardId);
    commit(sortByZ(selection.map((id) => elements[id]).filter(Boolean)).reverse().map((e) => updateOp(e, { z: --z })));
  },

  setLocked(ids: string[], locked: boolean) {
    const elements = get().elements;
    commit(ids.map((id) => elements[id]).filter(Boolean).map((e) => updateOp(e, { locked })));
  },

  /** Copies elements (boards with all their content), offset by dx/dy grid units. */
  duplicate(ids: string[], dx = 2, dy = 2) {
    const elements = get().elements;
    const tx: Op[] = [];
    const newIds: string[] = [];
    let z = topZ(get().boardId);
    for (const id of ids) {
      const original = elements[id];
      if (!original) continue;
      const copyId = copyTree(elements, original, original.parentId, tx, { x: Math.round(original.x + dx), y: Math.round(original.y + dy), z: ++z });
      newIds.push(copyId);
    }
    commit(tx);
    set({ selection: newIds, editingId: null });
  },

  /** Moves elements to the board's trash (they can be restored later). */
  trash(ids: string[]) {
    const elements = get().elements;
    commit(ids.map((id) => elements[id]).filter(Boolean).map((e) => updateOp(e, { section: 'TRASH' as Section })));
    set({ selection: [], editingId: null });
  },

  // ----- navigation -----
  openBoard(id: string) {
    const { boardId, back, elements } = get();
    if (id === boardId || !elements[id] || elements[id].type !== 'BOARD') return;
    set({ boardId: id, back: [...back, boardId], forward: [], selection: [], editingId: null });
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

let prefsTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePrefs() {
  if (prefsTimer) clearTimeout(prefsTimer);
  prefsTimer = setTimeout(savePrefs, 400);
}

// ---------- helpers ----------
export function canvasChildren(elements: ElementMap, boardId: string): ZElement[] {
  return sortByZ(Object.values(elements).filter((e) => e.parentId === boardId && e.section === 'CANVAS'));
}

export function countChildren(elements: ElementMap, boardId: string): number {
  let n = 0;
  for (const e of Object.values(elements)) if (e.parentId === boardId && e.section !== 'TRASH') n++;
  return n;
}

/** Board ids from home down to `boardId`. */
export function boardPath(elements: ElementMap, boardId: string): BoardElement[] {
  const path: BoardElement[] = [];
  let current: ZElement | undefined = elements[boardId];
  while (current && current.type === 'BOARD') {
    path.unshift(current);
    current = current.parentId ? elements[current.parentId] : undefined;
  }
  return path;
}

function sortByZ(list: ZElement[]): ZElement[] {
  return list.slice().sort((a, b) => a.z - b.z);
}

function topZ(boardId: string): number {
  const list = canvasChildren(get().elements, boardId);
  return list.length ? list[list.length - 1].z : 0;
}

function bottomZ(boardId: string): number {
  const list = canvasChildren(get().elements, boardId);
  return list.length ? list[0].z : 0;
}

const BOARD_COLORS: BoardElement['color'][] = ['blue', 'orange', 'green', 'purple', 'pink', 'yellow'];
function nextBoardColor(boardId: string): BoardElement['color'] {
  const boards = Object.values(get().elements).filter((e) => e.parentId === boardId && e.type === 'BOARD').length;
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
  tx.push({ kind: 'create', element: copy });
  if (original.type === 'BOARD') {
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
