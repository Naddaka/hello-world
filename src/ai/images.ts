import type { MediaRef } from '../model/types';
import { media } from '../storage/media';
import type { AiImage } from './run';

/** The long side pictures are scaled down to before they are sent: enough to read text, cheap in tokens. */
export const MAX_SIDE = 1568;

export function fitSide(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.readAsDataURL(blob);
  });

/** A stored picture as the model takes it: a JPEG no larger than MAX_SIDE. */
export async function imageForModel(ref: MediaRef): Promise<AiImage> {
  const url = await (await media()).src(ref);
  const blob = await (await fetch(url)).blob();
  // Through an object URL, so the canvas stays readable whatever the picture's origin.
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Не удалось открыть изображение'));
      el.src = objectUrl;
    });
    const size = fitSide(img.naturalWidth || 1024, img.naturalHeight || 1024);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не удалось подготовить изображение');
    // Transparent pictures on white, as they look on a card.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(img, 0, 0, size.width, size.height);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!jpeg) throw new Error('Не удалось подготовить изображение');
    return { mediaType: 'image/jpeg', data: await toBase64(jpeg) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
