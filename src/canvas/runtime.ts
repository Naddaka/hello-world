import { create } from 'zustand';
import { GRID } from '../model/types';
import { actions, DEFAULT_CAMERA, MAX_ZOOM, MIN_ZOOM, useStore, type Camera } from '../model/store';

/** Live drag of elements on the canvas (not persisted until drop). */
interface DragState {
  ids: string[];
  /** Offset in canvas pixels. */
  dx: number;
  dy: number;
  /** Board tile or breadcrumb under the pointer, if any. */
  dropTarget: string | null;
}

export const useDrag = create<DragState>(() => ({ ids: [], dx: 0, dy: 0, dropTarget: null }));

/** Rendered sizes of elements in canvas pixels, measured by the element views. */
export const sizes = new Map<string, { w: number; h: number }>();

/** The canvas registers its viewport so commands outside it can convert coordinates. */
let viewport: HTMLElement | null = null;
export function registerViewport(el: HTMLElement | null) {
  viewport = el;
}

export function currentCamera(): Camera {
  const { cameras, boardId } = useStore.getState();
  return cameras[boardId] ?? DEFAULT_CAMERA;
}

export function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Converts a screen point to canvas pixels. */
export function screenToCanvas(clientX: number, clientY: number): { x: number; y: number } {
  const rect = viewport?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const cam = currentCamera();
  return { x: (clientX - rect.left - cam.x) / cam.zoom, y: (clientY - rect.top - cam.y) / cam.zoom };
}

export function isOverViewport(clientX: number, clientY: number): boolean {
  if (!viewport) return false;
  const r = viewport.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

/** Centre of the visible canvas, in grid units. */
export function viewportCentreGrid(): { x: number; y: number } {
  const r = viewport?.getBoundingClientRect();
  if (!r) return { x: 0, y: 0 };
  const p = screenToCanvas(r.left + r.width / 2, r.top + r.height / 2);
  return { x: Math.round(p.x / GRID), y: Math.round(p.y / GRID) };
}

/** Zooms keeping the given screen point fixed (defaults to the viewport centre). */
export function zoomAt(factor: number, clientX?: number, clientY?: number) {
  if (!viewport) return;
  const r = viewport.getBoundingClientRect();
  const px = (clientX ?? r.left + r.width / 2) - r.left;
  const py = (clientY ?? r.top + r.height / 2) - r.top;
  const cam = currentCamera();
  const zoom = clampZoom(cam.zoom * factor);
  const k = zoom / cam.zoom;
  setCamera({ zoom, x: px - (px - cam.x) * k, y: py - (py - cam.y) * k });
}

export function setCamera(cam: Camera) {
  actions.setCamera(useStore.getState().boardId, cam);
}

/** Fits all canvas content of the current board into view. */
export function zoomToFit(elements: { id: string; x: number; y: number; width: number }[]) {
  if (!viewport || elements.length === 0) {
    setCamera(DEFAULT_CAMERA);
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of elements) {
    const size = sizes.get(e.id) ?? { w: e.width * GRID, h: 120 };
    minX = Math.min(minX, e.x * GRID);
    minY = Math.min(minY, e.y * GRID);
    maxX = Math.max(maxX, e.x * GRID + size.w);
    maxY = Math.max(maxY, e.y * GRID + size.h);
  }
  const r = viewport.getBoundingClientRect();
  const pad = 96;
  const zoom = clampZoom(Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY), 1));
  setCamera({
    zoom,
    x: (r.width - (maxX - minX) * zoom) / 2 - minX * zoom,
    y: (r.height - (maxY - minY) * zoom) / 2 - minY * zoom,
  });
}
