import { create } from 'zustand';
import type { Stroke } from '../model/types';
import { shortcutKey } from '../ui/keys';

/** Pen widths for sizes 1–4 (in the units of the surface being drawn on). */
export const PEN_SIZES = [2, 4, 8, 14];

export const PEN_COLORS = ['#16181d', '#e5484d', '#f76b15', '#f5c400', '#30a46c', '#2f54eb', '#8e4ec6', '#ffffff'];

/** Smooth SVG path through the points (quadratic curves via midpoints). */
export function strokePath(points: number[], scale = 1): string {
  if (points.length < 2) return '';
  const p = (i: number) => [points[i] * scale, points[i + 1] * scale];
  const [x0, y0] = p(0);
  if (points.length === 2) return `M ${x0} ${y0} l 0.01 0`;
  let d = `M ${x0} ${y0}`;
  for (let i = 2; i < points.length - 2; i += 2) {
    const [x1, y1] = p(i);
    const [x2, y2] = p(i + 2);
    d += ` Q ${x1} ${y1} ${(x1 + x2) / 2} ${(y1 + y2) / 2}`;
  }
  const [xl, yl] = p(points.length - 2);
  return `${d} L ${xl} ${yl}`;
}

/** True if any point of the stroke is within `radius` of (x, y). */
export function hitsStroke(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const r = radius + stroke.size / 2;
  for (let i = 0; i < stroke.points.length; i += 2) {
    if (Math.hypot(stroke.points[i] - x, stroke.points[i + 1] - y) <= r) return true;
  }
  return false;
}

export function bounds(strokes: Stroke[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (let i = 0; i < s.points.length; i += 2) {
      minX = Math.min(minX, s.points[i] - s.size);
      minY = Math.min(minY, s.points[i + 1] - s.size);
      maxX = Math.max(maxX, s.points[i] + s.size);
      maxY = Math.max(maxY, s.points[i + 1] + s.size);
    }
  }
  return { minX, minY, maxX, maxY };
}

export type DrawTool = 'pen' | 'eraser';

interface DrawState {
  tool: DrawTool;
  color: string;
  previousColor: string;
  size: number;
}

/** Current drawing tool, shared by board drawing, sketches and image markup. */
export const useDrawTool = create<DrawState>(() => ({ tool: 'pen', color: '#16181d', previousColor: '#e5484d', size: 2 }));

export function setColor(color: string) {
  const { color: current } = useDrawTool.getState();
  if (color !== current) useDrawTool.setState({ color, previousColor: current, tool: 'pen' });
}

/** Keys of the reference app while drawing: D pen, E eraser, X previous colour, 1–4 size. */
export function handleDrawKey(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const k = shortcutKey(e);
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (k === 'd') useDrawTool.setState({ tool: 'pen' });
  else if (k === 'e') useDrawTool.setState({ tool: 'eraser' });
  else if (k === 'x') {
    const { color, previousColor } = useDrawTool.getState();
    useDrawTool.setState({ color: previousColor, previousColor: color, tool: 'pen' });
  } else if (['1', '2', '3', '4'].includes(k)) useDrawTool.setState({ size: Number(k) });
  else return false;
  return true;
}
