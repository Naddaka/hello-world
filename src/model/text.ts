import type { JSONContent } from '@tiptap/core';
import type { ZElement } from './types';

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);

/** Plain text of a rich text document, one line per text block. */
export function docText(doc: JSONContent): string {
  const inline = (node: JSONContent): string =>
    node.type === 'text' ? (node.text ?? '') : node.type === 'hardBreak' ? '\n' : (node.content ?? []).map(inline).join('');
  const blocks: string[] = [];
  const visit = (node: JSONContent) => {
    if (TEXT_BLOCKS.has(node.type ?? '')) blocks.push(inline(node));
    else node.content?.forEach(visit);
  };
  visit(doc);
  return blocks.filter((b) => b.trim()).join('\n');
}

/** Searchable plain text of any element. */
export function elementText(e: ZElement): string {
  switch (e.type) {
    case 'CARD':
      return docText(e.content);
    case 'BOARD':
    case 'COLUMN':
      return e.title;
    case 'TASK_LIST':
      return [e.showTitle ? e.title : '', ...e.items.map((i) => `${i.done ? '☑' : '☐'} ${i.text}`)].filter(Boolean).join('\n');
    case 'IMAGE':
      return [e.caption, e.name].filter(Boolean).join('\n');
    case 'FILE':
      return e.name;
    case 'LINK':
      return [e.title, e.description, e.url].filter(Boolean).join('\n');
    case 'LINE':
      return e.label;
    case 'COLOR_SWATCH':
      return [e.name, e.hex].filter(Boolean).join(' ');
    case 'LABEL':
      return e.name;
    case 'TABLE':
      return e.cells.map((row) => row.filter(Boolean).join(' ')).filter(Boolean).join('\n');
    case 'DRAWING':
      return '';
    case 'SKETCH':
      return e.caption;
    case 'ALIAS':
      return '';
    case 'COMMENT':
      return e.messages.map((m) => m.text).join('\n');
    case 'DOCUMENT':
      return [e.title, docText(e.content)].filter(Boolean).join('\n');
  }
}

/** Builds a rich text document from plain text (one paragraph per line). */
export function textToDoc(text: string): JSONContent {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return { type: 'doc', content: lines.map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })) };
}
