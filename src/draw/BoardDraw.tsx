import { useEffect } from 'react';
import { create } from 'zustand';
import { actions, canvasChildren, useStore } from '../model/store';
import { GRID, type DrawingElement, type Stroke } from '../model/types';
import { screenToCanvas } from '../canvas/runtime';
import { bounds, handleDrawKey, hitsStroke, PEN_SIZES, strokePath, useDrawTool } from './strokes';
import { DrawToolbar } from './DrawToolbar';

interface BoardDrawState {
  active: boolean;
  /** Strokes drawn in this session (canvas pixels), saved as one drawing when done. */
  session: Stroke[];
  live: Stroke | null;
}

export const useBoardDraw = create<BoardDrawState>(() => ({ active: false, session: [], live: null }));

export function startBoardDrawing() {
  actions.clearSelection();
  useDrawTool.setState({ tool: 'pen' });
  useBoardDraw.setState({ active: true, session: [], live: null });
}

/** Saves the session's strokes as a drawing element and leaves drawing mode. */
export function finishBoardDrawing() {
  const { session, active } = useBoardDraw.getState();
  if (!active) return;
  useBoardDraw.setState({ active: false, session: [], live: null });
  if (session.length === 0) return;
  const b = bounds(session);
  const ox = Math.floor(b.minX / GRID) * GRID;
  const oy = Math.floor(b.minY / GRID) * GRID;
  const strokes = session.map((s) => ({ ...s, points: s.points.map((v, i) => Math.round((v - (i % 2 === 0 ? ox : oy)) * 10) / 10) }));
  const width = Math.max(2, Math.ceil((b.maxX - ox) / GRID));
  const fields = { type: 'DRAWING' as const, strokes, height: Math.ceil(b.maxY - oy) };
  const id = actions.insert(fields, useStore.getState().boardId, ox / GRID, oy / GRID, width);
  actions.select([id]);
}

function eraseAt(x: number, y: number, pending: Map<string, { before: Stroke[]; after: Stroke[] }>) {
  const radius = 8;
  const { session } = useBoardDraw.getState();
  const kept = session.filter((s) => !hitsStroke(s, x, y, radius));
  if (kept.length !== session.length) useBoardDraw.setState({ session: kept });
  const { elements, boardId } = useStore.getState();
  for (const el of canvasChildren(elements, boardId)) {
    if (el.type !== 'DRAWING') continue;
    const lx = x - el.x * GRID;
    const ly = y - el.y * GRID;
    if (lx < -radius || ly < -radius || lx > el.width * GRID + radius || ly > el.height + radius) continue;
    const strokes = el.strokes.filter((s) => !hitsStroke(s, lx, ly, radius));
    if (strokes.length === el.strokes.length) continue;
    const entry = pending.get(el.id) ?? { before: el.strokes, after: el.strokes };
    entry.after = strokes;
    pending.set(el.id, entry);
    actions.setLive(el.id, { strokes });
  }
}

/** Captures pointer input on the board while drawing; shows the drawing toolbar. */
export function BoardDrawOverlay() {
  const active = useBoardDraw((s) => s.active);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.key === 'Escape' || k === 'v' || k === 'м') {
        e.preventDefault();
        finishBoardDrawing();
      } else if (handleDrawKey(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!active) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { tool, color, size } = useDrawTool.getState();
    const pending = new Map<string, { before: Stroke[]; after: Stroke[] }>();
    const p0 = screenToCanvas(e.clientX, e.clientY);
    const stroke: Stroke = { color, size: PEN_SIZES[size - 1], points: [Math.round(p0.x), Math.round(p0.y)] };
    if (tool === 'pen') useBoardDraw.setState({ live: stroke });
    else eraseAt(p0.x, p0.y, pending);
    const onMove = (ev: PointerEvent) => {
      const p = screenToCanvas(ev.clientX, ev.clientY);
      if (tool === 'eraser') return eraseAt(p.x, p.y, pending);
      const pts = stroke.points;
      if (Math.hypot(p.x - pts[pts.length - 2], p.y - pts[pts.length - 1]) < 1.5) return;
      stroke.points = [...pts, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
      useBoardDraw.setState({ live: { ...stroke } });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (tool === 'pen') useBoardDraw.setState((s) => ({ live: null, session: [...s.session, stroke] }));
      // Erasing on saved drawings is one undo step per gesture.
      for (const [id, { before, after }] of pending) actions.recordEdit(id, { strokes: before }, { strokes: after });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      <div className="draw-capture" onPointerDown={onPointerDown} onContextMenu={(e) => e.preventDefault()} onDoubleClick={(e) => e.stopPropagation()} />
      <div className="draw-bar-wrap">
        <DrawToolbar onDone={finishBoardDrawing} />
      </div>
    </>
  );
}

/** Strokes of the drawing in progress, drawn inside the zoomed canvas layer. */
export function BoardDrawStrokes() {
  const { session, live, active } = useBoardDraw();
  if (!active) return null;
  return (
    <svg className="lines" width="1" height="1" aria-hidden="true">
      {[...session, ...(live ? [live] : [])].map((s, i) => (
        <path key={i} d={strokePath(s.points)} stroke={s.color} strokeWidth={s.size} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/** A saved board drawing. */
export function DrawingView({ element, selected }: { element: DrawingElement; selected: boolean }) {
  return (
    <svg className={`drawing${selected ? ' selected' : ''}`} width={element.width * GRID} height={element.height} viewBox={`0 0 ${element.width * GRID} ${element.height}`} role="img" aria-label="Рисунок">
      {element.strokes.map((s, i) => (
        <path key={i} d={strokePath(s.points)} stroke={s.color} strokeWidth={s.size} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}
