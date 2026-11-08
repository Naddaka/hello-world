import type { ElementPatch, ZElement } from './types';

/**
 * Every change to the document is expressed as operations. A transaction is a
 * list of operations applied together; it is the unit of undo/redo and of
 * persistence, and later of synchronisation.
 */
export type Op =
  | { kind: 'create'; element: ZElement }
  | { kind: 'delete'; element: ZElement }
  | { kind: 'update'; id: string; before: ElementPatch; after: ElementPatch };

export type Transaction = Op[];

export type ElementMap = Record<string, ZElement>;

/** Applies a transaction and returns the new map plus the ids it touched. */
export function applyTransaction(elements: ElementMap, tx: Transaction): { elements: ElementMap; changed: Set<string>; removed: Set<string> } {
  const next: ElementMap = { ...elements };
  const changed = new Set<string>();
  const removed = new Set<string>();
  for (const op of tx) {
    switch (op.kind) {
      case 'create':
        next[op.element.id] = op.element;
        changed.add(op.element.id);
        removed.delete(op.element.id);
        break;
      case 'delete':
        delete next[op.element.id];
        removed.add(op.element.id);
        changed.delete(op.element.id);
        break;
      case 'update': {
        const current = next[op.id];
        if (!current) break;
        next[op.id] = { ...current, ...op.after } as ZElement;
        changed.add(op.id);
        break;
      }
    }
  }
  return { elements: next, changed, removed };
}

/** Returns the transaction that undoes `tx`. */
export function invertTransaction(tx: Transaction): Transaction {
  return tx
    .slice()
    .reverse()
    .map((op): Op => {
      switch (op.kind) {
        case 'create':
          return { kind: 'delete', element: op.element };
        case 'delete':
          return { kind: 'create', element: op.element };
        case 'update':
          return { kind: 'update', id: op.id, before: op.after, after: op.before };
      }
    });
}

/** Builds an update op that records the previous values of the patched fields. */
export function updateOp(element: ZElement, after: ElementPatch): Op {
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    before[key] = (element as unknown as Record<string, unknown>)[key];
  }
  return { kind: 'update', id: element.id, before: before as ElementPatch, after };
}

/** Undo/redo stacks of transactions. */
export class History {
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];

  constructor(private readonly limit = 500) {}

  record(tx: Transaction) {
    if (tx.length === 0) return;
    this.undoStack.push(tx);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Returns the transaction to apply for undo, or null. */
  undo(): Transaction | null {
    const tx = this.undoStack.pop();
    if (!tx) return null;
    this.redoStack.push(tx);
    return invertTransaction(tx);
  }

  /** Returns the transaction to apply for redo, or null. */
  redo(): Transaction | null {
    const tx = this.redoStack.pop();
    if (!tx) return null;
    this.undoStack.push(tx);
    return tx;
  }

  /** Drops the latest undo step if it only created `id` (used for abandoned empty notes). */
  forgetCreate(id: string): boolean {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && top.length === 1 && top[0].kind === 'create' && top[0].element.id === id) {
      this.undoStack.pop();
      return true;
    }
    return false;
  }

  /** Forgets all steps (after a change that cannot be undone past, like replacing an import). */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
