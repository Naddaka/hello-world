import { canvasChildren, useStore } from '../model/store';
import { GRID } from '../model/types';
import { sizes } from './runtime';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Occupied areas of a board, in grid units (measured sizes where known). */
function occupied(boardId: string): Rect[] {
  const elements = useStore.getState().elements;
  return canvasChildren(elements, boardId)
    .filter((e) => e.type !== 'LINE' && e.type !== 'DRAWING' && !(e.type === 'COMMENT' && e.attachedTo))
    .map((e) => {
      const s = sizes.get(e.id);
      return { x: e.x, y: e.y, w: s ? Math.ceil(s.w / GRID) : e.width, h: s ? Math.ceil(s.h / GRID) : 16 };
    });
}

const GAP = 2;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/**
 * The free spot nearest to (x, y) for something of w × h grid units, so new
 * things do not land on top of existing cards. Searches outwards in rings;
 * falls back to the asked position if the area is crowded far around.
 */
export function freeSpot(boardId: string, x: number, y: number, w: number, h: number): { x: number; y: number } {
  const taken = occupied(boardId);
  const fits = (p: { x: number; y: number }) => !taken.some((r) => overlaps({ ...p, w, h }, r));
  const start = { x: Math.round(x), y: Math.round(y) };
  if (fits(start)) return start;
  const step = 4;
  for (let ring = 1; ring <= 60; ring++) {
    const candidates: { x: number; y: number }[] = [];
    for (let i = -ring; i <= ring; i++) {
      candidates.push({ x: start.x + i * step, y: start.y - ring * step }, { x: start.x + i * step, y: start.y + ring * step });
      if (i > -ring && i < ring) candidates.push({ x: start.x - ring * step, y: start.y + i * step }, { x: start.x + ring * step, y: start.y + i * step });
    }
    candidates.sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y));
    const spot = candidates.find(fits);
    if (spot) return spot;
  }
  return start;
}
