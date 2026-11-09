/**
 * Board icons drawn from an SVG in the user's own data (a Milanote export's
 * icon glyphs): "svg:<markup>". The markup is rebuilt from a whitelist, so
 * nothing but plain shapes survive: no scripts, event handlers, styles, links,
 * images or references to anything outside. Shapes take the board colour
 * (currentColor); the faint layer of two-tone glyphs keeps its 40 % opacity.
 */

const SHAPES = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line']);
const NUMBER = /^-?[\d.]+(e-?\d+)?%?$/i;
const NUMBERS = /^[\d\s.,eE+-]*$/;
const PATH = /^[MmLlHhVvCcSsQqTtAaZz\d\s.,eE+-]*$/;
const TRANSFORM = /^\s*((matrix|translate|scale|rotate|skewX|skewY)\s*\([\d\s.,eE+-]*\)\s*,?\s*)+$/;

const ATTRS: Record<string, RegExp> = {
  d: PATH,
  points: NUMBERS,
  cx: NUMBER,
  cy: NUMBER,
  r: NUMBER,
  rx: NUMBER,
  ry: NUMBER,
  x: NUMBER,
  y: NUMBER,
  x1: NUMBER,
  y1: NUMBER,
  x2: NUMBER,
  y2: NUMBER,
  width: NUMBER,
  height: NUMBER,
  opacity: NUMBER,
  'fill-opacity': NUMBER,
  'stroke-width': NUMBER,
  transform: TRANSFORM,
  'fill-rule': /^(nonzero|evenodd)$/,
  'clip-rule': /^(nonzero|evenodd)$/,
  'stroke-linecap': /^(butt|round|square)$/,
  'stroke-linejoin': /^(miter|round|bevel)$/,
};

const MAX_INPUT = 200_000;
const MAX_OUTPUT = 60_000;

/** "<svg…>", base64 of it, or a data: URL of it → the SVG text, or null. */
export function decodeSvgSource(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_INPUT) return null;
  let s = value.trim();
  if (s.startsWith('<')) return s;
  const data = s.match(/^data:image\/svg\+xml(;[^,]*)?,(.*)$/is);
  if (data) {
    if (!/;base64/i.test(data[1] ?? '')) {
      try {
        return decodeURIComponent(data[2]);
      } catch {
        return null;
      }
    }
    s = data[2];
  }
  try {
    const binary = atob(s.replace(/\s+/g, ''));
    const text = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    return text.includes('<svg') ? text : null;
  } catch {
    return null;
  }
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function cleanNode(el: Element, depth: number): string {
  const name = el.localName;
  if (depth > 12 || !SHAPES.has(name)) return '';
  const attrs: string[] = [];
  for (const { name: a, value } of [...el.attributes]) {
    const rule = ATTRS[a];
    if (rule && rule.test(value.trim())) attrs.push(`${a}="${esc(value.trim())}"`);
  }
  const fill = el.getAttribute('fill')?.trim().toLowerCase();
  if (fill === 'none') attrs.push('fill="none"');
  const stroke = el.getAttribute('stroke')?.trim().toLowerCase();
  if (stroke && stroke !== 'none') attrs.push('stroke="currentColor"');
  // Two-tone glyphs: the secondary layer is drawn faint (Font Awesome's duotone convention).
  if (/(^|\s)fa-secondary(\s|$)/.test(el.getAttribute('class') ?? '') && !el.hasAttribute('opacity')) attrs.push('opacity="0.4"');
  const inner = [...el.children].map((c) => cleanNode(c, depth + 1)).join('');
  // Nothing to draw: a path without (valid) geometry, an empty group, a shape without size.
  if (name === 'path' && !attrs.some((x) => x.startsWith('d='))) return '';
  if (name === 'g' && !inner) return '';
  if (name !== 'g' && name !== 'path' && !attrs.length) return '';
  return `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}>${inner}</${name}>`;
}

/** A safe, minimal copy of an SVG icon, or null if there is nothing usable in it. */
export function sanitizeSvg(markup: string | null | undefined): string | null {
  if (!markup || markup.length > MAX_INPUT) return null;
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
  let viewBox = root.getAttribute('viewBox')?.trim() ?? '';
  if (!/^-?[\d.]+([\s,]+-?[\d.]+){3}$/.test(viewBox)) {
    const w = parseFloat(root.getAttribute('width') ?? '');
    const h = parseFloat(root.getAttribute('height') ?? '');
    viewBox = w > 0 && h > 0 ? `0 0 ${w} ${h}` : '0 0 24 24';
  }
  const inner = [...root.children].map((c) => cleanNode(c, 0)).join('');
  if (!inner || inner.length > MAX_OUTPUT) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${esc(viewBox)}" fill="currentColor">${inner}</svg>`;
}

const cache = new Map<string, string>();

/** The markup to draw for a stored "svg:" icon (cleaned again, in case the data was edited). */
export function svgIconMarkup(icon: string): string {
  let out = cache.get(icon);
  if (out === undefined) {
    out = sanitizeSvg(icon.slice(4)) ?? '';
    if (cache.size > 500) cache.clear();
    cache.set(icon, out);
  }
  return out;
}
