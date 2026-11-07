import { useRef } from 'react';
import { actions, canvasChildren, useStore } from '../model/store';
import type { ElementFields, ImageElement, SwatchElement } from '../model/types';
import { media } from '../storage/media';

const NAMED: [string, string][] = [
  ['#000000', 'Чёрный'], ['#ffffff', 'Белый'], ['#808080', 'Серый'], ['#c0c0c0', 'Серебристый'], ['#2f3640', 'Графит'],
  ['#1e2a44', 'Полночный синий'], ['#3f5a8a', 'Сумеречный синий'], ['#2f54eb', 'Кобальт'], ['#4a90e2', 'Небесно-синий'], ['#87ceeb', 'Голубой'],
  ['#008080', 'Бирюзовый'], ['#2e8b57', 'Морская зелень'], ['#3cb371', 'Изумрудный'], ['#9acd32', 'Желто-зелёный'], ['#556b2f', 'Оливковый'],
  ['#ffd700', 'Золотой'], ['#f5deb3', 'Пшеничный'], ['#e9e1d6', 'Лён'], ['#f4b183', 'Персиковый'], ['#ff7f50', 'Коралловый'],
  ['#e2725b', 'Терракота'], ['#b7410e', 'Ржавый'], ['#8b4513', 'Шоколадный'], ['#a0522d', 'Сиена'], ['#dc143c', 'Малиновый'],
  ['#b22222', 'Кирпичный'], ['#800020', 'Бордовый'], ['#ff69b4', 'Розовый'], ['#dda0dd', 'Сливовый'], ['#6d28d9', 'Фиолетовый'],
  ['#4b0082', 'Индиго'], ['#ff8c00', 'Оранжевый'], ['#f0e68c', 'Хаки'], ['#d2b48c', 'Песочный'],
];

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export function colorName(hex: string): string {
  const [r, g, b] = rgbOf(hex);
  let best = NAMED[0];
  let dist = Infinity;
  for (const entry of NAMED) {
    const [r2, g2, b2] = rgbOf(entry[0]);
    // Weighted distance roughly matching how people perceive colour differences.
    const d = 2 * (r - r2) ** 2 + 4 * (g - g2) ** 2 + 3 * (b - b2) ** 2;
    if (d < dist) {
      dist = d;
      best = entry;
    }
  }
  return best[1];
}

function hsl(hex: string) {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return `hsl(${Math.round((h * 60 + 360) % 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

export function formatColor(hex: string, display: SwatchElement['display']) {
  if (display === 'rgb') return `rgb(${rgbOf(hex).join(', ')})`;
  if (display === 'hsl') return hsl(hex);
  return hex.toUpperCase();
}

export function parseHex(text: string): string | null {
  const m = text.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

const FALLBACK = ['#1e2a44', '#3f5a8a', '#f4b183', '#e9e1d6', '#2e8b57', '#e2725b'];

/**
 * Picks a colour that goes with the images on the board, avoiding colours the
 * board's swatches already show (like the reference app does).
 */
async function suggestColor(boardId: string): Promise<string> {
  const elements = useStore.getState().elements;
  const onBoard = canvasChildren(elements, boardId);
  const taken = onBoard.filter((e): e is SwatchElement => e.type === 'COLOR_SWATCH').map((e) => rgbOf(e.hex));
  const far = (rgb: number[]) => taken.every((t) => Math.hypot(t[0] - rgb[0], t[1] - rgb[1], t[2] - rgb[2]) > 60);
  const images = onBoard.filter((e): e is ImageElement => e.type === 'IMAGE');
  for (const image of images) {
    try {
      const src = await (await media()).src(image.media);
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, 32, 32);
      const data = g.getImageData(0, 0, 32, 32).data;
      const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
      for (let i = 0; i < data.length; i += 4) {
        const key = `${data[i] >> 5}-${data[i + 1] >> 5}-${data[i + 2] >> 5}`;
        const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        bucket.n++;
        bucket.r += data[i];
        bucket.g += data[i + 1];
        bucket.b += data[i + 2];
        buckets.set(key, bucket);
      }
      const ranked = [...buckets.values()].sort((x, y) => y.n - x.n).map((v) => [v.r / v.n, v.g / v.n, v.b / v.n]);
      const pick = ranked.find(far);
      if (pick) return toHex(pick[0], pick[1], pick[2]);
    } catch {
      /* image not readable: try the next one */
    }
  }
  return FALLBACK.find((h) => far(rgbOf(h))) ?? FALLBACK[taken.length % FALLBACK.length];
}

export function addSwatch(at: { x: number; y: number }, parentId: string) {
  const boardId = useStore.getState().boardId;
  const fields: ElementFields<SwatchElement> = { type: 'COLOR_SWATCH', hex: '#3f5a8a', name: colorName('#3f5a8a'), display: 'hex' };
  const id = actions.insert(fields, parentId, at.x, at.y);
  actions.select([id]);
  void suggestColor(boardId).then((hex) => actions.setLive(id, { hex, name: colorName(hex) }));
}

export function setSwatchColor(id: string, hex: string) {
  actions.update(id, { hex, name: colorName(hex) });
}

export function SwatchCard({ element, selected }: { element: SwatchElement; selected: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [r, g, b] = rgbOf(element.hex);
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 160;
  return (
    <div className={`swatch-card${selected ? ' selected' : ''}`} onDoubleClick={(e) => { e.stopPropagation(); input.current?.click(); }}>
      <div className="swatch-color" style={{ background: element.hex, color: light ? '#16181d' : '#ffffff' }}>
        {element.display !== 'none' && <span className="swatch-value">{formatColor(element.hex, element.display)}</span>}
      </div>
      <div className="swatch-name">{element.name}</div>
      <input
        ref={input}
        type="color"
        className="sr-only"
        aria-label="Выбрать цвет"
        value={element.hex}
        onChange={(e) => actions.setLive(element.id, { hex: e.target.value, name: colorName(e.target.value) })}
        onBlur={(e) => setSwatchColor(element.id, e.target.value)}
      />
    </div>
  );
}
