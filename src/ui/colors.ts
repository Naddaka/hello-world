/**
 * Colours of cards, boards, lines and labels: a preset key (drawn from the
 * theme, so it has a light and a dark version) or a custom "#rrggbb" picked by
 * the user. Custom colours are shown as they are; the text on them is dark or
 * light by the colour's brightness.
 */

import type { HexColor } from '../model/types';

export type { HexColor };

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === 'string' && HEX.test(value);
}

/** "#abc", "abc", "#AABBCC", "rgb(…)" → "#aabbcc", or null. */
export function normalizeHex(value: unknown): HexColor | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  const short = s.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const long = s.match(/^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/);
  if (long) return `#${long[1]}`;
  const rgb = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (rgb) {
    const parts = rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0'));
    return `#${parts.join('')}`;
  }
  return null;
}

/** Relative luminance (WCAG), 0 for black to 1 for white. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Dark or white text, whichever reads better on the colour. */
export function textOn(hex: string): '#16181d' | '#ffffff' {
  const l = luminance(hex);
  // Contrast with the dark ink against contrast with white.
  return (l + 0.05) / (luminance('#16181d') + 0.05) >= 1.05 / (l + 0.05) ? '#16181d' : '#ffffff';
}

/** Mixes a colour with white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): HexColor {
  const n = parseInt(hex.slice(1), 16);
  const target = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  const mix = (v: number) => Math.round(v + (target - v) * a).toString(16).padStart(2, '0');
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

/** Background and text of a note (and of a table cell's fill). */
export function cardStyle(color: string | undefined): { background?: string; color?: string; '--ink'?: string; '--ink-2'?: string; '--muted'?: string } {
  if (!color || color === 'transparent') return {};
  if (!isHexColor(color)) return { background: `var(--card-${color})` };
  const ink = textOn(color);
  return { background: color, color: ink, '--ink': ink, '--ink-2': ink, '--muted': ink === '#ffffff' ? 'rgba(255,255,255,0.72)' : 'rgba(22,24,29,0.68)' };
}

/** Swatch fill for a card colour in a palette. */
export function cardSwatch(color: string): string | undefined {
  if (color === 'transparent') return undefined;
  return isHexColor(color) ? color : `var(--card-${color})`;
}

/** Tile of a board: soft background, strong icon colour, ring. */
export function boardTint(color: string): { bg: string; fg: string; ring: string } {
  if (!isHexColor(color)) return { bg: `var(--board-${color}-bg)`, fg: `var(--board-${color}-fg)`, ring: `var(--board-${color}-ring)` };
  return {
    bg: `color-mix(in srgb, ${color} 16%, var(--card))`,
    fg: color,
    ring: `color-mix(in srgb, ${color} 32%, var(--card))`,
  };
}

/** Stroke of a line or arrow. */
export function lineStroke(color: string): string {
  return isHexColor(color) ? color : `var(--line-${color})`;
}

/** Chip of a label. */
export function labelTint(color: string): { bg: string; fg: string; dot: string } {
  if (!isHexColor(color)) return { bg: `var(--label-${color}-bg)`, fg: `var(--label-${color}-fg)`, dot: `var(--label-${color}-fg)` };
  return { bg: `color-mix(in srgb, ${color} 20%, var(--card))`, fg: `color-mix(in srgb, ${color} 72%, var(--ink))`, dot: color };
}

// ----- recently used custom colours (per device) -----

const RECENT_KEY = 'zadum.recentColors';
const RECENT_MAX = 8;

export function recentColors(): HexColor[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(isHexColor).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberColor(hex: HexColor) {
  try {
    const list = [hex, ...recentColors().filter((c) => c !== hex)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Private mode or blocked storage: colours just are not remembered.
  }
}

// ----- text highlights -----

/** Highlight colours drawn from the theme; "yellow" is the plain ⌘J highlight. */
export const HIGHLIGHTS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'] as const;

/** A highlight colour as stored: a preset name, "#rrggbb", or null for the plain one. */
export function highlightColor(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim().toLowerCase();
  if ((HIGHLIGHTS as readonly string[]).includes(v)) return v === 'yellow' ? null : v;
  if (v.startsWith('var(--hl-')) return highlightColor(v.slice(9, -1));
  return normalizeHex(v);
}
