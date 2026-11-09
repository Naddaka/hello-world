import { actions, useStore } from '../model/store';
import type { FileElement, MediaRef } from '../model/types';
import { media } from '../storage/media';

/**
 * Poster frames for video cards. WebKit does not draw a frame of a video
 * loaded with preload="metadata", so cards would stay black until played.
 * A frame is taken once in a hidden player, saved as a small JPEG in the
 * media library and shown as the video's poster.
 */

const MAX_WIDTH = 720;
const CONCURRENCY = 2;
const queue: string[] = [];
const queued = new Set<string>();
let running = 0;

/** Ids of videos whose poster could not be made in this session (not retried until restart). */
const failed = new Set<string>();

/** Moments to try, in order: a second in (past a fade-in), then further in if that frame is black. */
function posterTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const times = [Math.min(1, duration / 2), Math.min(2, duration * 0.4), duration * 0.25, duration * 0.5];
  return [...new Set(times.map((t) => Math.round(t * 100) / 100))];
}

/** Brightness of a picture: mean and spread of the luma over a small sample. */
export function lumaStats(source: CanvasImageSource, width: number, height: number): { mean: number; spread: number } {
  const n = 24;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, width, height, 0, 0, n, n);
  const px = ctx.getImageData(0, 0, n, n).data;
  const values: number[] = [];
  for (let i = 0; i < px.length; i += 4) values.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { mean, spread: Math.max(...values) - Math.min(...values) };
}

/** A frame that is all black (or one flat colour close to it): what WebKit gives before the decoder has drawn. */
export const isBlank = ({ mean, spread }: { mean: number; spread: number }) => mean < 10 && spread < 8;

/** Draws the current frame of a video to a JPEG file. */
export async function frameToFile(video: HTMLVideoElement, name: string, maxWidth = MAX_WIDTH): Promise<File | null> {
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  return blob ? new File([blob], name, { type: 'image/jpeg' }) : null;
}

type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

/** Seeks and waits until the frame at that moment has really been decoded. */
async function frameAt(video: FrameVideo, time: number) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('seek timeout')), 15000);
    video.addEventListener('seeked', () => (clearTimeout(timer), resolve()), { once: true });
    video.currentTime = time;
  });
  // "seeked" fires before WebKit has a picture; the frame callback comes when it is presented.
  await new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, 700);
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => (clearTimeout(fallback), resolve()));
  });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/** Loads a video off screen and takes a poster frame that is not black. */
async function takePoster(file: FileElement): Promise<MediaRef | null> {
  const lib = await media();
  const src = await lib.src(file.media);
  if (!src) return null;
  const video = document.createElement('video') as FrameVideo;
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  // Attached, of a real size, but out of sight: some engines do not decode detached or tiny videos.
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;pointer-events:none';
  document.body.appendChild(video);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 20000);
      video.addEventListener('loadeddata', () => (clearTimeout(timer), resolve()), { once: true });
      video.addEventListener('error', () => (clearTimeout(timer), reject(new Error('cannot load'))), { once: true });
      video.src = src;
    });
    for (const time of posterTimes(video.duration)) {
      await frameAt(video, time);
      if (!video.videoWidth) continue;
      if (isBlank(lumaStats(video, video.videoWidth, video.videoHeight))) continue;
      const image = await frameToFile(video, `обложка ${file.name.replace(/\.[^.]+$/, '')}.jpg`);
      if (!image) return null;
      const info = await lib.importFile(image);
      return { id: info.id, ext: info.ext };
    }
    // Every frame tried was black: better no poster than a black one.
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}

/** Whether a stored poster is a black picture (made before frames were checked). */
async function posterIsBlank(poster: MediaRef): Promise<boolean> {
  const src = await (await media()).src(poster);
  if (!src) return true;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('poster'));
    img.src = src;
  });
  return isBlank(lumaStats(img, img.naturalWidth, img.naturalHeight));
}

async function pump() {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    running++;
    void (async () => {
      try {
        const file = useStore.getState().elements[id];
        if (file?.type === 'FILE') {
          // A poster made before frames were checked may be black: look once, and make a new one if so.
          const redo = !!file.poster && !file.posterChecked && (await posterIsBlank(file.poster).catch(() => false));
          if (!file.poster || redo) {
            const poster = await takePoster(file);
            const current = useStore.getState().elements[id];
            // Not an undo step: it is a cache of the video, not an edit.
            if (poster && current?.type === 'FILE') actions.setLive(id, { poster, posterChecked: true });
            else if (!poster) {
              failed.add(id);
              if (redo) actions.setLive(id, { poster: null, posterChecked: true });
            }
          } else if (!file.posterChecked) actions.setLive(id, { posterChecked: true });
        }
      } catch (error) {
        console.warn('Video poster:', error);
        failed.add(id);
      } finally {
        running--;
        queued.delete(id);
        void pump();
      }
    })();
  }
}

/** Makes a poster for a video card that has none (in the background, a couple at a time). */
export function ensurePoster(file: FileElement) {
  if ((file.poster && file.posterChecked) || !file.mime.startsWith('video/') || failed.has(file.id) || queued.has(file.id)) return;
  queued.add(file.id);
  queue.push(file.id);
  void pump();
}

/** Uses the frame on screen as the video's poster (from the review window). */
export async function setPosterFromFrame(file: FileElement, video: HTMLVideoElement): Promise<boolean> {
  const image = await frameToFile(video, `обложка ${file.name.replace(/\.[^.]+$/, '')}.jpg`);
  if (!image) return false;
  const info = await (await media()).importFile(image);
  actions.update(file.id, { poster: { id: info.id, ext: info.ext }, posterChecked: true });
  return true;
}
