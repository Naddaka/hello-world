import { useLayoutEffect, useRef, useState } from 'react';
import { actions, useStore } from '../model/store';
import { GRID, type ZElement } from '../model/types';
import { BoardTile } from './BoardTile';
import { NoteCard } from './NoteCard';
import { currentCamera, sizes, useDrag } from './runtime';
import { openMenu, type MenuEntry } from '../ui/ContextMenu';

const DRAG_THRESHOLD = 4;

/** Board tile or breadcrumb under a screen point, ignoring the dragged elements. */
function dropTargetAt(x: number, y: number, dragged: string[]): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const target = el?.closest<HTMLElement>('[data-drop-board]')?.dataset.dropBoard ?? el?.closest<HTMLElement>('[data-crumb-board]')?.dataset.crumbBoard;
  if (!target || dragged.includes(target) || target === useStore.getState().boardId) return null;
  return target;
}

function elementMenu(element: ZElement, ids: string[]): MenuEntry[] {
  const many = ids.length > 1;
  const items: MenuEntry[] = [];
  if (!many && element.type === 'BOARD') {
    items.push({ label: 'Открыть', hint: '↵', run: () => actions.openBoard(element.id) });
    items.push({ label: 'Переименовать', run: () => actions.setEditing(element.id) });
  }
  if (!many && element.type === 'CARD') items.push({ label: 'Редактировать', hint: '↵', run: () => actions.setEditing(element.id) });
  items.push(
    { label: 'Дублировать', hint: '⌥ + перетащить', run: () => actions.duplicate(ids) },
    'sep',
    { label: 'На передний план', hint: '⌘⇧↑', run: () => actions.bringToFront() },
    { label: 'На задний план', hint: '⌘⇧↓', run: () => actions.sendToBack() },
    element.locked
      ? { label: 'Открепить', run: () => actions.setLocked(ids, false) }
      : { label: 'Закрепить на месте', run: () => actions.setLocked(ids, true) },
    'sep',
    { label: 'Удалить', danger: true, disabled: Boolean(element.locked), run: () => actions.trash(ids) },
  );
  return items;
}

export function ElementView({ element, count }: { element: ZElement; count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const selected = useStore((s) => s.selection.includes(element.id));
  const editing = useStore((s) => s.editingId === element.id);
  const zoom = useStore((s) => (s.cameras[s.boardId] ?? currentCamera()).zoom);
  const drag = useDrag((s) => (s.ids.includes(element.id) ? s : null));
  const dropActive = useDrag((s) => s.dropTarget === element.id);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => sizes.set(element.id, { w: node.offsetWidth, h: node.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => {
      ro.disconnect();
      sizes.delete(element.id);
    };
  }, [element.id]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const state = useStore.getState();
    if (state.editingId === element.id) return; // let the editor handle text selection
    e.stopPropagation();
    if (e.shiftKey || e.metaKey) {
      actions.toggleSelect(element.id);
      return;
    }
    const wasSoleSelection = state.selection.length === 1 && state.selection[0] === element.id;
    let ids = state.selection;
    if (!ids.includes(element.id)) {
      ids = [element.id];
      actions.select(ids);
    } else if (state.editingId) {
      actions.setEditing(null);
    }
    const movable = ids.filter((id) => !state.elements[id]?.locked);
    const start = { x: e.clientX, y: e.clientY };
    const { zoom: z } = currentCamera();
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / z;
      const dy = (ev.clientY - start.y) / z;
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
      if (movable.length === 0) return;
      dragging = true;
      useDrag.setState({ ids: movable, dx, dy, dropTarget: dropTargetAt(ev.clientX, ev.clientY, movable) });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const { dx, dy, dropTarget } = useDrag.getState();
      useDrag.setState({ ids: [], dx: 0, dy: 0, dropTarget: null });
      if (!dragging) {
        // A second click on a selected note starts editing it.
        if (wasSoleSelection && element.type === 'CARD' && !element.locked) actions.setEditing(element.id);
        return;
      }
      const gdx = Math.round(dx / GRID);
      const gdy = Math.round(dy / GRID);
      const elements = useStore.getState().elements;
      if (dropTarget) actions.moveToBoard(movable, dropTarget);
      else if (ev.altKey) actions.duplicate(movable, gdx, gdy);
      else actions.moveTo(movable.map((id) => ({ id, x: elements[id].x + gdx, y: elements[id].y + gdy })));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = element.width;
    const { zoom: z } = currentCamera();
    let w = startW;
    const onMove = (ev: PointerEvent) => {
      w = Math.max(12, Math.round(startW + (ev.clientX - startX) / z / GRID));
      setLiveWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLiveWidth(null);
      actions.resize(element.id, w);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const { selection } = useStore.getState();
    const ids = selection.includes(element.id) ? selection : [element.id];
    if (!selection.includes(element.id)) actions.select(ids);
    openMenu(e.clientX, e.clientY, elementMenu(element, ids));
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (element.type === 'BOARD') actions.openBoard(element.id);
    else if (!element.locked) actions.setEditing(element.id);
  };

  const width = (liveWidth ?? element.width) * GRID;
  const x = element.x * GRID + (drag ? drag.dx : 0);
  const y = element.y * GRID + (drag ? drag.dy : 0);
  const resizable = element.type === 'CARD' && selected && !element.locked && !drag;

  return (
    <div
      ref={ref}
      className={`el${drag ? ' dragging' : ''}`}
      data-element-id={element.id}
      style={{ transform: `translate(${x}px, ${y}px)`, width, zIndex: editing ? 99999 : element.z }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {element.type === 'CARD' ? (
        <NoteCard element={element} selected={selected} editing={editing} zoom={zoom} />
      ) : (
        <BoardTile element={element} selected={selected} editing={editing} dropActive={dropActive} count={count} />
      )}
      {resizable && <span className="resize" role="presentation" onPointerDown={onResizeDown} />}
    </div>
  );
}
