import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTransaction, History, invertTransaction, updateOp, type Transaction } from './ops';
import { actions, boardPath, canvasChildren, flushPersist, useStore, __resetForTests } from './store';
import { HOME_ID, type CardElement, type ZElement } from './types';
import { IdbRepo } from '../storage/idbRepo';

const card = (id: string, extra: Partial<CardElement> = {}): CardElement => ({
  id,
  type: 'CARD',
  parentId: HOME_ID,
  section: 'CANVAS',
  x: 0,
  y: 0,
  width: 40,
  z: 1,
  content: { type: 'doc', content: [] },
  color: 'default',
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

describe('operations', () => {
  it('applies and inverts create, update and delete', () => {
    const a = card('a');
    const tx: Transaction = [{ kind: 'create', element: a }, updateOp(a, { x: 5 })];
    const after = applyTransaction({}, tx).elements;
    expect(after.a.x).toBe(5);
    const undone = applyTransaction(after, invertTransaction(tx)).elements;
    expect(undone.a).toBeUndefined();
  });

  it('keeps undo and redo stacks consistent', () => {
    const h = new History();
    const a = card('a');
    h.record([{ kind: 'create', element: a }]);
    h.record([updateOp(a, { y: 3 })]);
    expect(h.undo()).toEqual([{ kind: 'update', id: 'a', before: { y: 3 }, after: { y: 0 } }]);
    expect(h.canRedo).toBe(true);
    expect(h.redo()?.[0]).toMatchObject({ kind: 'update', after: { y: 3 } });
    h.undo();
    h.record([updateOp(a, { x: 1 })]);
    expect(h.canRedo).toBe(false);
  });
});

describe('store', () => {
  let dbName = 0;
  beforeEach(async () => {
    __resetForTests();
    useStore.setState({ elements: {}, boardId: HOME_ID, back: [], forward: [], selection: [], editingId: null, ready: false });
    await actions.init(await IdbRepo.open(`test-${dbName++}`));
  });

  it('seeds the home board on first launch', () => {
    const { elements } = useStore.getState();
    expect(elements[HOME_ID].type).toBe('BOARD');
    expect(canvasChildren(elements, HOME_ID).length).toBeGreaterThan(0);
  });

  it('creates a note, undoes and redoes it', () => {
    const id = actions.createCard(HOME_ID, 10, 20);
    expect(useStore.getState().elements[id]).toMatchObject({ x: 10, y: 20, parentId: HOME_ID });
    actions.undo();
    expect(useStore.getState().elements[id]).toBeUndefined();
    actions.redo();
    expect(useStore.getState().elements[id]).toBeDefined();
  });

  it('navigates into nested boards and back', () => {
    const boardId = actions.createBoard(HOME_ID, 0, 30);
    actions.openBoard(boardId);
    const inner = actions.createBoard(boardId, 0, 0);
    actions.openBoard(inner);
    const path = boardPath(useStore.getState().elements, inner).map((b) => b.id);
    expect(path).toEqual([HOME_ID, boardId, inner]);
    actions.goBack();
    expect(useStore.getState().boardId).toBe(boardId);
    actions.goParent();
    expect(useStore.getState().boardId).toBe(HOME_ID);
  });

  it('moves elements into a board and never into themselves', () => {
    const boardId = actions.createBoard(HOME_ID, 0, 30);
    const noteId = actions.createCard(HOME_ID, 0, 0);
    actions.moveToBoard([noteId, boardId], boardId);
    const { elements } = useStore.getState();
    expect(elements[noteId].parentId).toBe(boardId);
    expect(elements[boardId].parentId).toBe(HOME_ID);
  });

  it('duplicates a board with its content', () => {
    const boardId = actions.createBoard(HOME_ID, 0, 30);
    actions.createCard(boardId, 0, 0);
    actions.duplicate([boardId]);
    const copyId = useStore.getState().selection[0];
    const { elements } = useStore.getState();
    expect(copyId).not.toBe(boardId);
    expect(Object.values(elements).filter((e: ZElement) => e.parentId === copyId)).toHaveLength(1);
  });

  it('records a whole note editing session as one undo step', () => {
    const id = actions.createCard(HOME_ID, 0, 0);
    const before = (useStore.getState().elements[id] as CardElement).content;
    const typed = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Привет' }] }] };
    actions.setContentLive(id, typed);
    actions.recordContentEdit(id, before, typed);
    actions.undo();
    expect((useStore.getState().elements[id] as CardElement).content).toEqual(before);
  });

  it('persists changes and reloads them', async () => {
    const name = `persist-${dbName++}`;
    __resetForTests();
    await actions.init(await IdbRepo.open(name));
    const id = actions.createCard(HOME_ID, 7, 9);
    await flushPersist();
    __resetForTests();
    useStore.setState({ elements: {} });
    await actions.init(await IdbRepo.open(name));
    expect(useStore.getState().elements[id]).toMatchObject({ x: 7, y: 9 });
  });

  it('trashes elements and hides them from the canvas', () => {
    const id = actions.createCard(HOME_ID, 0, 0);
    actions.trash([id]);
    expect(canvasChildren(useStore.getState().elements, HOME_ID).some((e) => e.id === id)).toBe(false);
    actions.undo();
    expect(canvasChildren(useStore.getState().elements, HOME_ID).some((e) => e.id === id)).toBe(true);
  });
});

describe('stage 1 organisation', () => {
  let n = 0;
  beforeEach(async () => {
    __resetForTests();
    useStore.setState({ elements: {}, boardId: HOME_ID, back: [], forward: [], selection: [], editingId: null, ready: false });
    await actions.init(await IdbRepo.open(`stage1-${n++}`));
  });

  it('inserts cards into a column in order and takes them out again', async () => {
    const { columnChildren } = await import('./store');
    const col = actions.create({ type: 'COLUMN' }, HOME_ID, 0, 40);
    const a = actions.createCard(HOME_ID, 0, 0, { edit: false });
    const b = actions.createCard(HOME_ID, 0, 0, { edit: false });
    actions.insertIntoColumn([a], col);
    actions.insertIntoColumn([b], col, 0);
    expect(columnChildren(useStore.getState().elements, col).map((e) => e.id)).toEqual([b, a]);
    actions.placeOnCanvas(HOME_ID, [{ id: b, x: 60, y: 60 }]);
    expect(useStore.getState().elements[b]).toMatchObject({ parentId: HOME_ID, x: 60, y: 60 });
    expect(columnChildren(useStore.getState().elements, col).map((e) => e.id)).toEqual([a]);
  });

  it('refuses to put a column into a column', () => {
    const outer = actions.create({ type: 'COLUMN' }, HOME_ID, 0, 40);
    const inner = actions.create({ type: 'COLUMN' }, HOME_ID, 50, 40);
    actions.insertIntoColumn([inner], outer);
    expect(useStore.getState().elements[inner].parentId).toBe(HOME_ID);
  });

  it('groups selected cards into a new column, top to bottom', async () => {
    const { columnChildren } = await import('./store');
    const top = actions.createCard(HOME_ID, 10, 10, { edit: false });
    const bottom = actions.createCard(HOME_ID, 10, 50, { edit: false });
    actions.groupIntoColumn([bottom, top]);
    const col = useStore.getState().selection[0];
    expect(columnChildren(useStore.getState().elements, col).map((e) => e.id)).toEqual([top, bottom]);
    actions.undo();
    expect(useStore.getState().elements[top].parentId).toBe(HOME_ID);
  });

  it('moves elements dropped on a board into its Unsorted panel', async () => {
    const { inboxChildren } = await import('./store');
    const board = actions.createBoard(HOME_ID, 0, 40);
    const note = actions.createCard(HOME_ID, 0, 0, { edit: false });
    actions.moveToBoard([note], board);
    expect(inboxChildren(useStore.getState().elements, board).map((e) => e.id)).toEqual([note]);
  });

  it('restores from the trash and empties it for good', async () => {
    const { trashChildren } = await import('./store');
    const a = actions.createCard(HOME_ID, 0, 0, { edit: false });
    const b = actions.createBoard(HOME_ID, 0, 30);
    actions.createCard(b, 0, 0, { edit: false });
    actions.trash([a, b]);
    expect(trashChildren(useStore.getState().elements, HOME_ID)).toHaveLength(2);
    actions.restore([a]);
    expect(useStore.getState().elements[a].section).toBe('CANVAS');
    actions.emptyTrash(HOME_ID);
    const { elements } = useStore.getState();
    expect(elements[b]).toBeUndefined();
    expect(Object.values(elements).some((e) => e.parentId === b)).toBe(false);
  });

  it('pastes copied elements with fresh ids, including board content', () => {
    const board = actions.createBoard(HOME_ID, 5, 5);
    actions.createCard(board, 0, 0, { edit: false });
    const { elements } = useStore.getState();
    const all = [elements[board], ...Object.values(elements).filter((e) => e.parentId === board)];
    actions.paste([elements[board]], all, { x: 100, y: 100 });
    const pasted = useStore.getState().selection[0];
    expect(pasted).not.toBe(board);
    expect(useStore.getState().elements[pasted]).toMatchObject({ x: 100, y: 100, parentId: HOME_ID });
    expect(Object.values(useStore.getState().elements).filter((e) => e.parentId === pasted)).toHaveLength(1);
  });
});

describe('stage 2c model', () => {
  let n = 0;
  beforeEach(async () => {
    __resetForTests();
    useStore.setState({ elements: {}, boardId: HOME_ID, back: [], forward: [], selection: [], editingId: null, ready: false });
    await actions.init(await IdbRepo.open(`stage2c-${n++}`));
  });

  it('keeps synced copies of a note identical, including undo', () => {
    const id = actions.createCard(HOME_ID, 0, 0, { edit: false });
    actions.createSyncedCopy(id);
    const copy = useStore.getState().selection[0];
    const before = (useStore.getState().elements[id] as CardElement).content;
    const typed = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Синий час' }] }] };
    actions.setContentLive(copy, typed);
    actions.recordContentEdit(copy, before, typed);
    expect((useStore.getState().elements[id] as CardElement).content).toEqual(typed);
    actions.undo();
    expect((useStore.getState().elements[id] as CardElement).content).toEqual(before);
    expect((useStore.getState().elements[copy] as CardElement).content).toEqual(before);
    actions.unsync(copy);
    actions.setContentLive(copy, typed);
    expect((useStore.getState().elements[id] as CardElement).content).toEqual(before);
  });

  it('applies a template board by copying its content', () => {
    const template = actions.createBoard(HOME_ID, 0, 30);
    actions.createCard(template, 0, 0, { edit: false });
    actions.setTemplate(template, true);
    const target = actions.createBoard(HOME_ID, 20, 30);
    actions.applyTemplate(template, target);
    expect(Object.values(useStore.getState().elements).filter((e: ZElement) => e.parentId === target)).toHaveLength(1);
    expect(Object.values(useStore.getState().elements).filter((e: ZElement) => e.parentId === template)).toHaveLength(1);
  });
});
