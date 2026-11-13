import { textIcon } from '../icons/letters';
import { decodeSvgSource, sanitizeSvg } from '../icons/svgIcon';

/**
 * Board icons of a Milanote export, as our icon values. In the export:
 * - { type: 'mn-svg', id, name, svg: <base64 SVG>, png } — Milanote's glyphs
 *   (two-tone ones and numbered ones); drawn from the export's own SVG in the
 *   board colour. The glyph files are not part of Zadum: only what the user's
 *   export carries is shown. Without the SVG, a Lucide icon of the same
 *   meaning, or the number as a text icon.
 * - { type: 'string', string: '7' } — a text icon.
 * - icon null and a picture in content.image — the picture.
 * - emoji, letters and other shapes seen in older data.
 */

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export type IconMatch = { icon: string; exact: boolean } | { imageUrl: string };

/** Milanote glyph ids → Lucide icons of the same meaning (used when the export has no SVG). */
export const MN_ICON_TO_LUCIDE: Record<string, string> = {
  'alarm-clock': 'alarm-clock', b: 'letter-b', 'book-font': 'book-type', 'box-taped': 'package', 'brain-circuit': 'brain-circuit', browser: 'app-window',
  buffer: 'layers', 'bus-simple': 'bus-front', 'calendar-lines-pen': 'calendar-days', camcorder: 'video', campfire: 'flame-kindling', check: 'check',
  child: 'baby', 'child-dress': 'baby', 'circle-nodes': 'waypoints', clapperboard: 'clapperboard', clone: 'square-stack', 'clothes-hanger': 'shirt',
  'cloud-music': 'eighth-note', 'computer-classic': 'computer', copy: 'copy', 'cubes-stacked': 'boxes', diploma: 'scroll-text', 'display-medical': 'square-activity',
  'draw-square': 'vector-square', 'face-awesome': 'face-grinning', 'face-fearful': 'face-slightly-frowning', 'face-hushed': 'face-neutral',
  'face-smile-wink': 'face-slightly-smiling', fan: 'fan', 'film-simple': 'film', films: 'film', 'fish-fins': 'fish', 'flag-pennant': 'flag-triangle-right',
  'folder-grid': 'folder-kanban', 'folder-heart': 'folder-heart', 'game-console-handheld': 'gamepad-2', 'graduation-cap': 'graduation-cap',
  'grid-dividers': 'grid-3x3', 'head-side-brain': 'brain', 'highlighter-line': 'highlighter', 'hot-tub-person': 'bath', 'hourglass-end': 'hourglass',
  'house-medical-flag': 'hospital', 'image-landscape': 'image', infinity: 'infinity', instagram: 'camera', 'kit-medical': 'briefcase-medical', link: 'link',
  lips: 'mouth', 'list-radio': 'list-todo', 'list-ul': 'list', 'location-pin': 'map-pin', m: 'letter-m', 'masks-theater': 'drama',
  'message-bot': 'bot-message-square', meteor: 'rocket', moped: 'motorbike', mountain: 'mountain', 'paper-plane': 'send', 'pen-swirl': 'signature',
  'person-dress': 'venus', 'person-dress-simple': 'venus', 'person-half-dress': 'venus-and-mars', 'person-shelter': 'tent', 'person-simple': 'person-standing',
  'photo-film': 'images', 'planet-ringed': 'orbit', 'plate-utensils': 'utensils', 'rectangles-mixed': 'layout-dashboard', 'scalpel-line-dashed': 'slice',
  shelves: 'shelving-unit', 'shoe-prints': 'footprints', 'signs-post': 'signpost-big', 'star-of-life': 'asterisk', stethoscope: 'stethoscope',
  terminal: 'terminal', 'thought-bubble': 'message-circle-more', 'timeline-arrow': 'timeline', tooth: 'toothbrush', trash: 'trash',
  'trophy-star': 'trophy', 'trowel-bricks': 'brick-wall', tv: 'tv-minimal', 'tv-retro': 'tv', 'user-doctor-message': 'message-square-plus',
  'user-hair-long': 'user-round', 'user-nurse': 'cross', 'user-nurse-hair': 'cross', 'user-nurse-hair-long': 'cross', 'user-tie': 'briefcase-business',
  'user-tie-hair': 'briefcase-business', video: 'video',
};

/** Milanote's numbered glyphs ("7", "square-7", "mn-12", "mn-square-12") as text icons. */
export function numberIcon(id: string): string | null {
  const m = id.match(/^(?:mn-)?(square-)?(\d{1,4})$/);
  return m ? `${m[1] ? 'text-box' : 'text'}:${m[2]}` : null;
}

const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

function pictureUrl(image: unknown): string | null {
  if (typeof image === 'string') return /^(https?:|data:image\/)/i.test(image) ? image : null;
  const o = obj(image);
  // A board picture is shown small: the regular size (160 px) is plenty.
  for (const key of ['regular', 'original', 'large', 'huge', 'url', 'src', 'thumb']) {
    const v = o[key];
    const url = typeof v === 'string' ? v : str(obj(v).url);
    if (/^(https?:|data:image\/)/i.test(url)) return url;
  }
  return null;
}

/** Whether Milanote's icon field holds an icon at all (it may only carry the tile colour). */
export function hasIcon(value: unknown): boolean {
  if (typeof value === 'string') return !!value.trim();
  const o = obj(value);
  return Object.keys(o).some((k) => k !== 'color' && o[k] != null && o[k] !== '');
}

/** "mn-svg: id, name, svg" — the type and field names of an icon, without its values. */
export function iconShape(value: unknown): string {
  if (typeof value === 'string') return 'строка';
  const o = obj(value);
  const keys = Object.keys(o).filter((k) => k !== 'type').sort();
  return `${str(o.type) || 'без типа'}: ${keys.join(', ') || '—'}`;
}

/** One icon object of the export → our icon, or null when there is no equivalent. */
export function boardIconOf(value: unknown): IconMatch | null {
  if (typeof value === 'string') {
    if (PICTOGRAPH.test(value)) return { icon: `emoji:${value.trim()}`, exact: true };
    const text = textIcon(value);
    return text ? { icon: `text:${text}`, exact: true } : null;
  }
  const o = obj(value);
  const type = str(o.type).toLowerCase();
  const id = str(o.id).trim();
  if (type === 'mn-svg' || type === 'svg') {
    const svg = sanitizeSvg(decodeSvgSource(o.svg));
    if (svg) return { icon: `svg:${svg}`, exact: true };
    const number = numberIcon(id);
    if (number) return { icon: number, exact: false };
    const lucide = MN_ICON_TO_LUCIDE[id];
    return lucide ? { icon: `lucide:${lucide}`, exact: false } : null;
  }
  if (type === 'string' || type === 'text' || type === 'letter' || type === 'letters') {
    const text = textIcon(str(o.string) || str(o.text) || str(o.value) || str(o.letter) || (type === 'string' ? '' : id));
    return text ? { icon: `text:${text}`, exact: true } : null;
  }
  const candidates = [o.emoji, o.native, o.char, o.unicode, o.value, o.id, o.name].filter((v): v is string => typeof v === 'string' && !!v.trim());
  if (type === 'emoji' || (!type && candidates.some((c) => PICTOGRAPH.test(c)))) {
    const char = candidates.find((c) => PICTOGRAPH.test(c));
    if (char) return { icon: `emoji:${char.trim()}`, exact: true };
    // Code points such as "1f3ac" or "1f1fa-1f1e6".
    const code = candidates.find((c) => /^[0-9a-f]{4,6}(-[0-9a-f]{4,6})*$/i.test(c));
    return code ? { icon: `emoji:${String.fromCodePoint(...code.split('-').map((h) => parseInt(h, 16)))}`, exact: true } : null;
  }
  if (type === 'image' || type === 'upload' || type === 'custom') {
    const url = pictureUrl(o.image) ?? pictureUrl(o.url) ?? pictureUrl(o.src) ?? pictureUrl(o);
    return url ? { imageUrl: url } : null;
  }
  if (type === 'icon') {
    const name = (id || str(o.name))
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase()
      .replace(/^icon-/, '');
    if (MN_ICON_TO_LUCIDE[name]) return { icon: `lucide:${MN_ICON_TO_LUCIDE[name]}`, exact: false };
    return /^[a-z0-9-]+$/.test(name) ? { icon: `lucide:${name}`, exact: false } : null;
  }
  return null;
}

/**
 * The icon of a board from its content: the icon field, or (with no icon) the
 * picture Milanote keeps in content.image. `kind` says what was there at all.
 */
export function boardIconFrom(content: unknown): { match: IconMatch | null; present: boolean; shape: string } {
  const c = obj(content);
  if (hasIcon(c.icon)) return { match: boardIconOf(c.icon), present: true, shape: iconShape(c.icon) };
  const picture = pictureUrl(c.image);
  if (picture) return { match: { imageUrl: picture }, present: true, shape: 'image' };
  return { match: null, present: false, shape: '' };
}

/** A board as the import makes it: where it sits and what it is called. */
export interface ImportedBoard {
  /** Its id in Zadum ("mn-<Milanote id>"). */
  id: string;
  /** Boards, and the columns between them (boards often sit in columns). */
  type?: 'BOARD' | 'COLUMN';
  parentId: string | null;
  title: string;
  x: number;
  y: number;
  /** Order among its siblings (in a column, the place in the list). */
  z?: number;
  /** The board's content in the export (for its icon). */
  content: unknown;
}

type Els = Record<string, Raw>;

/** In the trash, itself or through a board or column it sits in. */
export function inTrash(elements: Els, id: string): boolean {
  for (let el = elements[id], hops = 0; el && hops < 200; el = elements[str(el.parentId)], hops++) if (el.section === 'TRASH') return true;
  return false;
}

/**
 * The live boards in Zadum that stand for each imported board: the imported
 * board itself, copies that remember it (importId), and copies made before
 * they did, found by structure. Columns are matched along the way, since most
 * boards sit in one: under a container that already matched, the child of the
 * same kind with the same title and place, or the only one with that title.
 * An imported board whose parent found nothing is matched on its own: a live
 * board of the same title holding mostly the same boards, or the only live
 * board with that title. Ambiguous cases are skipped, never guessed, and
 * nothing in the trash counts.
 */
export function findImportedBoards(elements: Els, imported: ImportedBoard[]): Map<string, string[]> {
  const kindOf = (b: ImportedBoard) => b.type ?? 'BOARD';
  const found = new Map<string, string[]>(imported.map((b) => [b.id, []]));
  const claimed = new Set<string>();
  const live = Object.values(elements).filter((e) => (e.type === 'BOARD' || e.type === 'COLUMN') && !inTrash(elements, str(e.id)));
  const liveKids = new Map<string, Raw[]>();
  for (const e of live) liveKids.set(str(e.parentId), [...(liveKids.get(str(e.parentId)) ?? []), e]);
  const add = (importId: string, id: string) => {
    if (claimed.has(id)) return false;
    claimed.add(id);
    found.get(importId)?.push(id);
    return true;
  };
  const byId = new Map(imported.map((b) => [b.id, b]));
  for (const b of imported) if (elements[b.id] && !inTrash(elements, b.id)) add(b.id, b.id);
  for (const e of live) if (typeof e.importId === 'string' && byId.has(e.importId)) add(e.importId, str(e.id));

  const kids = new Map<string, ImportedBoard[]>();
  for (const b of imported) if (b.parentId && byId.has(b.parentId)) kids.set(b.parentId, [...(kids.get(b.parentId) ?? []), b]);
  const title = (v: unknown) => str(v).trim();
  /** Titles of the nearest boards inside (looking through columns). */
  const boardsInsideImported = (id: string): string[] => (kids.get(id) ?? []).flatMap((k) => (kindOf(k) === 'BOARD' ? [title(k.title)] : boardsInsideImported(k.id)));
  const boardsInsideLive = (id: string): string[] => (liveKids.get(id) ?? []).flatMap((k) => (k.type === 'BOARD' ? [title(k.title)] : boardsInsideLive(str(k.id))));
  const importedTitleCount = new Map<string, number>();
  for (const b of imported) if (kindOf(b) === 'BOARD') importedTitleCount.set(title(b.title), (importedTitleCount.get(title(b.title)) ?? 0) + 1);

  /** Under the counterparts of its parent: the same kind, title and place — or the only one of that kind and title. */
  const matchUnderParent = (b: ImportedBoard): boolean => {
    let progress = false;
    for (const p of found.get(b.parentId ?? '') ?? []) {
      if (found.get(b.id)!.some((id) => str(elements[id]?.parentId) === p)) continue;
      const options = (liveKids.get(p) ?? []).filter((e) => e.type === kindOf(b) && !claimed.has(str(e.id)) && title(e.title) === title(b.title));
      const placed = options.filter((e) => e.x === b.x && e.y === b.y);
      let pick = placed.length === 1 ? placed[0] : placed.length === 0 && options.length === 1 ? options[0] : undefined;
      if (!pick && placed.length > 1) {
        // Look-alike siblings (same kind, title and place, e.g. in one column): paired by their
        // order, but only when the import has exactly as many of them still to place.
        const twins = (kids.get(b.parentId ?? '') ?? []).filter((k) => kindOf(k) === kindOf(b) && title(k.title) === title(b.title) && k.x === b.x && k.y === b.y && !found.get(k.id)!.some((id) => str(elements[id]?.parentId) === p));
        if (twins.length === placed.length && twins.every((k) => typeof k.z === 'number') && placed.every((e) => typeof e.z === 'number')) {
          const zs = (list: { z?: unknown }[]) => list.map((e) => Number(e.z)).sort((m, n) => m - n);
          const index = zs(twins).indexOf(Number(b.z));
          const liveSorted = [...placed].sort((m, n) => Number(m.z) - Number(n.z));
          if (new Set(zs(twins)).size === twins.length && new Set(zs(placed)).size === placed.length) pick = liveSorted[index];
        }
      }
      if (pick && add(b.id, str(pick.id))) progress = true;
    }
    return progress;
  };

  /** A board matched on its own, when its parent found nothing. */
  const matchAlone = (b: ImportedBoard): boolean => {
    const t = title(b.title);
    const free = live.filter((e) => e.type === 'BOARD' && !claimed.has(str(e.id)) && title(e.title) === t);
    const wanted = new Set(boardsInsideImported(b.id));
    if (wanted.size) {
      const holding = free.filter((e) => boardsInsideLive(str(e.id)).filter((x) => wanted.has(x)).length * 2 >= wanted.size);
      if (holding.length) return holding.map((e) => add(b.id, str(e.id))).some(Boolean);
    }
    // No boards inside to compare: only a title that is unique on both sides.
    if (free.length === 1 && importedTitleCount.get(t) === 1 && !live.some((e) => e.type === 'BOARD' && claimed.has(str(e.id)) && title(e.title) === t)) return add(b.id, str(free[0].id));
    return false;
  };

  // Parents first (the import lists children after their parents, but do not rely on it).
  const depth = (b: ImportedBoard): number => {
    let d = 0;
    for (let p = b.parentId ? byId.get(b.parentId) : undefined; p && d < 200; p = p.parentId ? byId.get(p.parentId) : undefined) d++;
    return d;
  };
  const ordered = [...imported].sort((a, b) => depth(a) - depth(b));
  for (let round = 0; round < 6; round++) {
    let progress = false;
    for (const b of ordered) {
      if (b.parentId && byId.has(b.parentId) && found.get(b.parentId)!.length) {
        if (matchUnderParent(b)) progress = true;
      } else if (kindOf(b) === 'BOARD' && !found.get(b.id)!.length) {
        if (matchAlone(b)) progress = true;
      }
    }
    if (!progress) break;
  }
  return found;
}

export interface IconRefreshPlan {
  /** Boards to change: an icon value, or a picture still to download. */
  changes: { id: string; icon?: string; imageUrl?: string }[];
  exact: number;
  approx: number;
  /** Boards with an icon in Milanote that has no equivalent here. */
  missing: number;
  shapes: string[];
  /** Boards that already have an icon in Zadum (other than an imported glyph) and were left alone. */
  kept: number;
  /** Imported boards with no live board in Zadum. */
  absent: number;
  /** Of those, how many are only in the trash. */
  trashed: number;
  /** Changes that land on copies of imported boards (not on the imported board itself). */
  copies: number;
}

/**
 * Which live boards get which icon from a saved export, touching nothing
 * else: every board that stands for an imported one (see findImportedBoards).
 * Boards that already have an icon keep it unless `replace` is set (an icon
 * chosen by hand is never lost by default).
 */
export function planIconRefresh(elements: Els, imported: ImportedBoard[], replace: boolean): IconRefreshPlan {
  const plan: IconRefreshPlan = { changes: [], exact: 0, approx: 0, missing: 0, shapes: [], kept: 0, absent: 0, trashed: 0, copies: 0 };
  const found = findImportedBoards(elements, imported);
  for (const board of imported) {
    if ((board.type ?? 'BOARD') !== 'BOARD') continue;
    const { match, present, shape } = boardIconFrom(board.content);
    if (!present) continue;
    const targets = found.get(board.id) ?? [];
    if (!targets.length) {
      plan.absent++;
      if (elements[board.id]) plan.trashed++;
      continue;
    }
    if (!match) {
      plan.missing++;
      if (!plan.shapes.includes(shape)) plan.shapes.push(shape);
      continue;
    }
    for (const id of targets) {
      const el = elements[id];
      // "svg:" icons only ever come from an import (they cannot be picked by hand), so a newer
      // reading of the export may always redraw them.
      const imported = typeof el.icon === 'string' && el.icon.startsWith('svg:');
      if (el.icon && !replace && !imported) {
        plan.kept++;
        continue;
      }
      if ('icon' in match) {
        if (el.icon === match.icon) continue;
        plan[match.exact ? 'exact' : 'approx']++;
        plan.changes.push({ id, icon: match.icon });
      } else {
        plan.exact++;
        plan.changes.push({ id, imageUrl: match.imageUrl });
      }
      if (id !== board.id) plan.copies++;
    }
  }
  return plan;
}
