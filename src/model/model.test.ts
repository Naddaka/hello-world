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
