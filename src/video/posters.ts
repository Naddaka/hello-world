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

/** The moment to take the poster from: a second in (past a fade-in), or the middle of a short clip. */
const posterTime = (duration: number) => (Number.isFinite(duration) && duration > 0 ? Math.min(1, duration / 2) : 0);

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

/** Loads a video off screen and takes its poster frame. */
async function takePoster(file: FileElement): Promise<MediaRef | null> {
  const lib = await media();
  const src = await lib.src(file.media);
  if (!src) return null;
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  // Attached but invisible: some engines do not decode detached videos.
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 20000);
      video.addEventListener('loadedmetadata', () => (video.currentTime = posterTime(video.duration)), { once: true });
      video.addEventListener('seeked', () => (clearTimeout(timer), resolve()), { once: true });
      video.addEventListener('error', () => (clearTimeout(timer), reject(new Error('cannot load'))), { once: true });
      video.src = src;
    });
    // Let the seeked frame reach the decoder output.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const image = await frameToFile(video, `обложка ${file.name.replace(/\.[^.]+$/, '')}.jpg`);
    if (!image) return null;
    const info = await lib.importFile(image);
    return { id: info.id, ext: info.ext };
  } finally {
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}

async function pump() {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    running++;
    void (async () => {
      try {
        const file = useStore.getState().elements[id];
        if (file?.type === 'FILE' && !file.poster) {
          const poster = await takePoster(file);
          const current = useStore.getState().elements[id];
          // Not an undo step: it is a cache of the video, not an edit.
          if (poster && current?.type === 'FILE' && !current.poster) actions.setLive(id, { poster });
          else if (!poster) failed.add(id);
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
  if (file.poster || !file.mime.startsWith('video/') || failed.has(file.id) || queued.has(file.id)) return;
  queued.add(file.id);
  queue.push(file.id);
  void pump();
}

/** Uses the frame on screen as the video's poster (from the review window). */
export async function setPosterFromFrame(file: FileElement, video: HTMLVideoElement): Promise<boolean> {
  const image = await frameToFile(video, `обложка ${file.name.replace(/\.[^.]+$/, '')}.jpg`);
  if (!image) return false;
  const info = await (await media()).importFile(image);
  actions.update(file.id, { poster: { id: info.id, ext: info.ext } });
  return true;
}
