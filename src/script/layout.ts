import type { ScriptBlock, ScriptBlockType, ScriptFormat } from '../model/types';

/**
 * Screenplay page layout. Everything is set in a 12 pt Courier-metric font,
 * so a line holds 10 characters per inch and a page 6 lines per inch: page
 * count and breaks can be computed exactly from character counts, the way
 * screenwriting software does it.
 */

export const CHARS_PER_INCH = 10;
export const LINES_PER_INCH = 6;

interface Indent {
  /** Distance from the left text margin, in inches. */
  left: number;
  /** Width of the column, in inches. */
  width: number;
  align?: 'left' | 'right' | 'center';
}

export interface FormatSpec {
  id: ScriptFormat;
  label: string;
  /** Page size in inches and the CSS @page size. */
  page: { w: number; h: number; css: string };
  margin: { top: number; bottom: number; left: number; right: number };
  indent: Record<ScriptBlockType, Indent>;
  /** Blank lines before each kind of paragraph (dropped at the top of a page). */
  spaceBefore: Record<ScriptBlockType, number>;
  sceneBold: boolean;
  /** Scene numbers in both margins (Hollywood) or as a prefix (Russian). */
  sceneNumbers: 'margins' | 'prefix';
  language: 'en' | 'ru' | 'auto';
}

const SPACE: Record<ScriptBlockType, number> = {
  scene: 1,
  action: 1,
  character: 1,
  parenthetical: 0,
  dialogue: 0,
  transition: 1,
  shot: 1,
  centered: 1,
};

function usIndents(width: number): Record<ScriptBlockType, Indent> {
  return {
    scene: { left: 0, width },
    action: { left: 0, width },
    character: { left: 2.2, width: Math.min(3.8, width - 2.2) },
    parenthetical: { left: 1.6, width: 2.3 },
    dialogue: { left: 1.0, width: 3.5 },
    transition: { left: 0, width, align: 'right' },
    shot: { left: 0, width },
    centered: { left: 0, width, align: 'center' },
  };
}

export const FORMATS: Record<ScriptFormat, FormatSpec> = {
  hollywood: {
    id: 'hollywood',
    label: 'Голливудский (US Letter)',
    page: { w: 8.5, h: 11, css: 'letter' },
    margin: { top: 1, bottom: 1, left: 1.5, right: 1 },
    indent: usIndents(6),
    spaceBefore: SPACE,
    sceneBold: false,
    sceneNumbers: 'margins',
    language: 'auto',
  },
  a4: {
    id: 'a4',
    label: 'Европейский (A4)',
    page: { w: 8.27, h: 11.69, css: 'A4' },
    margin: { top: 1, bottom: 1, left: 1.5, right: 1 },
    indent: usIndents(5.77),
    spaceBefore: SPACE,
    sceneBold: false,
    sceneNumbers: 'margins',
    language: 'auto',
  },
  russian: {
    id: 'russian',
    label: 'Русский (A4)',
    page: { w: 8.27, h: 11.69, css: 'A4' },
    margin: { top: 0.79, bottom: 0.79, left: 1.18, right: 0.59 },
    indent: {
      scene: { left: 0, width: 6.5 },
      action: { left: 0, width: 6.5 },
      character: { left: 2.4, width: 4.1 },
      parenthetical: { left: 2.0, width: 2.4 },
      dialogue: { left: 1.4, width: 3.6 },
      transition: { left: 0, width: 6.5, align: 'right' },
      shot: { left: 0, width: 6.5 },
      centered: { left: 0, width: 6.5, align: 'center' },
    },
    spaceBefore: SPACE,
    sceneBold: true,
    sceneNumbers: 'prefix',
    language: 'ru',
  },
};

/** Lines of text that fit on one page. */
export const linesPerPage = (f: FormatSpec) => Math.floor((f.page.h - f.margin.top - f.margin.bottom) * LINES_PER_INCH);
export const charsFor = (f: FormatSpec, type: ScriptBlockType) => Math.max(8, Math.floor(f.indent[type].width * CHARS_PER_INCH));

const UPPER: ReadonlySet<ScriptBlockType> = new Set(['scene', 'character', 'transition', 'shot']);

/** The paragraph as it is printed: capitals where the format wants them, brackets around parentheticals. */
export function displayText(block: Pick<ScriptBlock, 'type' | 'text'>): string {
  const text = block.text.trim();
  if (block.type === 'parenthetical') return text ? `(${text.replace(/^\(|\)$/g, '')})` : '';
  return UPPER.has(block.type) ? text.toLocaleUpperCase('ru-RU') : text;
}

/** Wraps text into lines of at most `width` characters, breaking between words. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let w = word;
      while ([...w].length > width) {
        // A word longer than the line: hard split.
        if (line) {
          out.push(line);
          line = '';
        }
        const chars = [...w];
        out.push(chars.slice(0, width).join(''));
        w = chars.slice(width).join('');
      }
      if (!line) line = w;
      else if ([...line].length + 1 + [...w].length <= width) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export type Language = 'en' | 'ru';

export function scriptLanguage(blocks: ScriptBlock[], format: FormatSpec): Language {
  if (format.language !== 'auto') return format.language;
  const text = blocks.map((b) => b.text).join(' ');
  const cyr = (text.match(/[а-яё]/gi) ?? []).length;
  const lat = (text.match(/[a-z]/gi) ?? []).length;
  return cyr > lat ? 'ru' : 'en';
}

const WORDS = {
  en: { more: '(MORE)', contd: "(CONT'D)" },
  ru: { more: '(ДАЛЬШЕ)', contd: '(ПРОД.)' },
};

// ---------- pagination ----------

export interface Line {
  text: string;
  type: ScriptBlockType;
  /** Index of the paragraph this line belongs to (-1 for generated lines). */
  block: number;
  /** Set on the first line of a scene heading. */
  sceneNumber?: number;
  generated?: 'more' | 'contd';
}

export type PageItem = { kind: 'blank' } | { kind: 'line'; line: Line } | { kind: 'dual'; left: Line[]; right: Line[] };

export interface Page {
  number: number;
  items: PageItem[];
  /** First paragraph that starts on this page (for page markers in the editor). */
  firstBlock: number | null;
}

interface Unit {
  kind: 'scene' | 'speech' | 'dual' | 'plain';
  space: number;
  lines: Line[];
  /** For dual dialogue. */
  right?: Line[];
}

/** Column widths (in characters) for each side of a dual dialogue. */
export const DUAL_CHARS: Partial<Record<ScriptBlockType, number>> = { character: 26, parenthetical: 22, dialogue: 27 };

function blockLines(block: ScriptBlock, index: number, f: FormatSpec, dual = false): Line[] {
  const text = displayText(block);
  const width = dual ? (DUAL_CHARS[block.type] ?? charsFor(f, block.type)) : charsFor(f, block.type);
  return wrap(text, width).map((t) => ({ text: t, type: block.type, block: index }));
}

/** Groups paragraphs into units that are kept together or split by the rules for each kind. */
function units(blocks: ScriptBlock[], f: FormatSpec): Unit[] {
  const out: Unit[] = [];
  let scene = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // Empty paragraphs (an extra Enter) are not printed.
    if (!b.text.trim()) continue;
    if (b.type === 'character') {
      let j = i + 1;
      while (j < blocks.length && (blocks[j].type === 'dialogue' || blocks[j].type === 'parenthetical')) j++;
      const speech = (from: number, to: number, dual: boolean) => blocks.slice(from, to).flatMap((x, k) => (k === 0 || x.text.trim() ? blockLines(x, from + k, f, dual) : []));
      const lines = speech(i, j, false);
      const prev = out[out.length - 1];
      if (b.dual && prev && prev.kind === 'speech') {
        // Re-wrap the previous speech for the narrower side-by-side columns.
        const first = prev.lines[0].block;
        out[out.length - 1] = { kind: 'dual', space: prev.space, lines: speech(first, i, true), right: speech(i, j, true) };
      } else {
        out.push({ kind: 'speech', space: f.spaceBefore.character, lines });
      }
      i = j - 1;
      continue;
    }
    const lines = blockLines(b, i, f);
    if (b.type === 'scene') {
      scene++;
      lines[0].sceneNumber = scene;
    }
    out.push({ kind: b.type === 'scene' ? 'scene' : 'plain', space: f.spaceBefore[b.type], lines });
  }
  return out;
}

const endsSentence = (s: string) => /[.!?…»"')]$/.test(s.trim());

/**
 * Where to split `lines` so that the first part has at most `room` lines:
 * at least 2 lines on each side, preferring a sentence end. Returns the count
 * of lines kept on this page, or 0 when it cannot be split.
 */
function splitPoint(lines: Line[], room: number, minFirst: number, canSplitAt: (i: number) => boolean): number {
  const max = Math.min(room, lines.length - 2);
  let fallback = 0;
  for (let n = max; n >= minFirst; n--) {
    if (!canSplitAt(n)) continue;
    if (endsSentence(lines[n - 1].text)) return n;
    if (!fallback) fallback = n;
  }
  return fallback;
}

/** Lays the script out on pages, with (MORE)/(CONT'D) where a speech is split. */
export function paginate(blocks: ScriptBlock[], f: FormatSpec): Page[] {
  const capacity = linesPerPage(f);
  const words = WORDS[scriptLanguage(blocks, f)];
  const pages: Page[] = [];
  let page: Page = { number: 1, items: [], firstBlock: null };
  let used = 0;
  const newPage = () => {
    pages.push(page);
    page = { number: pages.length + 1, items: [], firstBlock: null };
    used = 0;
  };
  const put = (item: PageItem, height = 1) => {
    if (item.kind === 'line' && page.firstBlock === null && item.line.block >= 0) page.firstBlock = item.line.block;
    if (item.kind === 'dual' && page.firstBlock === null) page.firstBlock = item.left[0]?.block ?? null;
    page.items.push(item);
    used += height;
  };
  const putLines = (lines: Line[], space: number) => {
    if (used > 0) for (let s = 0; s < space; s++) put({ kind: 'blank' });
    for (const line of lines) put({ kind: 'line', line });
  };

  const list = units(blocks, f);
  for (let u = 0; u < list.length; u++) {
    const unit = list[u];
    const space = used > 0 ? unit.space : 0;
    const height = unit.kind === 'dual' ? Math.max(unit.lines.length, unit.right!.length) : unit.lines.length;

    if (unit.kind === 'dual') {
      if (used + space + height > capacity && used > 0) newPage();
      if (used > 0) for (let s = 0; s < unit.space; s++) put({ kind: 'blank' });
      put({ kind: 'dual', left: unit.lines, right: unit.right! }, height);
      continue;
    }

    if (used + space + height <= capacity) {
      // A scene heading must not be the last thing on a page.
      if (unit.kind === 'scene' && used > 0) {
        const next = list[u + 1];
        const nextNeed = next ? next.space + Math.min(2, next.lines.length) : 0;
        if (used + space + height + nextNeed > capacity) newPage();
      }
      putLines(unit.lines, unit.space);
      continue;
    }

    // Does not fit: split speeches and action at a line boundary, else move to the next page.
    let lines = unit.lines;
    const speaker = unit.lines[0].text;
    while (lines.length) {
      const sp = used > 0 ? unit.space : 0;
      if (used + sp + lines.length <= capacity) {
        putLines(lines, unit.space);
        break;
      }
      const room = capacity - used - sp;
      let keep = 0;
      if (unit.kind === 'speech') {
        // Keep the character name with at least two lines of dialogue, and leave a line for (MORE).
        const isDialogue = (i: number) => lines[i]?.type === 'dialogue' && lines[i - 1]?.type === 'dialogue';
        keep = room - 1 >= 3 ? splitPoint(lines, room - 1, 3, isDialogue) : 0;
      } else if (unit.kind === 'plain' && lines[0].type === 'action') {
        keep = room >= 2 ? splitPoint(lines, room, 2, () => true) : 0;
      }
      if (!keep && used === 0) keep = Math.max(1, room - (unit.kind === 'speech' ? 1 : 0)); // longer than a page: must split
      if (!keep) {
        newPage();
        continue;
      }
      putLines(lines.slice(0, keep), unit.space);
      if (unit.kind === 'speech') put({ kind: 'line', line: { text: words.more, type: 'character', block: -1, generated: 'more' } });
      newPage();
      const rest = lines.slice(keep);
      lines = unit.kind === 'speech' ? [{ text: `${speaker} ${words.contd}`, type: 'character', block: -1, generated: 'contd' }, ...rest] : rest;
    }
  }
  if (page.items.length || pages.length === 0) pages.push(page);
  return pages;
}

// ---------- scenes, characters, timing ----------

const SCENE_RE = /^(ИНТ\.?\s*\/\s*НАТ\.?|НАТ\.?\s*\/\s*ИНТ\.?|INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|ИНТ\.?|НАТ\.?|ЭКСТ\.?|INT\.?|EXT\.?|EST\.?)\s+/i;

/** Whether a line typed as action is really a scene heading ("ИНТ. КУХНЯ — ДЕНЬ"). */
export const looksLikeScene = (text: string) => SCENE_RE.test(text.trim());
/** Whether a line is a transition ("CUT TO:", "ЗТМ", "СМЕНА ПЛАНА:"). */
export const looksLikeTransition = (text: string) => {
  const t = text.trim();
  return (/^[A-ZА-ЯЁ0-9 .'’-]+:$/.test(t) && t === t.toLocaleUpperCase('ru-RU')) || /^(ЗТМ|ЗАТЕМНЕНИЕ|FADE OUT\.?|FADE IN:?)$/i.test(t);
};

export interface SceneHeading {
  prefix: string;
  location: string;
  time: string;
}

export function parseHeading(text: string): SceneHeading {
  const t = text.trim();
  const m = t.match(SCENE_RE);
  const prefix = m ? m[1].replace(/\s+/g, '') : '';
  const rest = m ? t.slice(m[0].length) : t;
  const parts = rest.split(/\s+[-–—]\s+/);
  return { prefix, location: (parts[0] ?? '').trim(), time: parts.slice(1).join(' — ').trim() };
}

/** A character name without extensions: "МАША (З.К.)" → "МАША". */
export const characterName = (text: string) =>
  text
    .replace(/\(.*?\)/g, '')
    .replace(/\^$/, '')
    .trim()
    .toLocaleUpperCase('ru-RU');

export interface SceneInfo {
  number: number;
  block: number;
  heading: string;
  page: number;
  /** Length in eighths of a page, at least 1. */
  eighths: number;
  characters: string[];
}

export function eighthsLabel(eighths: number): string {
  const whole = Math.floor(eighths / 8);
  const rest = eighths % 8;
  if (!whole) return `${rest}/8`;
  return rest ? `${whole} ${rest}/8` : `${whole}`;
}

export interface ScriptStats {
  pages: number;
  /** Rule of thumb: one page is about one minute of screen time. */
  minutes: number;
  scenes: SceneInfo[];
  characters: { name: string; speeches: number; scenes: number }[];
  locations: string[];
}

export function scriptStats(blocks: ScriptBlock[], f: FormatSpec, pages = paginate(blocks, f)): ScriptStats {
  const capacity = linesPerPage(f);
  // Lines used by each paragraph and the page it starts on.
  const linesOf = new Map<number, number>();
  const pageOf = new Map<number, number>();
  for (const p of pages) {
    for (const item of p.items) {
      const ls = item.kind === 'line' ? [item.line] : item.kind === 'dual' ? [...item.left, ...item.right] : [];
      for (const l of ls) {
        if (l.block < 0) continue;
        linesOf.set(l.block, (linesOf.get(l.block) ?? 0) + (item.kind === 'dual' ? 0.5 : 1));
        if (!pageOf.has(l.block)) pageOf.set(l.block, p.number);
      }
    }
  }
  const scenes: SceneInfo[] = [];
  const charMap = new Map<string, { speeches: number; scenes: Set<number> }>();
  const locations = new Set<string>();
  let current: SceneInfo | null = null;
  let lines = 0;
  const close = () => {
    if (current) current.eighths = Math.max(1, Math.round((lines / capacity) * 8));
  };
  blocks.forEach((b, i) => {
    if (b.type === 'scene') {
      close();
      current = { number: scenes.length + 1, block: i, heading: displayText(b), page: pageOf.get(i) ?? 1, eighths: 1, characters: [] };
      scenes.push(current);
      lines = 0;
      const loc = parseHeading(b.text).location.toLocaleUpperCase('ru-RU');
      if (loc) locations.add(loc);
    }
    lines += (linesOf.get(i) ?? 0) + (f.spaceBefore[b.type] ?? 0);
    if (b.type === 'character') {
      const name = characterName(b.text);
      if (!name) return;
      const entry = charMap.get(name) ?? { speeches: 0, scenes: new Set() };
      entry.speeches++;
      if (current) {
        entry.scenes.add(current.number);
        const sc: SceneInfo = current;
        if (!sc.characters.includes(name)) sc.characters.push(name);
      }
      charMap.set(name, entry);
    }
  });
  close();
  const characters = [...charMap.entries()].map(([name, e]) => ({ name, speeches: e.speeches, scenes: e.scenes.size })).sort((a, b) => b.speeches - a.speeches || a.name.localeCompare(b.name, 'ru'));
  const usedLines = pages.length ? (pages.length - 1) * capacity + pages[pages.length - 1].items.reduce((n, it) => n + (it.kind === 'dual' ? Math.max(it.left.length, it.right.length) : 1), 0) : 0;
  return { pages: pages.length, minutes: Math.max(blocks.some((b) => b.text.trim()) ? 1 : 0, Math.round(usedLines / capacity)), scenes, characters, locations: [...locations].sort((a, b) => a.localeCompare(b, 'ru')) };
}
