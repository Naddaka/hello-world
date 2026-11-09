import type { JSONContent } from '@tiptap/core';
import { textToDoc } from '../model/text';
import { EMPTY_DOC } from '../model/types';
import { highlightColor } from '../ui/colors';

/**
 * Milanote stores rich text in one of three shapes: a TipTap document (newer
 * cards), a Draft.js raw document (older cards) or a plain string. These
 * helpers turn any of them into a document our editor schema accepts.
 */

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

interface DraftBlock {
  text?: string;
  type?: string;
  depth?: number;
  inlineStyleRanges?: { offset: number; length: number; style: string }[];
  entityRanges?: { offset: number; length: number; key: number | string }[];
  data?: Raw;
}

interface DraftRaw {
  blocks: DraftBlock[];
  entityMap?: Record<string, { type?: string; data?: Raw }>;
}

type Mark = { type: string; attrs?: Raw };

/** A highlight keeping Milanote's colour when we have it (a palette name or an exact value). */
function highlightMark(color: unknown): Mark {
  const c = highlightColor(typeof color === 'string' && /^[a-z_]+$/i.test(color) ? color.toLowerCase().replace(/^gr[ae]y$/, '') : color);
  return c ? { type: 'highlight', attrs: { color: c } } : { type: 'highlight' };
}

// ---------- Draft.js ----------

function styleMark(style: string): Mark | null {
  switch (style) {
    case 'BOLD':
      return { type: 'bold' };
    case 'ITALIC':
      return { type: 'italic' };
    case 'UNDERLINE':
      return { type: 'underline' };
    case 'STRIKETHROUGH':
      return { type: 'strike' };
    case 'CODE':
      return { type: 'code' };
    case 'HIGHLIGHT':
      return { type: 'highlight' };
    default:
      return style.startsWith('BG-') ? highlightMark(style.slice(3)) : null;
  }
}

function entityMark(entity: { type?: string; data?: Raw } | undefined): Mark | null {
  if (!entity) return null;
  if ((entity.type ?? '').toUpperCase() === 'LINK') {
    const href = (entity.data?.url ?? entity.data?.href) as string | undefined;
    return href ? { type: 'link', attrs: { href } } : null;
  }
  return null;
}

/** Splits a Draft.js block into text runs, each with its marks. */
function draftInline(block: DraftBlock, entityMap: DraftRaw['entityMap']): JSONContent[] {
  // Draft.js counts offsets in code points (an emoji is one), so index by code point.
  const text = Array.from(block.text ?? '');
  if (!text.length) return [];
  const marksAt: Mark[][] = text.map(() => []);
  for (const r of block.inlineStyleRanges ?? []) {
    const mark = styleMark(r.style);
    if (!mark) continue;
    for (let i = r.offset; i < Math.min(text.length, r.offset + r.length); i++) marksAt[i].push(mark);
  }
  for (const r of block.entityRanges ?? []) {
    const mark = entityMark(entityMap?.[String(r.key)]);
    if (!mark) continue;
    for (let i = r.offset; i < Math.min(text.length, r.offset + r.length); i++) marksAt[i].push(mark);
  }
  const runs: JSONContent[] = [];
  let start = 0;
  const key = (marks: Mark[]) => JSON.stringify(marks);
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || key(marksAt[i]) !== key(marksAt[start])) {
      runs.push(withMarks(text.slice(start, i).join(''), marksAt[start]));
      start = i;
    }
  }
  return splitLines(runs);
}

function withMarks(text: string, marks: Mark[]): JSONContent {
  const unique = marks.filter((m, i) => marks.findIndex((n) => n.type === m.type) === i);
  return unique.length ? { type: 'text', text, marks: unique } : { type: 'text', text };
}

/** Turns "\n" inside text runs into hard breaks. */
function splitLines(runs: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const run of runs) {
    if (run.type !== 'text' || !run.text?.includes('\n')) {
      out.push(run);
      continue;
    }
    run.text.split('\n').forEach((part, i) => {
      if (i) out.push({ type: 'hardBreak' });
      if (part) out.push({ ...run, text: part });
    });
  }
  return out;
}

function alignOf(block: DraftBlock): string | null {
  if (block.data?.['text-align-center']) return 'center';
  if (block.data?.['text-align-right']) return 'right';
  return null;
}

function paragraph(content: JSONContent[], align: string | null = null, extraMark?: Mark): JSONContent {
  const inner = extraMark ? content.map((n) => (n.type === 'text' ? { ...n, marks: [...(n.marks ?? []), extraMark] } : n)) : content;
  const node: JSONContent = { type: 'paragraph' };
  if (align) node.attrs = { textAlign: align };
  if (inner.length) node.content = inner;
  return node;
}

/** Converts a run of list blocks (same list kind) into nested lists by depth. */
function draftList(blocks: DraftBlock[], entityMap: DraftRaw['entityMap']): JSONContent {
  const kindOf = (b: DraftBlock) => (b.type === 'ordered-list-item' ? 'orderedList' : b.type === 'checklist' ? 'taskList' : 'bulletList');
  const build = (items: DraftBlock[], depth: number): JSONContent => {
    const list: JSONContent = { type: kindOf(items[0]), content: [] };
    let i = 0;
    while (i < items.length) {
      const b = items[i];
      const item: JSONContent =
        list.type === 'taskList'
          ? { type: 'taskItem', attrs: { checked: !!b.data?.checked }, content: [paragraph(draftInline(b, entityMap))] }
          : { type: 'listItem', content: [paragraph(draftInline(b, entityMap))] };
      i++;
      const nested: DraftBlock[] = [];
      while (i < items.length && (items[i].depth ?? 0) > depth) nested.push(items[i++]);
      if (nested.length) item.content!.push(build(nested, depth + 1));
      list.content!.push(item);
    }
    return list;
  };
  return build(blocks, blocks[0].depth ?? 0);
}

const LIST_TYPES = new Set(['unordered-list-item', 'ordered-list-item', 'checklist']);

export function draftToDoc(raw: DraftRaw): JSONContent {
  const content: JSONContent[] = [];
  const blocks = raw.blocks ?? [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    const type = b.type ?? 'unstyled';
    if (LIST_TYPES.has(type)) {
      const run: DraftBlock[] = [];
      while (i < blocks.length && blocks[i].type === type) run.push(blocks[i++]);
      content.push(draftList(run, raw.entityMap));
      continue;
    }
    i++;
    const inline = draftInline(b, raw.entityMap);
    switch (type) {
      case 'header-one':
        content.push({ type: 'heading', attrs: { level: 1, ...(alignOf(b) ? { textAlign: alignOf(b) } : {}) }, ...(inline.length ? { content: inline } : {}) });
        break;
      case 'header-two':
      case 'header-three':
      case 'header-four':
        content.push({ type: 'heading', attrs: { level: 2, ...(alignOf(b) ? { textAlign: alignOf(b) } : {}) }, ...(inline.length ? { content: inline } : {}) });
        break;
      case 'blockquote':
        content.push({ type: 'blockquote', content: [paragraph(inline)] });
        break;
      case 'code-block': {
        const text = (b.text ?? '').trim() ? b.text! : '';
        const prev = content[content.length - 1];
        // Consecutive code lines are one code block in Draft.js terms.
        if (prev?.type === 'codeBlock') {
          prev.content = [{ type: 'text', text: `${prev.content?.[0]?.text ?? ''}\n${text}` }];
        } else {
          content.push({ type: 'codeBlock', ...(text ? { content: [{ type: 'text', text }] } : {}) });
        }
        break;
      }
      case 'small-text':
        content.push(paragraph(inline, alignOf(b), { type: 'small' }));
        break;
      case 'atomic':
        break;
      default:
        content.push(paragraph(inline, alignOf(b)));
    }
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

// ---------- TipTap (Milanote schema → our schema) ----------

const KEEP_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'link', 'code', 'highlight', 'small']);

function cleanMarks(marks: JSONContent['marks'], extra: Mark[] = []): Mark[] | undefined {
  const out: Mark[] = [];
  for (const m of [...(marks ?? []), ...extra]) {
    if (!m || !KEEP_MARKS.has(m.type)) continue;
    if (out.some((o) => o.type === m.type)) continue;
    if (m.type === 'link') {
      const href = (m.attrs as Raw | undefined)?.href;
      if (typeof href === 'string' && href) out.push({ type: 'link', attrs: { href } });
    } else if (m.type === 'highlight') {
      out.push(highlightMark((m.attrs as Raw | undefined)?.color));
    } else {
      out.push({ type: m.type });
    }
  }
  return out.length ? out : undefined;
}

function textNode(text: string, marks?: Mark[]): JSONContent | null {
  if (!text) return null;
  return marks ? { type: 'text', text, marks } : { type: 'text', text };
}

/** Inline content: text, hard breaks; mentions and board links become plain text. */
function cleanInline(nodes: JSONContent[] | undefined, extra: Mark[] = []): JSONContent[] {
  const out: JSONContent[] = [];
  for (const n of nodes ?? []) {
    if (!n) continue;
    switch (n.type) {
      case 'text': {
        const parts = (n.text ?? '').split('\n');
        parts.forEach((part, i) => {
          if (i) out.push({ type: 'hardBreak' });
          const t = textNode(part, cleanMarks(n.marks, extra));
          if (t) out.push(t);
        });
        break;
      }
      case 'hardBreak':
        out.push({ type: 'hardBreak' });
        break;
      case 'mention': {
        const a = (n.attrs ?? {}) as Raw;
        const t = textNode(`@${String(a.label ?? a.name ?? a.displayName ?? a.id ?? '')}`, cleanMarks(n.marks, extra));
        if (t) out.push(t);
        break;
      }
      case 'inlineBoardLink': {
        const a = (n.attrs ?? {}) as Raw;
        const t = textNode(String(a.title ?? a.label ?? a.text ?? 'доска'), cleanMarks(n.marks, extra));
        if (t) out.push(t);
        break;
      }
      default:
        // Unknown inline wrappers: keep their text.
        if (n.content) out.push(...cleanInline(n.content, extra));
        else if (n.text) {
          const t = textNode(n.text, cleanMarks(n.marks, extra));
          if (t) out.push(t);
        }
    }
  }
  return out;
}

function alignAttrs(node: JSONContent): Raw | undefined {
  const align = (node.attrs as Raw | undefined)?.textAlign;
  return align === 'center' || align === 'right' ? { textAlign: align } : undefined;
}

function block(type: string, content: JSONContent[], attrs?: Raw): JSONContent {
  const node: JSONContent = { type };
  if (attrs && Object.keys(attrs).length) node.attrs = attrs;
  if (content.length) node.content = content;
  return node;
}

/** Block content of a container (doc, list item, quote). */
function cleanBlocks(nodes: JSONContent[] | undefined): JSONContent[] {
  const out: JSONContent[] = [];
  for (const n of nodes ?? []) {
    if (!n) continue;
    switch (n.type) {
      case 'paragraph':
        out.push(block('paragraph', cleanInline(n.content), alignAttrs(n)));
        break;
      case 'smallText':
        out.push(block('paragraph', cleanInline(n.content, [{ type: 'small' }]), alignAttrs(n)));
        break;
      case 'heading': {
        const level = Number((n.attrs as Raw | undefined)?.level ?? 1) <= 1 ? 1 : 2;
        out.push(block('heading', cleanInline(n.content), { level, ...alignAttrs(n) }));
        break;
      }
      case 'taskListTitle':
        out.push(block('paragraph', cleanInline(n.content, [{ type: 'bold' }])));
        break;
      case 'blockquote':
      case 'callout': {
        const inner = cleanBlocks(n.content);
        const icon = n.type === 'callout' ? String((n.attrs as Raw | undefined)?.icon ?? '') : '';
        if (icon && inner[0]?.type === 'paragraph') inner[0] = { ...inner[0], content: [{ type: 'text', text: `${icon} ` }, ...(inner[0].content ?? [])] };
        out.push({ type: 'blockquote', content: inner.length ? inner : [{ type: 'paragraph' }] });
        break;
      }
      case 'codeBlock': {
        const text = (n.content ?? []).map((c) => (c.type === 'hardBreak' ? '\n' : (c.text ?? ''))).join('');
        out.push(text ? { type: 'codeBlock', content: [{ type: 'text', text }] } : { type: 'codeBlock' });
        break;
      }
      case 'horizontalRule':
        out.push({ type: 'horizontalRule' });
        break;
      case 'bulletList':
      case 'orderedList': {
        const items = (n.content ?? []).filter((c) => c?.type === 'listItem').map((c) => ({ type: 'listItem', content: listItemBody(c) }));
        if (items.length) out.push({ type: n.type, content: items });
        break;
      }
      case 'taskList': {
        const items = (n.content ?? []).filter((c) => c?.type === 'taskItem').map((c) => ({ type: 'taskItem', attrs: { checked: !!(c.attrs as Raw | undefined)?.checked }, content: listItemBody(c) }));
        if (items.length) out.push({ type: 'taskList', content: items });
        break;
      }
      case 'text':
      case 'hardBreak':
      case 'mention':
      case 'inlineBoardLink': {
        // Inline content at block level: wrap it.
        out.push(block('paragraph', cleanInline([n])));
        break;
      }
      default:
        if (n.content) out.push(...cleanBlocks(n.content));
    }
  }
  return out;
}

/** A list item must start with a paragraph. */
function listItemBody(item: JSONContent): JSONContent[] {
  const body = cleanBlocks(item.content);
  if (body[0]?.type !== 'paragraph') body.unshift({ type: 'paragraph' });
  return body;
}

export function tiptapToDoc(doc: JSONContent): JSONContent {
  const content = cleanBlocks(doc.content);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

/** Any Milanote text value → a document for our editor. */
export function milanoteDoc(value: unknown): JSONContent {
  if (value == null) return EMPTY_DOC;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{')) {
      try {
        return milanoteDoc(JSON.parse(trimmed));
      } catch {
        /* plain text that happens to start with a brace */
      }
    }
    return value ? textToDoc(value) : EMPTY_DOC;
  }
  if (!isObj(value)) return EMPTY_DOC;
  if (Array.isArray(value.blocks)) return draftToDoc(value as unknown as DraftRaw);
  if (value.type === 'doc' || Array.isArray(value.content)) return tiptapToDoc(value as JSONContent);
  if ('textContent' in value) return milanoteDoc(value.textContent);
  return EMPTY_DOC;
}

/** Plain text of any Milanote text value (titles, captions, task text). */
export function milanotePlain(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' && !value.trim().startsWith('{')) return value;
  const doc = milanoteDoc(value);
  const lines: string[] = [];
  const inline = (n: JSONContent): string => (n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(inline).join(''));
  const visit = (n: JSONContent) => {
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'codeBlock') lines.push(inline(n));
    else n.content?.forEach(visit);
  };
  visit(doc);
  return lines.join('\n').trim();
}
