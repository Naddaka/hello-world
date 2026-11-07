import { useEffect, useMemo, useRef, useState } from 'react';
import { actions, canvasChildren, countChildren, DEFAULT_CAMERA, inboxChildren, useStore } from '../model/store';
import { GRID } from '../model/types';
import { ElementView } from './ElementView';
import { LinesLayer } from './LinesLayer';
import type { LineElement } from '../model/types';
import { currentCamera, lastPointer, registerViewport, screenToCanvas, setCamera, sizes, zoomAt, zoomToFit } from './runtime';
import { useDrag } from './dnd';
import { addFiles, addLink } from '../model/importing';
import { asUrl } from '../model/embeds';
import { openMenu } from '../ui/ContextMenu';
import { IconInbox, IconMinus, IconPlus } from '../ui/icons';

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'));
}

/** Grid point and parent (board or column under the pointer) for something dropped at a screen point. */
export function dropPoint(clientX: number, clientY: number): { point: { x: number; y: number }; parent: string } {
  const p = screenToCanvas(clientX, clientY);
  const column = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop-column]')?.dataset.dropColumn;
  return { point: { x: Math.round(p.x / GRID) - 4, y: Math.round(p.y / GRID) - 4 }, parent: column ?? useStore.getState().boardId };
}

interface Marquee {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const boardId = useStore((s) => s.boardId);
  const elements = useStore((s) => s.elements);
  const camera = useStore((s) => s.cameras[s.boardId] ?? DEFAULT_CAMERA);
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<Marquee | null>(null);

  const all = useMemo(() => canvasChildren(elements, boardId), [elements, boardId]);
  const lines = useMemo(() => all.filter((e): e is LineElement => e.type === 'LINE'), [all]);
  const children = useMemo(() => all.filter((e) => e.type !== 'LINE'), [all]);
  const inboxCount = useMemo(() => inboxChildren(elements, boardId).length, [elements, boardId]);
  const inboxOpen = useStore((s) => s.panel === 'inbox');
  const overInbox = useDrag((s) => s.drop?.kind === 'inbox');

  useEffect(() => {
    registerViewport(ref.current);
    return () => registerViewport(null);
  }, []);

  // Wheel: pan with two fingers / wheel, zoom with pinch or ⌘ + wheel.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.formatbar, .popover')) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002)), e.clientX, e.clientY);
      } else {
        const cam = currentCamera();
        setCamera({ ...cam, x: cam.x - e.deltaX, y: cam.y - e.deltaY });
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  // Holding Space turns the pointer into a hand for panning.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target) && !e.repeat) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const startPan = (e: React.PointerEvent) => {
    const start = { x: e.clientX, y: e.clientY };
    const cam = currentCamera();
    setPanning(true);
    const onMove = (ev: PointerEvent) => setCamera({ ...cam, x: cam.x + ev.clientX - start.x, y: cam.y + ev.clientY - start.y });
    const onUp = () => {
      setPanning(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startMarquee = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const additive = e.shiftKey;
    const base = additive ? useStore.getState().selection : [];
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const cx = ev.clientX - rect.left;
      const cy = ev.clientY - rect.top;
      if (!moved && Math.hypot(cx - sx, cy - sy) < 4) return;
      moved = true;
      const m = { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) };
      setMarquee(m);
      const a = screenToCanvas(m.x + rect.left, m.y + rect.top);
      const b = screenToCanvas(m.x + m.w + rect.left, m.y + m.h + rect.top);
      const hit = canvasChildren(useStore.getState().elements, useStore.getState().boardId)
        .filter((el) => {
          if (el.type === 'LINE') return false;
          const size = sizes.get(el.id) ?? { w: el.width * GRID, h: 80 };
          const ex = el.x * GRID;
          const ey = el.y * GRID;
          return ex < b.x && ex + size.w > a.x && ey < b.y && ey + size.h > a.y;
        })
        .map((el) => el.id);
      actions.select([...new Set([...base, ...hit])]);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setMarquee(null);
      if (!moved && !additive) actions.clearSelection();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && space)) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    if (useStore.getState().editingId) actions.setEditing(null);
    startMarquee(e);
  };

  const createNoteAt = (clientX: number, clientY: number) => {
    const p = screenToCanvas(clientX, clientY);
    actions.createCard(boardId, p.x / GRID - 2, p.y / GRID - 2);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const { clientX, clientY } = e;
    const p = screenToCanvas(clientX, clientY);
    openMenu(clientX, clientY, [
      { label: 'Новая заметка', hint: 'двойной клик', run: () => createNoteAt(clientX, clientY) },
      { label: 'Новая доска', run: () => actions.createBoard(boardId, p.x / GRID - 7, p.y / GRID - 6) },
      'sep',
      { label: 'Выделить всё', hint: '⌘A', run: () => actions.selectAll() },
      { label: 'Показать всё', hint: 'Z', run: () => zoomToFit(canvasChildren(useStore.getState().elements, boardId)) },
    ]);
  };

  const background = {
    backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
    backgroundPosition: `${camera.x}px ${camera.y}px`,
  };

  return (
    <main
      ref={ref}
      className={`canvas${space ? ' space' : ''}${panning ? ' panning' : ''}`}
      style={background}
      data-canvas
      aria-label="Холст доски"
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        if (e.target === ref.current || (e.target as HTMLElement).classList.contains('layer')) createNoteAt(e.clientX, e.clientY);
      }}
      onContextMenu={onContextMenu}
      onPointerMove={(e) => {
        const p = screenToCanvas(e.clientX, e.clientY);
        lastPointer.x = Math.round(p.x / GRID);
        lastPointer.y = Math.round(p.y / GRID);
        lastPointer.valid = true;
      }}
      onPointerLeave={() => (lastPointer.valid = false)}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/uri-list')) e.preventDefault();
      }}
      onDrop={(e) => {
        // Browser drops (the desktop app receives file paths through Tauri instead).
        e.preventDefault();
        const { point, parent } = dropPoint(e.clientX, e.clientY);
        const files = [...e.dataTransfer.files];
        if (files.length) void addFiles(files, point, parent);
        else {
          const url = asUrl(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'));
          if (url) addLink(url, point, parent);
        }
      }}
    >
      <div className="layer" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
        <LinesLayer lines={lines} />
        {children.map((el) => (
          <ElementView key={el.id} element={el} count={el.type === 'BOARD' ? countChildren(elements, el.id) : 0} />
        ))}
      </div>
      {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
      {!inboxOpen && (
        <button
          type="button"
          className={`inbox-btn panel${overInbox ? ' drop' : ''}`}
          data-drop-inbox
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={() => actions.setPanel('inbox')}
        >
          <IconInbox size={15} />
          Неразобранное
          {inboxCount > 0 && <span className="badge">{inboxCount}</span>}
        </button>
      )}
      <div className="zoom panel" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" className="ibtn" aria-label="Уменьшить (⌘−)" title="Уменьшить (⌘−)" onClick={() => zoomAt(1 / 1.25)}>
          <IconMinus size={15} />
        </button>
        <button type="button" className="zoom-value" title="100% (⌘0) · двойной клик — показать всё" onClick={() => setCamera({ ...camera, zoom: 1 })} onDoubleClick={() => zoomToFit(children)}>
          {Math.round(camera.zoom * 100)}%
        </button>
        <button type="button" className="ibtn" aria-label="Увеличить (⌘+)" title="Увеличить (⌘+)" onClick={() => zoomAt(1.25)}>
          <IconPlus size={15} />
        </button>
      </div>
    </main>
  );
}
