import type { ElementMap } from '../model/ops';
import { GRID, type LineElement, type LineEnd, type ZElement } from '../model/types';
import { sizes } from './runtime';

export interface Pt {
  x: number;
  y: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Box (canvas px) of the element a line end is attached to, walking up out of columns. */
export function boxOf(elements: ElementMap, id: string, boardId: string): Box | null {
  let el: ZElement | undefined = elements[id];
  while (el && el.parentId !== boardId) el = el.parentId ? elements[el.parentId] : undefined;
  if (!el || el.section !== 'CANVAS') return null;
  const size = sizes.get(el.id) ?? { w: el.width * GRID, h: 80 };
  return { x: el.x * GRID, y: el.y * GRID, w: size.w, h: size.h };
}

const centre = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Where the segment from the box centre towards `toward` leaves the box (plus a small gap). */
function exitPoint(b: Box, toward: Pt, gap = 6): Pt {
  const c = centre(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const tx = dx !== 0 ? (b.w / 2 + gap) / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? (b.h / 2 + gap) / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty, 1);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Resolved end points, control point and midpoint of a line, in canvas px. */
export function lineGeometry(line: Pick<LineElement, 'start' | 'end' | 'bend'>, elements: ElementMap, boardId: string) {
  const endBox = (end: LineEnd) => (end.elementId ? boxOf(elements, end.elementId, boardId) : null);
  const free = (end: LineEnd): Pt => ({ x: end.x * GRID, y: end.y * GRID });
  const sb = endBox(line.start);
  const eb = endBox(line.end);
  // An end whose card was deleted (or moved away): the line is not drawn until it comes back.
  if ((line.start.elementId && !sb) || (line.end.elementId && !eb)) return null;
  // Aim at the other end's centre (or point) before clipping to the boxes.
  const sAim = sb ? centre(sb) : free(line.start);
  const eAim = eb ? centre(eb) : free(line.end);
  const a = sb ? exitPoint(sb, eAim) : sAim;
  const b = eb ? exitPoint(eb, sAim) : eAim;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const mid = { x: mx + nx * line.bend, y: my + ny * line.bend };
  // Quadratic control point chosen so the curve passes through `mid`.
  const ctrl = { x: 2 * mid.x - mx, y: 2 * mid.y - my };
  return { a, b, ctrl, mid, normal: { x: nx, y: ny }, chordMid: { x: mx, y: my } };
}

/** Arrowhead polygon at `tip`, pointing away from `from`. */
export function arrowHead(tip: Pt, from: Pt, size: number): string {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const bx = tip.x - ux * size * 1.6;
  const by = tip.y - uy * size * 1.6;
  return `${tip.x},${tip.y} ${bx - uy * size},${by + ux * size} ${bx + uy * size},${by - ux * size}`;
}

/** Signed distance of a point from the chord a→b along its normal (for bending). */
export function bendFor(p: Pt, a: Pt, b: Pt): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const bend = ((p.x - (a.x + b.x) / 2) * nx + (p.y - (a.y + b.y) / 2) * ny);
  return Math.abs(bend) < 6 ? 0 : Math.round(bend);
}
