import { nanoid } from 'nanoid';
import type { ElementMap, Op } from '../model/ops';
import { mediaRefsOf, type MediaRef, type ZElement } from '../model/types';

/**
 * How a new import goes in next to what is already there:
 * - the previous import of the same account (its "Milanote" board and
 *   everything on it) is replaced;
 * - anything the user moved off that board stays as it is, and the fresh
 *   copies of those elements get new ids so the two never collide;
 * - imports of other accounts are left alone.
 */
export interface Replacement {
  ops: Op[];
  /** Ids removed (the old board and what is on it, and labels the new import redefines). */
  removed: Set<string>;
  /** Media files that nothing refers to once the old import is gone. */
  orphans: MediaRef[];
}

function subtree(state: ElementMap, rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const e of Object.values(state)) {
    if (!e.parentId) continue;
    const list = children.get(e.parentId) ?? [];
    list.push(e.id);
    children.set(e.parentId, list);
  }
  const out = new Set<string>();
  if (!state[rootId]) return out;
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/** Element ids a converted element refers to, rewritten through `map`. */
function remapRefs(e: ZElement, map: Map<string, string>): ZElement {
  const m = (id: string | null | undefined) => (id && map.get(id)) || id;
  const next = { ...e, id: map.get(e.id) ?? e.id, parentId: m(e.parentId) ?? null } as ZElement;
  if (next.type === 'LINE') {
    next.start = { ...next.start, elementId: m(next.start.elementId) ?? null };
    next.end = { ...next.end, elementId: m(next.end.elementId) ?? null };
  }
  if (next.type === 'COMMENT') next.attachedTo = m(next.attachedTo) ?? null;
  if (next.type === 'ALIAS') next.targetId = m(next.targetId) ?? next.targetId;
  return next;
}

export function planReplacement(state: ElementMap, incoming: ZElement[], rootId: string): Replacement {
  const removed = subtree(state, rootId);
  // Labels are shared definitions: the new import's version replaces the old one.
  for (const e of incoming) if (e.type === 'LABEL' && state[e.id]) removed.add(e.id);

  // Elements the user moved off the old board keep their ids; the new copies get fresh ones.
  const rename = new Map<string, string>();
  for (const e of incoming) if (state[e.id] && !removed.has(e.id)) rename.set(e.id, `${e.id}~${nanoid(6)}`);
  const created = rename.size ? incoming.map((e) => remapRefs(e, rename)) : incoming;

  const ops: Op[] = [];
  for (const id of removed) ops.push({ kind: 'delete', element: state[id] });
  for (const e of created) ops.push({ kind: 'create', element: e });

  const stillUsed = new Set<string>();
  for (const e of Object.values(state)) if (!removed.has(e.id)) for (const r of mediaRefsOf(e)) stillUsed.add(r.id);
  for (const e of created) for (const r of mediaRefsOf(e)) stillUsed.add(r.id);
  const orphans = new Map<string, MediaRef>();
  for (const id of removed) for (const r of mediaRefsOf(state[id])) if (!stillUsed.has(r.id)) orphans.set(r.id, r);

  return { ops, removed, orphans: [...orphans.values()] };
}

/** Boards on which an import of another Milanote account lives. */
export function otherImportRoots(state: ElementMap, rootId: string): ZElement[] {
  // Imports made before the marker existed: a "Milanote" board with an imported id that is not inside another import.
  const legacy = (e: ZElement) => e.type === 'BOARD' && e.title === 'Milanote' && e.id.startsWith('mn-') && !(e.parentId ?? '').startsWith('mn-');
  return Object.values(state).filter((e) => e.type === 'BOARD' && e.id !== rootId && e.section !== 'TRASH' && (e.importedFrom === 'milanote' || legacy(e)));
}
