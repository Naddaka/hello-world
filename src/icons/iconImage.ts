import { media } from '../storage/media';

/** Longest side of a stored board picture: sharp on Retina tiles, small on disk. */
export const ICON_MAX = 320;

export function isIconImageFile(file: File): boolean {
  return /^image\/(png|jpe?g|gif|webp|svg\+xml|heic|heif|bmp|avif)$/i.test(file.type) || /\.(png|jpe?g|gif|webp|svg|heic|bmp|avif)$/i.test(file.name);
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось открыть изображение'));
    img.src = url;
  });
}

/** Size of a picture scaled down to fit ICON_MAX (never up). */
export function iconSize(width: number, height: number): { width: number; height: number } {
  const k = Math.min(1, ICON_MAX / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * Makes a picture fit for a board icon: SVG stays as it is; small files stay
 * as they are (an animated GIF keeps moving); anything larger is scaled down,
 * to PNG when it has transparency and JPEG otherwise.
 */
export async function prepareIconImage(file: File): Promise<File> {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) return file;
  const img = await loadImage(file);
  URL.revokeObjectURL(img.src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('Не удалось открыть изображение');
  if (Math.max(w, h) <= ICON_MAX && file.size <= 300_000 && /png|jpe?g|gif|webp/i.test(file.type)) return file;
  const size = iconSize(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Не удалось уменьшить изображение');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, size.width, size.height);
  const pixels = ctx.getImageData(0, 0, size.width, size.height).data;
  let transparent = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 250) {
      transparent = true;
      break;
    }
  }
  const type = transparent ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error('Не удалось уменьшить изображение');
  return new File([blob], transparent ? 'иконка.png' : 'иконка.jpg', { type });
}

/** Stores a picture for a board icon; resolves to the icon value "media:<id>.<ext>". */
export async function storeIconImage(file: File): Promise<string> {
  const prepared = await prepareIconImage(file);
  const info = await (await media()).importFile(prepared);
  return `media:${info.id}.${info.ext}`;
}
