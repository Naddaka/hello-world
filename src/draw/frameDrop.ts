import { create } from 'zustand';
import { actions, commit, useStore } from '../model/store';
import { updateOp } from '../model/ops';
import type { MediaRef } from '../model/types';
import { media, type MediaInfo } from '../storage/media';

/**
 * Storyboard frames take a picture by drag and drop: a generated still dropped
 * on a sketch becomes its image (the drawing stays on top of it). Works for
 * files from Finder or the browser, image links dragged from a web page, and
 * image cards already on the board.
 */

/** The sketch under a dragged file, highlighted while a drop would land on it. */
export const useFrameDrop = create<{ id: string | null }>(() => ({ id: null }));

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|heic|heif|bmp|tiff?|svg)$/i;

export function isImageFile(item: string | File): boolean {
  if (typeof item === 'string') return IMAGE_EXT.test(item);
  return item.type.startsWith('image/') || IMAGE_EXT.test(item.name);
}

/** The sketch (storyboard frame) at a screen point, or null. */
export function frameAt(clientX: number, clientY: number): string | null {
  const node = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-element-id]');
  const id = node?.dataset.elementId;
  const el = id ? useStore.getState().elements[id] : undefined;
  return el && el.type === 'SKETCH' && !el.locked && el.section !== 'TRASH' ? el.id : null;
}

/** Marks the frame a file drag is over (null clears it). */
export function hoverFrame(clientX: number | null, clientY = 0) {
  const id = clientX === null ? null : frameAt(clientX, clientY);
  if (useFrameDrop.getState().id !== id) useFrameDrop.setState({ id });
}

function setBackdrop(frameId: string, ref: MediaRef) {
  const frame = useStore.getState().elements[frameId];
  if (!frame || frame.type !== 'SKETCH') return;
  actions.update(frameId, { backdrop: ref });
  actions.select([frameId]);
}

/** Stores a dropped file and puts it in the frame. */
export async function putFileInFrame(frameId: string, item: string | File) {
  try {
    const lib = await media();
    const info: MediaInfo = typeof item === 'string' ? await lib.importPath(item) : await lib.importFile(item);
    setBackdrop(frameId, { id: info.id, ext: info.ext });
  } catch (error) {
    console.error(error);
    actions.showToast('Не удалось поставить изображение в кадр');
  }
}

/** Downloads an image dragged from a web page and puts it in the frame. */
export async function putUrlInFrame(frameId: string, url: string) {
  const info = await (await media()).importUrl(url);
  if (info && info.mime.startsWith('image/')) setBackdrop(frameId, { id: info.id, ext: info.ext });
  else actions.showToast('По этой ссылке нет изображения');
}

/** An image card dropped on a frame moves into it: one undo step brings both back. */
export function moveImageIntoFrame(imageId: string, frameId: string) {
  const { elements } = useStore.getState();
  const image = elements[imageId];
  const frame = elements[frameId];
  if (image?.type !== 'IMAGE' || frame?.type !== 'SKETCH') return;
  commit([updateOp(frame, { backdrop: image.media }), updateOp(image, { section: 'TRASH' })]);
  actions.select([frameId]);
}

/**
 * Handles files dropped at a screen point: the first picture goes into the
 * frame under the pointer; returns the items left for the board (all of them
 * when the drop is not on a frame).
 */
export function dropOnFrame<T extends string | File>(clientX: number, clientY: number, items: T[]): T[] {
  useFrameDrop.setState({ id: null });
  const frame = frameAt(clientX, clientY);
  const index = frame ? items.findIndex(isImageFile) : -1;
  if (!frame || index === -1) return items;
  void putFileInFrame(frame, items[index]);
  return items.filter((_, i) => i !== index);
}
