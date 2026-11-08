import { create } from 'zustand';
import { actions, useStore } from '../model/store';
import { GRID } from '../model/types';
import { isOverViewport, screenToCanvas } from './runtime';

/** Where the dragged elements would land. `null` means the board canvas. */
export type DropTarget =
  | { kind: 'board'; id: string }
  | { kind: 'column'; id: string; index: number }
  | { kind: 'inbox' }
  | { kind: 'trash' }
  | { kind: 'attach'; id: string }
  | null;

interface DragState {
  ids: string[];
  /** Pointer offset in screen pixels since the drag started. */
  dx: number;
  dy: number;
  drop: DropTarget;
}

export const useDrag = create<DragState>(() => ({ ids: [], dx: 0, dy: 0, drop: null }));

const DRAG_THRESHOLD = 4;

function dropAt(x: number, y: number, dragged: string[]): DropTarget {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return null;
  const { boardId, elements } = useStore.getState();
  const board = el.closest<HTMLElement>('[data-drop-board]')?.dataset.dropBoard ?? el.closest<HTMLElement>('[data-crumb-board]')?.dataset.crumbBoard;
  if (board && !dragged.includes(board) && board !== boardId) return { kind: 'board', id: board };
  if (el.closest('[data-drop-trash]')) return { kind: 'trash' };
  // A single comment dropped onto a card gets pinned to it.
  if (dragged.length === 1 && elements[dragged[0]]?.type === 'COMMENT') {
    const target = el.closest<HTMLElement>('[data-element-id]')?.dataset.elementId;
    if (target && target !== dragged[0] && elements[target] && elements[target].type !== 'COMMENT') return { kind: 'attach', id: target };
  }
  if (el.closest('[data-drop-inbox]')) return { kind: 'inbox' };
  const columnEl = el.closest<HTMLElement>('[data-drop-column]');
  const column = columnEl?.dataset.dropColumn;
  if (column && !dragged.includes(column) && !dragged.some((id) => elements[id]?.type === 'COLUMN')) {
    const items = [...columnEl!.querySelectorAll<HTMLElement>(':scope [data-col-item]')].filter((n) => !dragged.includes(n.dataset.colItem!));
    const index = items.findIndex((n) => {
      const r = n.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return { kind: 'column', id: column, index: index === -1 ? items.length : index };
  }
  return null;
}

/** Canvas-pixel position of each element's top-left corner, read from the DOM. */
function origins(ids: string[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const id of ids) {
    const node = document.querySelector(`[data-element-id="${id}"]`);
    if (!node) continue;
    const r = node.getBoundingClientRect();
    out[id] = screenToCanvas(r.left, r.top);
  }
  return out;
}

/**
 * Starts a pointer drag of elements. Calls `onClick` instead if the pointer
 * barely moved. Dropping decides the destination from what is under the pointer.
 */
export function startElementDrag(e: { clientX: number; clientY: number }, ids: string[], onClick: () => void) {
  const state = useStore.getState();
  const movable = ids.filter((id) => !state.elements[id]?.locked);
  const start = { x: e.clientX, y: e.clientY };
  const from = origins(movable);
  let dragging = false;

  const onMove = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
    if (movable.length === 0) return;
    dragging = true;
    useDrag.setState({ ids: movable, dx: ev.clientX - start.x, dy: ev.clientY - start.y, drop: dropAt(ev.clientX, ev.clientY, movable) });
  };
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const { drop } = useDrag.getState();
    useDrag.setState({ ids: [], dx: 0, dy: 0, drop: null });
    if (!dragging) {
      onClick();
      return;
    }
    const { boardId, elements } = useStore.getState();
    if (drop?.kind === 'board') return actions.moveToBoard(movable, drop.id);
    if (drop?.kind === 'column') return actions.insertIntoColumn(movable, drop.id, drop.index);
    if (drop?.kind === 'inbox') return actions.moveToInbox(movable, boardId);
    if (drop?.kind === 'trash') return actions.trash(movable);
    if (drop?.kind === 'attach') return actions.update(movable[0], { attachedTo: drop.id });
    if (!isOverViewport(ev.clientX, ev.clientY) || (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('.toolbar, .side-panel')) return;
    const zoom = useStore.getState().cameras[boardId]?.zoom ?? 1;
    const moves = movable
      .filter((id) => from[id])
      .map((id) => ({ id, x: (from[id].x + (ev.clientX - start.x) / zoom) / GRID, y: (from[id].y + (ev.clientY - start.y) / zoom) / GRID }));
    const allOnCanvas = movable.every((id) => elements[id].parentId === boardId && elements[id].section === 'CANVAS');
    if (allOnCanvas && ev.altKey) {
      const first = movable[0];
      actions.duplicate(movable, Math.round(moves[0].x - elements[first].x), Math.round(moves[0].y - elements[first].y));
    } else if (allOnCanvas) actions.moveTo(moves);
    else actions.placeOnCanvas(boardId, moves);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
