/**
 * Text icons: one to four letters, digits or signs drawn in the board colour —
 * "text:12", or "text-box:12" inside a square frame (Milanote's numbered
 * glyphs). Older "letter:AB" icons are drawn the same way.
 */

/** The text of a text icon (1–4 visible characters, letters upper-cased), or '' when it does not fit. */
export function textIcon(text: string): string {
  const chars = [...text.trim()];
  return chars.length >= 1 && chars.length <= 4 && chars.every((c) => /[\p{L}\p{N}\p{P}\p{S}]/u.test(c)) ? chars.join('').toUpperCase() : '';
}

/** One or two letters or digits (the older letter icons). */
export function letterIcon(text: string): string {
  const t = textIcon(text);
  return t && [...t].length <= 2 && [...t].every((c) => /[\p{L}\p{N}]/u.test(c)) ? t : '';
}

/** The parts of a text icon value, or null for other icons. */
export function parseTextIcon(icon: string | null | undefined): { text: string; boxed: boolean } | null {
  const m = icon?.match(/^(text|text-box|letter):(.+)$/s);
  return m ? { text: m[2], boxed: m[1] === 'text-box' } : null;
}
