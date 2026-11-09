import type { JSONContent } from '@tiptap/core';
import {
  DEFAULT_WIDTH,
  GRID,
  type BoardColor,
  type CardColor,
  type CellFormat,
  type CellKind,
  type CommentMessage,
  type LabelColor,
  type LineColor,
  type LineEnd,
  type MediaRef,
  type Section,
  type TaskItem,
  type ZElement,
} from '../model/types';
import { milanoteDoc, milanotePlain } from './milanoteText';

/**
 * Converts a Milanote export (see milanoteExporter.js) into Zadum elements.
 * Pure: media files are only listed here; runImport downloads them and then
 * calls finalizeImport to fill in the references.
 */

type Raw = Record<string, unknown>;

export interface MilanoteElement {
  id?: string;
  _id?: string;
  elementType?: string;
  location?: { parentId?: string | null; section?: string; position?: Raw | null } | null;
  content?: Raw | null;
  createdTime?: unknown;
  modifiedTime?: unknown;
  createdTimestamp?: unknown;
  modifiedTimestamp?: unknown;
}

export interface MilanoteExport {
  format: 'milanote-export';
  version: number;
  exportedAt?: string;
  boardCount?: number;
  roots: { home: string | null; templates?: string | null; quickNotes?: string | null };
  elements: Record<string, MilanoteElement>;
  comments?: Record<string, Raw>;
  labels?: Record<string, Raw>;
  canvasOrder?: Record<string, unknown>;
  errors?: { boardId: string; message: string }[];
}

/** A file to download (or an SVG drawing to save) before the elements are committed. */
export interface MediaJob {
  key: string;
  url?: string;
  svg?: string;
  name: string;
  /** What the file is for, so a failure can be explained. */
  role: 'image' | 'file' | 'link-image' | 'drawing';
  elementId: string;
}

export interface ImportReport {
  boards: number;
  cards: number;
  images: number;
  files: number;
  links: number;
  other: number;
  /** Elements in Milanote's trash, which are not imported. */
  trashed: number;
  /** Elements whose board was not part of the export; they go to the Milanote board's Unsorted panel. */
  orphans: number;
  unknownTypes: string[];
  /** Boards Milanote could not give us. */
  exportErrors: { boardId: string; message: string }[];
  /** Media that could not be downloaded (filled in by finalizeImport). */
  failedMedia: { name: string; url: string }[];
}

export interface ImportPlan {
  rootId: string;
  elements: ZElement[];
  media: MediaJob[];
  report: ImportReport;
}

/** What the media library returned for a job (null when it failed). */
export interface StoredMedia {
  id: string;
  ext: string;
  name?: string;
  size?: number;
  mime?: string;
  width?: number | null;
  height?: number | null;
}

export const MN_PREFIX = 'mn-';
const mnId = (id: string) => `${MN_PREFIX}${id}`;
const PENDING = 'pending:';

export function isMilanoteExport(value: unknown): value is MilanoteExport {
  return !!value && typeof value === 'object' && (value as Raw).format === 'milanote-export' && typeof (value as Raw).elements === 'object';
}

// ---------- small helpers ----------

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});

function time(v: unknown, fallback: number): number {
  const n = num(v);
  if (n !== null) return n < 1e12 ? n * 1000 : n;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Normalises any colour description Milanote may use to #rrggbb. */
export function colorHex(value: unknown): string | null {
  if (typeof value === 'string') {
    const rgb = hexToRgb(value);
    if (rgb) return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    const named = NAMED_HEX[value.toUpperCase()];
    if (named) return named;
    const m = value.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
    if (m) return colorHex({ r: +m[1], g: +m[2], b: +m[3] });
    return null;
  }
  if (Array.isArray(value) && value.length >= 3) return colorHex({ r: value[0], g: value[1], b: value[2] });
  const o = obj(value);
  if ('value' in o) return colorHex(o.value);
  if ('hex' in o) return colorHex(o.hex);
  const r = num(o.r);
  const g = num(o.g);
  const b = num(o.b);
  if (r !== null && g !== null && b !== null) {
    const clamp = (c: number) => Math.max(0, Math.min(255, Math.round(c <= 1 && r <= 1 && g <= 1 && b <= 1 ? c * 255 : c)));
    return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

// Milanote's named element colours.
const NAMED_HEX: Record<string, string> = {
  GREY: '#bbbec3',
  GRAY: '#bbbec3',
  CYAN: '#62dbc8',
  GREEN: '#7cd651',
  BROWN: '#d58558',
  YELLOW: '#ffd14d',
  ORANGE: '#ff8d48',
  RED: '#ff5757',
  PINK: '#ff6ed4',
  PURPLE: '#ad6fff',
  BLUE: '#4ebafd',
  WHITE: '#ffffff',
  CHARCOAL: '#5f6672',
};

function hueOf(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = (hexToRgb(hex) ?? [0, 0, 0]).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

type Family = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'gray';

function familyOf(value: unknown): Family | null {
  if (typeof value === 'string') {
    const key = value.toUpperCase();
    if (key === 'TRANSPARENT' || key === 'NONE') return null;
    if (key === 'CYAN') return 'blue';
    if (key === 'BROWN') return 'orange';
    if (key === 'GREY' || key === 'GRAY' || key === 'CHARCOAL') return 'gray';
  }
  const hex = colorHex(value);
  if (!hex) return null;
  const { h, s, l } = hueOf(hex);
  if (s < 0.15 || l > 0.95) return l > 0.95 ? null : 'gray';
  if (h < 15 || h >= 345) return 'red';
  if (h < 40) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}

function cardColor(value: unknown): CardColor {
  if (typeof value === 'string' && value.toUpperCase() === 'TRANSPARENT') return 'transparent';
  const f = familyOf(value);
  switch (f) {
    case null:
      return 'default';
    case 'red':
      return 'pink';
    case 'gray':
      return 'default';
    default:
      return f;
  }
}

function boardColor(value: unknown, fallback: BoardColor): BoardColor {
  const f = familyOf(value);
  if (!f) return fallback;
  return f === 'red' ? 'pink' : f;
}

function lineColor(value: unknown): LineColor {
  const f = familyOf(value);
  switch (f) {
    case 'blue':
    case 'red':
    case 'green':
    case 'orange':
    case 'purple':
      return f;
    case 'pink':
      return 'red';
    case 'yellow':
      return 'orange';
    default:
      return 'default';
  }
}

function labelColor(value: unknown, index: number): LabelColor {
  const f = familyOf(value);
  const cycle: LabelColor[] = ['blue', 'orange', 'green', 'purple', 'pink', 'yellow', 'red', 'gray'];
  return f ?? cycle[index % cycle.length];
}

const BOARD_CYCLE: BoardColor[] = ['blue', 'orange', 'green', 'purple', 'pink', 'yellow'];

function imageUrl(image: unknown): string | null {
  if (typeof image === 'string') return image || null;
  const o = obj(image);
  for (const key of ['original', 'huge', 'large', 'regular', 'url', 'thumb']) {
    const v = o[key];
    if (typeof v === 'string' && v) return v;
    if (v && typeof v === 'object' && typeof (v as Raw).url === 'string') return (v as Raw).url as string;
  }
  return null;
}

function fileNameFromUrl(url: string, fallback: string): string {
  if (url.startsWith('data:')) return fallback;
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return last || fallback;
  } catch {
    return fallback;
  }
}

const pendingRef = (key: string): MediaRef => ({ id: `${PENDING}${key}`, ext: '' });

// ---------- conversion ----------

export function convertMilanote(data: MilanoteExport, now = Date.now()): ImportPlan {
  const exportedAt = time(data.exportedAt, now);
  const source = data.elements ?? {};
  const byId = new Map<string, MilanoteElement>();
  for (const [key, el] of Object.entries(source)) if (el) byId.set(el.id ?? el._id ?? key, el);

  const homeId = data.roots?.home ?? null;
  const rootId = mnId(homeId ?? 'home');
  const specialRoots = new Map<string, { title: string; template: boolean }>();
  if (data.roots?.quickNotes) specialRoots.set(data.roots.quickNotes, { title: 'Быстрые заметки', template: false });
  if (data.roots?.templates) specialRoots.set(data.roots.templates, { title: 'Шаблоны', template: true });

  const report: ImportReport = {
    boards: 0,
    cards: 0,
    images: 0,
    files: 0,
    links: 0,
    other: 0,
    trashed: 0,
    orphans: 0,
    unknownTypes: [],
    exportErrors: data.errors ?? [],
    failedMedia: [],
  };
  const out: ZElement[] = [];
  const media: MediaJob[] = [];
  const typeOf = (el: MilanoteElement | undefined) => el?.elementType ?? 'UNKNOWN';
  const sectionOf = (el: MilanoteElement) => (el.location?.section ?? 'CANVAS').toUpperCase();
  const parentOf = (el: MilanoteElement) => el.location?.parentId ?? null;
  const live = (el: MilanoteElement | undefined) => !!el && !['TRASH', 'DELETED'].includes(sectionOf(el));

  // Is the element reachable from one of the roots without passing through the trash?
  const reachable = new Map<string, boolean>();
  const isReachable = (id: string, depth = 0): boolean => {
    if (id === homeId || specialRoots.has(id)) return true;
    const cached = reachable.get(id);
    if (cached !== undefined) return cached;
    const el = byId.get(id);
    const parent = el ? parentOf(el) : null;
    const ok = !!el && live(el) && !!parent && depth < 200 && isReachable(parent, depth + 1);
    reachable.set(id, ok);
    return ok;
  };

  // Order of things on each canvas, from Milanote's own canvas order when present.
  const canvasRank = new Map<string, number>();
  for (const order of Object.values(data.canvasOrder ?? {})) {
    if (Array.isArray(order)) order.forEach((id, i) => typeof id === 'string' && canvasRank.set(id, i));
    else for (const [id, v] of Object.entries(obj(order))) if (num(v) !== null) canvasRank.set(id, num(v)!);
  }
  const rankOf = (el: MilanoteElement, id: string, fallback: number): number => {
    const p = obj(el.location?.position);
    return canvasRank.get(id) ?? num(p.score) ?? num(p.index) ?? num(p.order) ?? fallback;
  };

  // Labels → LABEL elements.
  const labelIds = new Map<string, string>();
  Object.entries(data.labels ?? {}).forEach(([key, raw], i) => {
    const l = obj(raw);
    const id = str(l.id) || str(l._id) || key;
    const name = str(l.name) || str(l.title) || str(l.text) || str(l.value);
    if (!name) return;
    const zid = `${MN_PREFIX}label-${id}`;
    labelIds.set(id, zid);
    out.push({ id: zid, type: 'LABEL', parentId: null, section: 'CANVAS', x: 0, y: 0, width: 0, z: 0, name, color: labelColor(l.color, i), createdAt: exportedAt, updatedAt: exportedAt });
  });
  const labelsOf = (content: Raw): string[] | undefined => {
    const list = Array.isArray(content.labels) ? content.labels : [];
    const ids = list.map((l) => (typeof l === 'string' ? l : str(obj(l).id) || str(obj(l)._id))).map((id) => labelIds.get(id)).filter((id): id is string => !!id);
    return ids.length ? ids : undefined;
  };

  // Comments grouped by thread.
  const threads = new Map<string, CommentMessage[]>();
  for (const [key, raw] of Object.entries(data.comments ?? {})) {
    const c = obj(raw);
    const threadId = str(c.threadId) || str(c.elementId) || str(obj(c.location).parentId);
    if (!threadId) continue;
    const text = milanotePlain(c.text ?? c.textContent ?? c.content ?? c.body);
    if (!text) continue;
    const reactions = Object.keys(obj(c.reactions));
    const list = threads.get(threadId) ?? [];
    list.push({ id: str(c.id) || str(c._id) || key, text, at: time(c.createdTime ?? c.createdAt ?? c.timestamp, exportedAt), reactions });
    threads.set(threadId, list);
  }

  /** Our id of the board an element sits on, looking through columns and task lists. */
  const boardOf = (id: string): string => {
    let parent = parentOf(byId.get(id) ?? {});
    for (let i = 0; parent && i < 50; i++) {
      if (parent === homeId) return rootId;
      const p = byId.get(parent);
      if (!p) break;
      if (typeOf(p) === 'BOARD' || specialRoots.has(parent)) return isReachable(parent) ? mnId(parent) : rootId;
      parent = parentOf(p);
    }
    return rootId;
  };

  const orderCounter = new Map<string, number>();
  const nextOrder = (parent: string) => {
    const n = (orderCounter.get(parent) ?? 0) + 1;
    orderCounter.set(parent, n);
    return n;
  };

  // Rough size of an element in px, to aim line bends.
  const sizeGuess = new Map<string, { x: number; y: number; w: number; h: number }>();

  const syncGroups = new Map<string, string>();
  const boardCount = { n: 0 };

  const convertOne = (id: string, el: MilanoteElement, override?: { parentId: string; section: Section; x: number; y: number; z: number }): ZElement | null => {
    const content = obj(el.content);
    const pos = obj(el.location?.position);
    const type = typeOf(el);
    const zid = mnId(id);

    let parentId: string;
    let section: Section;
    const rawParent = parentOf(el);
    if (override) {
      ({ parentId, section } = override);
    } else if (rawParent && (rawParent === homeId || isReachable(rawParent))) {
      parentId = rawParent === homeId ? rootId : mnId(rawParent);
      const s = sectionOf(el);
      section = s === 'INBOX' || s === 'QUICK_NOTES' ? 'INBOX' : 'CANVAS';
    } else {
      parentId = rootId;
      section = 'INBOX';
      report.orphans++;
    }
    const x = override?.x ?? Math.round(num(pos.x) ?? 0);
    const y = override?.y ?? Math.round(num(pos.y) ?? 0);
    const z = override?.z ?? Math.round(rankOf(el, id, nextOrder(parentId)) * 1000) / 1000;
    const width = (t: ZElement['type']) => {
      const w = num(content.width);
      return w && w > 1 ? Math.round(w) : DEFAULT_WIDTH[t];
    };
    const base = {
      id: zid,
      parentId,
      section,
      x,
      y,
      z,
      createdAt: time(el.createdTime ?? el.createdTimestamp, exportedAt),
      updatedAt: time(el.modifiedTime ?? el.modifiedTimestamp, exportedAt),
      ...(content.locked ? { locked: true } : {}),
      ...(labelsOf(content) ? { labels: labelsOf(content) } : {}),
    };

    switch (type) {
      case 'BOARD': {
        report.boards++;
        const special = specialRoots.get(id);
        return {
          ...base,
          type: 'BOARD',
          width: DEFAULT_WIDTH.BOARD,
          title: special?.title ?? (milanotePlain(content.title) || 'Без названия'),
          color: boardColor(content.color ?? content.secondaryColor ?? obj(content.icon).color, BOARD_CYCLE[boardCount.n++ % BOARD_CYCLE.length]),
          ...(content.isTemplate || special?.template || (rawParent && specialRoots.get(rawParent)?.template) ? { isTemplate: true } : {}),
        };
      }
      case 'CARD': {
        report.cards++;
        return { ...base, type: 'CARD', width: width('CARD'), content: milanoteDoc(content.textContent ?? content.text), color: cardColor(content.color ?? content.background) };
      }
      case 'DOCUMENT': {
        report.other++;
        return {
          ...base,
          type: 'DOCUMENT',
          width: DEFAULT_WIDTH.DOCUMENT,
          title: milanotePlain(content.title) || 'Документ',
          content: milanoteDoc(content.textContent),
          preview: str(content.displayMode).toLowerCase().includes('preview'),
        };
      }
      case 'COLUMN': {
        report.other++;
        return { ...base, type: 'COLUMN', width: width('COLUMN'), title: milanotePlain(content.title), collapsed: !!content.collapsed };
      }
      case 'TASK_LIST': {
        report.other++;
        const { title, items } = taskItems(id, content);
        return {
          ...base,
          type: 'TASK_LIST',
          width: width('TASK_LIST'),
          title: title || 'Задачи',
          showTitle: content.showTitle === undefined ? !!title : !!content.showTitle,
          items: items.length ? items : [{ id: `${zid}-t0`, text: '', done: false, due: null, indent: 0 }],
        };
      }
      case 'TASK': {
        // A task outside a task list: keep it as a note with a checkbox.
        report.cards++;
        const text = milanotePlain(content.textContent);
        const doc: JSONContent = { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: !!content.isComplete }, content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }] }] }] };
        return { ...base, type: 'CARD', width: width('CARD'), content: doc, color: 'default' };
      }
      case 'IMAGE': {
        const image = obj(content.image);
        const url = imageUrl(image) ?? imageUrl(content.originalImage);
        if (!url) return missing(base, 'Изображение без файла');
        report.images++;
        const key = `img-${id}`;
        const name = str(content.title) || fileNameFromUrl(url, 'изображение.jpg');
        media.push({ key, url, name, role: 'image', elementId: zid });
        const caption = milanotePlain(content.caption);
        return {
          ...base,
          type: 'IMAGE',
          width: width('IMAGE'),
          media: pendingRef(key),
          name,
          naturalWidth: num(image.width) ?? num(obj(content.media).originalWidth) ?? 1200,
          naturalHeight: num(image.height) ?? num(obj(content.media).originalHeight) ?? 800,
          caption,
          showCaption: content.showCaption === undefined ? !!caption : !!content.showCaption,
        };
      }
      case 'FILE': {
        const file = obj(content.file);
        const url = str(file.url);
        if (!url) return missing(base, 'Файл без содержимого');
        report.files++;
        const key = `file-${id}`;
        const name = str(file.filename) || str(file.name) || fileNameFromUrl(url, 'файл');
        media.push({ key, url, name, role: 'file', elementId: zid });
        return {
          ...base,
          type: 'FILE',
          width: width('FILE'),
          media: pendingRef(key),
          name,
          size: num(file.size) ?? 0,
          mime: str(file.mime) || str(file.type) || 'application/octet-stream',
          autoplay: !!content.mediaPlayerAutoplay,
          loop: !!content.mediaPlayerLoop,
        };
      }
      case 'LINK': {
        const link = obj(content.link);
        const url = str(link.url) || str(content.url);
        if (!url) return missing(base, 'Пустая ссылка');
        report.links++;
        const preview = imageUrl(link.image) ?? imageUrl(content.image);
        let image: MediaRef | null = null;
        if (preview) {
          const key = `link-${id}`;
          media.push({ key, url: preview, name: 'превью', role: 'link-image', elementId: zid });
          image = pendingRef(key);
        }
        let host = '';
        try {
          host = new URL(url).hostname.replace(/^www\./, '');
        } catch {
          host = '';
        }
        return {
          ...base,
          type: 'LINK',
          width: width('LINK'),
          url,
          title: str(link.title) || milanotePlain(content.title) || host || url,
          description: str(link.description) || str(link.desc) || milanotePlain(content.caption),
          siteName: str(obj(link.provider).name) || str(obj(content.provider).name) || str(link.siteName) || host,
          image,
          showImage: content.showMedia === undefined ? true : !!content.showMedia,
          showDescription: true,
          status: 'ready',
        };
      }
      case 'COLOR_SWATCH': {
        report.other++;
        return {
          ...base,
          type: 'COLOR_SWATCH',
          width: width('COLOR_SWATCH'),
          hex: colorHex(content.color) ?? '#888888',
          name: milanotePlain(content.colorName ?? content.title ?? content.name),
          display: content.showColorValue === false ? 'none' : 'hex',
        };
      }
      case 'TABLE': {
        report.other++;
        return { ...base, ...tableFields(content) };
      }
      case 'SKETCH':
      case 'ANNOTATION': {
        const drawing = obj(content.drawing);
        const svg = str(drawing.svg);
        if (!svg) return missing(base, type === 'SKETCH' ? 'Пустой скетч' : 'Пустой рисунок');
        report.images++;
        const key = `svg-${id}`;
        media.push({ key, svg, name: type === 'SKETCH' ? 'скетч.svg' : 'рисунок.svg', role: 'drawing', elementId: zid });
        const dw = num(drawing.width) ?? 800;
        const dh = num(drawing.height) ?? 600;
        const w = num(content.width) ?? (type === 'ANNOTATION' ? Math.round(dw / GRID) : DEFAULT_WIDTH.SKETCH);
        return {
          ...base,
          type: 'IMAGE',
          width: Math.max(4, Math.min(400, Math.round(w))),
          media: pendingRef(key),
          name: type === 'SKETCH' ? 'Скетч' : 'Рисунок с доски',
          naturalWidth: dw,
          naturalHeight: dh,
          caption: milanotePlain(content.caption),
          showCaption: !!milanotePlain(content.caption),
        };
      }
      case 'ALIAS': {
        const target = str(content.linkTo);
        if (target && byId.has(target) && typeOf(byId.get(target)) === 'BOARD' && live(byId.get(target))) {
          report.boards++;
          return { ...base, type: 'ALIAS', width: DEFAULT_WIDTH.ALIAS, targetId: target === homeId ? rootId : mnId(target) };
        }
        return missing(base, 'Ярлык на доску, которой нет в экспорте');
      }
      case 'CLONE': {
        const original = str(content.linkTo);
        const orig = byId.get(original);
        if (!orig || !live(orig)) return missing(base, 'Синхронная копия, оригинал которой не найден');
        if (typeOf(orig) === 'CARD') {
          report.cards++;
          const group = syncGroups.get(original) ?? `${MN_PREFIX}sync-${original}`;
          syncGroups.set(original, group);
          const oc = obj(orig.content);
          return { ...base, type: 'CARD', width: width('CARD'), content: milanoteDoc(oc.textContent), color: cardColor(oc.color), syncGroup: group };
        }
        // Other synced types: an independent copy.
        return convertOne(`${id}`, { ...orig, location: el.location, content: { ...obj(orig.content), width: content.width ?? obj(orig.content).width } });
      }
      case 'COMMENT_THREAD': {
        const messages = (threads.get(id) ?? threads.get(str(content.threadId)) ?? []).sort((a, b) => a.at - b.at);
        if (!messages.length) return null;
        report.other++;
        let attachedTo: string | null = null;
        if (sectionOf(el) === 'ATTACHED' && rawParent && byId.has(rawParent)) {
          // Pinned to a card: the comment lives on the board that holds the card.
          attachedTo = mnId(rawParent);
          base.parentId = boardOf(rawParent);
          base.section = 'CANVAS';
        }
        return { ...base, type: 'COMMENT', width: DEFAULT_WIDTH.COMMENT, messages, attachedTo };
      }
      default: {
        if (!report.unknownTypes.includes(type)) report.unknownTypes.push(type);
        return missing(base, `Элемент Milanote типа ${type}`);
      }
    }
  };

  /** A note standing in for something that could not be brought over. */
  function missing(base: Omit<ZElement, 'type' | 'width'> & Record<string, unknown>, text: string): ZElement {
    report.cards++;
    return {
      ...(base as object),
      type: 'CARD',
      width: DEFAULT_WIDTH.CARD,
      color: 'default',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `⚠ ${text}`, marks: [{ type: 'italic' }] }] }] },
    } as ZElement;
  }

  /** Task items, either as TASK child elements (older lists) or inside the list's own text (newer lists). */
  function taskItems(listId: string, content: Raw): { title: string; items: TaskItem[] } {
    const children = [...byId.entries()]
      .filter(([, e]) => typeOf(e) === 'TASK' && parentOf(e) === listId && live(e))
      .sort(([ia, a], [ib, b]) => rankOf(a, ia, 0) - rankOf(b, ib, 0));
    let title = milanotePlain(content.title);
    const items: TaskItem[] = children.map(([tid, t]) => {
      const c = obj(t.content);
      const p = obj(t.location?.position);
      const due = c.dueDate != null ? time(c.dueDate, 0) || null : null;
      return { id: mnId(tid), text: milanotePlain(c.textContent), done: !!c.isComplete, due, indent: Math.min(1, Math.max(0, num(p.indent) ?? num(c.indent) ?? 0)) };
    });
    if (!items.length && content.textContent) {
      const doc = obj(content.textContent).type === 'doc' ? (content.textContent as JSONContent) : null;
      let n = 0;
      const walk = (node: JSONContent, depth: number) => {
        if (node.type === 'taskListTitle') {
          title ||= (node.content ?? []).map((c) => c.text ?? '').join('');
          return;
        }
        if (node.type === 'taskItem') {
          const para = node.content?.find((c) => c.type === 'paragraph');
          const text = (para?.content ?? []).map((c) => (c.type === 'hardBreak' ? ' ' : (c.text ?? ''))).join('');
          const a = obj(node.attrs);
          items.push({ id: `${mnId(listId)}-t${n++}`, text, done: !!a.checked, due: a.dueDate != null ? time(a.dueDate, 0) || null : null, indent: Math.min(1, depth) });
          node.content?.filter((c) => c.type === 'taskList').forEach((c) => walk(c, depth + 1));
          return;
        }
        node.content?.forEach((c) => walk(c, node.type === 'taskList' ? depth : depth));
      };
      if (doc) walk(doc, 0);
    }
    return { title, items };
  }

  function tableFields(content: Raw): Pick<Extract<ZElement, { type: 'TABLE' }>, 'type' | 'width' | 'cells' | 'colWidths' | 'formats' | 'header'> {
    const table = obj(content.tableContent);
    const rows = Array.isArray(table.data) ? (table.data as unknown[]) : [];
    const cells: string[][] = [];
    const formats: Record<string, CellFormat> = {};
    let header = false;
    rows.forEach((row, r) => {
      const list = Array.isArray(row) ? row : [];
      cells.push(
        list.map((cell, c) => {
          const o = obj(cell);
          const value = 'value' in o ? o.value : cell;
          const fmt: CellFormat = {};
          const styles = Array.isArray(o.textStyle) ? (o.textStyle as unknown[]).map(String) : [];
          if (styles.includes('BOLD')) fmt.bold = true;
          const align = str(o.textAlignment || o.textAlign).toLowerCase();
          if (align === 'center' || align === 'right' || align === 'left') fmt.align = align;
          const kind = str(o.type || o.cellType || o.format).toLowerCase() as CellKind;
          if (['number', 'currency', 'percent', 'checkbox', 'text', 'date'].includes(kind)) fmt.kind = kind;
          const bg = o.background;
          if (r === 0 && bg === 'TABLE_DEFAULT_HEADER_BACKGROUND_COLOR') header = true;
          else if (bg) {
            const fill = cardColor(bg);
            if (fill !== 'default' && fill !== 'transparent') fmt.fill = fill;
          }
          if (r === 0 && header) delete fmt.bold;
          if (Object.keys(fmt).length) formats[`${r},${c}`] = fmt;
          if (value == null) return '';
          if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
          return typeof value === 'object' ? milanotePlain(value) : String(value);
        }),
      );
    });
    const cols = Math.max(1, ...cells.map((r) => r.length));
    for (const row of cells) while (row.length < cols) row.push('');
    if (!cells.length) cells.push(Array(cols).fill(''));
    const gu = Array.isArray(table.colWidthsGU) ? (table.colWidthsGU as unknown[]).map((v) => num(v) ?? 12) : [];
    const colWidths = Array.from({ length: cols }, (_, i) => Math.round((gu[i] ?? 12) * GRID));
    const width = Math.max(DEFAULT_WIDTH.TABLE, Math.round(colWidths.reduce((a, b) => a + b, 0) / GRID) + 2);
    return { type: 'TABLE', width: num(content.width) ?? width, cells, colWidths, formats, header };
  }

  // The board that holds everything imported.
  out.push({
    id: rootId,
    type: 'BOARD',
    parentId: null,
    section: 'CANVAS',
    x: 0,
    y: 0,
    z: 0,
    width: DEFAULT_WIDTH.BOARD,
    title: 'Milanote',
    color: 'purple',
    importedFrom: 'milanote',
    createdAt: exportedAt,
    updatedAt: exportedAt,
  });
  // Quick notes and templates become boards on it.
  let specialIndex = 0;
  for (const [id, info] of specialRoots) {
    const el = byId.get(id) ?? { elementType: 'BOARD', content: { title: info.title } };
    const board = convertOne(id, el, { parentId: rootId, section: 'CANVAS', x: -24, y: specialIndex++ * 16, z: specialIndex });
    if (board) out.push(board);
  }

  const lines: [string, MilanoteElement][] = [];
  for (const [id, el] of byId) {
    if (id === homeId || specialRoots.has(id)) continue;
    const type = typeOf(el);
    if (type === 'TASK' && typeOf(byId.get(parentOf(el) ?? '')) === 'TASK_LIST') continue;
    const parent = parentOf(el);
    // In the trash itself, or inside something that is.
    if (!live(el) || (parent && byId.has(parent) && !isReachable(parent))) {
      report.trashed++;
      continue;
    }
    if (type === 'LINE') {
      lines.push([id, el]);
      continue;
    }
    const converted = convertOne(id, el);
    if (converted) {
      out.push(converted);
      sizeGuess.set(converted.id, { x: converted.x * GRID, y: converted.y * GRID, w: converted.width * GRID, h: 120 });
    }
  }

  // Originals of synced notes join their copies' group.
  for (const e of out) if (e.type === 'CARD' && !e.syncGroup && syncGroups.has(e.id.slice(MN_PREFIX.length))) e.syncGroup = syncGroups.get(e.id.slice(MN_PREFIX.length));

  // Lines last: their ends refer to converted elements.
  const present = new Set(out.map((e) => e.id));
  for (const [id, el] of lines) {
    const content = obj(el.content);
    const pos = obj(el.location?.position);
    const ox = num(pos.x) ?? 0;
    const oy = num(pos.y) ?? 0;
    const end = (raw: unknown): LineEnd => {
      const e = obj(raw);
      const target = str(e.elementId);
      if (target && present.has(mnId(target))) return { elementId: mnId(target), x: 0, y: 0 };
      const guess = target ? sizeGuess.get(mnId(target)) : undefined;
      if (guess) return { elementId: null, x: Math.round(guess.x / GRID), y: Math.round(guess.y / GRID) };
      return { elementId: null, x: Math.round(ox + (num(e.x) ?? 0)), y: Math.round(oy + (num(e.y) ?? 0)) };
    };
    const start = end(content.start);
    const finish = end(content.end);
    const pt = (e: LineEnd) => {
      if (e.elementId) {
        const g = sizeGuess.get(e.elementId);
        if (g) return { x: g.x + g.w / 2, y: g.y + g.h / 2 };
      }
      return { x: e.x * GRID, y: e.y * GRID };
    };
    let bend = 0;
    const control = obj(content.control);
    if (num(control.x) !== null && num(control.y) !== null) {
      const a = pt(start);
      const b = pt(finish);
      const p = { x: (ox + num(control.x)!) * GRID, y: (oy + num(control.y)!) * GRID };
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      bend = Math.round((p.x - (a.x + b.x) / 2) * nx + (p.y - (a.y + b.y) / 2) * ny);
      if (Math.abs(bend) < 6 || Math.abs(bend) > 2000) bend = 0;
    }
    const weight = num(content.lineWeight) ?? 2;
    const parent = parentOf(el);
    report.other++;
    out.push({
      id: mnId(id),
      type: 'LINE',
      parentId: parent && parent !== homeId && isReachable(parent) ? mnId(parent) : rootId,
      section: 'CANVAS',
      x: 0,
      y: 0,
      z: rankOf(el, id, nextOrder(parent ?? rootId)),
      width: 0,
      createdAt: time(el.createdTime, exportedAt),
      updatedAt: time(el.modifiedTime, exportedAt),
      start,
      end: finish,
      bend,
      label: content.lineLabelEnabled === false ? '' : milanotePlain(content.lineLabel),
      color: lineColor(content.color),
      weight: weight >= 4 ? 3 : weight >= 2 ? 2 : 1,
      ...(str(content.lineStyle).toUpperCase() === 'DASHED' ? { style: 'dashed' as const } : str(content.lineStyle).toUpperCase() === 'DOTTED' ? { style: 'dotted' as const } : {}),
      arrowStart: str(content.startStyle).toUpperCase() === 'ARROW',
      arrowEnd: content.endStyle === undefined ? true : str(content.endStyle).toUpperCase() === 'ARROW',
    });
  }

  // Elements inside columns are ordered 1, 2, 3… like ours.
  const byParent = new Map<string, ZElement[]>();
  for (const e of out) {
    if (!e.parentId) continue;
    const list = byParent.get(e.parentId) ?? [];
    list.push(e);
    byParent.set(e.parentId, list);
  }
  for (const list of byParent.values()) {
    [...list].sort((a, b) => a.z - b.z).forEach((e, i) => (e.z = i + 1));
  }

  return { rootId, elements: out, media, report };
}

/** Puts downloaded media into the elements; things whose file failed become explanatory notes or links. */
export function finalizeImport(plan: ImportPlan, results: Map<string, StoredMedia | null>): ZElement[] {
  const jobs = new Map(plan.media.map((j) => [j.key, j]));
  const pendingKey = (ref: MediaRef | null | undefined) => (ref && ref.id.startsWith(PENDING) ? ref.id.slice(PENDING.length) : null);
  plan.report.failedMedia = [];
  return plan.elements.map((e) => {
    if (e.type === 'IMAGE' || e.type === 'FILE') {
      const key = pendingKey(e.media);
      if (!key) return e;
      const got = results.get(key);
      if (got) {
        const patched = { ...e, media: { id: got.id, ext: got.ext } };
        if (e.type === 'IMAGE' && got.width && got.height && jobs.get(key)?.role !== 'drawing') {
          return { ...patched, naturalWidth: got.width, naturalHeight: got.height };
        }
        if (e.type === 'FILE' && got.size) return { ...patched, size: got.size };
        return patched;
      }
      const job = jobs.get(key);
      plan.report.failedMedia.push({ name: e.name, url: job?.url ?? '' });
      if (job?.url) {
        // Keep a working link to the original so nothing is lost.
        return {
          id: e.id,
          parentId: e.parentId,
          section: e.section,
          x: e.x,
          y: e.y,
          z: e.z,
          width: DEFAULT_WIDTH.LINK,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
          type: 'LINK',
          url: job.url,
          title: e.name,
          description: 'Не удалось скачать при импорте из Milanote',
          siteName: 'Milanote',
          image: null,
          showImage: false,
          showDescription: true,
          status: 'ready',
        } satisfies ZElement;
      }
      return {
        id: e.id,
        type: 'CARD',
        parentId: e.parentId,
        section: e.section,
        x: e.x,
        y: e.y,
        z: e.z,
        width: DEFAULT_WIDTH.CARD,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        color: 'default',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `⚠ Не удалось сохранить: ${e.name}`, marks: [{ type: 'italic' }] }] }] },
      } as ZElement;
    }
    if (e.type === 'LINK') {
      const key = pendingKey(e.image);
      if (!key) return e;
      const got = results.get(key);
      return { ...e, image: got ? { id: got.id, ext: got.ext } : null };
    }
    return e;
  });
}
