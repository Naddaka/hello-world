import type { JSONContent } from '@tiptap/core';

/**
 * Markdown, as the model writes it, into the app's rich text: headings, lists
 * (with nesting), quotes, code, bold, italic, strike, inline code and links.
 * Anything else stays as plain text, so nothing the model wrote is lost.
 */

type Mark = { type: string; attrs?: Record<string, unknown> };

const INLINE = /(\*\*|__)(?=\S)([\s\S]+?)\1|(\*|_)(?=\S)([^*_\n]+?)\3|~~([^~\n]+)~~|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** Inline markdown as text nodes with marks. `refs` turns [[id]] references into something (see answers about boards). */
export function inline(text: string, marks: Mark[] = []): JSONContent[] {
  const out: JSONContent[] = [];
  const push = (value: string, extra: Mark[] = []) => {
    if (!value) return;
    const all = [...marks, ...extra];
    out.push(all.length ? { type: 'text', text: value, marks: all } : { type: 'text', text: value });
  };
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    push(text.slice(last, m.index));
    if (m[2] !== undefined) out.push(...inline(m[2], [...marks, { type: 'bold' }]));
    else if (m[4] !== undefined) out.push(...inline(m[4], [...marks, { type: 'italic' }]));
    else if (m[5] !== undefined) out.push(...inline(m[5], [...marks, { type: 'strike' }]));
    else if (m[6] !== undefined) push(m[6], [{ type: 'code' }]);
    else if (m[7] !== undefined) push(m[7], [{ type: 'link', attrs: { href: m[8] } }]);
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return out;
}

const paragraph = (text: string): JSONContent => {
  const content = inline(text.trim());
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
};

interface ListLine {
  indent: number;
  ordered: boolean;
  text: string;
}

const LIST = /^(\s*)(?:([-*+•])|(\d+)[.)])\s+(.*)$/;

function listLine(line: string): ListLine | null {
  const m = LIST.exec(line);
  return m ? { indent: m[1].replace(/\t/g, '  ').length, ordered: m[3] !== undefined, text: m[4] } : null;
}

/** Builds (nested) lists from consecutive list lines. */
function buildList(lines: ListLine[], from: number, indent: number): { node: JSONContent; next: number } {
  const ordered = lines[from].ordered;
  const items: JSONContent[] = [];
  let i = from;
  while (i < lines.length && lines[i].indent >= indent) {
    if (lines[i].indent > indent) {
      // Deeper lines belong to the previous item.
      const nested = buildList(lines, i, lines[i].indent);
      const parent = items.at(-1);
      if (parent) parent.content!.push(nested.node);
      else items.push({ type: 'listItem', content: [{ type: 'paragraph' }, nested.node] });
      i = nested.next;
      continue;
    }
    if (lines[i].ordered !== ordered) break;
    items.push({ type: 'listItem', content: [paragraph(lines[i].text)] });
    i++;
  }
  return { node: { type: ordered ? 'orderedList' : 'bulletList', content: items }, next: i };
}

export function markdownToDoc(markdown: string): JSONContent {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const content: JSONContent[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*```/.test(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      content.push(code.length ? { type: 'codeBlock', content: [{ type: 'text', text: code.join('\n') }] } : { type: 'codeBlock' });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      const inner = inline(heading[2]);
      content.push({ type: 'heading', attrs: { level: heading[1].length === 1 ? 1 : 2 }, ...(inner.length ? { content: inner } : {}) });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      content.push({ type: 'horizontalRule' });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      content.push({ type: 'blockquote', content: quote.filter((q) => q.trim()).map(paragraph) });
      continue;
    }
    if (listLine(line)) {
      const list: ListLine[] = [];
      while (i < lines.length) {
        const item = listLine(lines[i]);
        if (item) list.push(item);
        else if (lines[i].trim() && list.length && /^\s{2,}/.test(lines[i])) list[list.length - 1].text += ` ${lines[i].trim()}`;
        else if (!lines[i].trim() && i + 1 < lines.length && listLine(lines[i + 1])) {
          // A blank line between items of one list.
        } else break;
        i++;
      }
      let at = 0;
      while (at < list.length) {
        const built = buildList(list, at, list[at].indent);
        content.push(built.node);
        at = built.next;
      }
      continue;
    }
    // A paragraph: consecutive plain lines.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !listLine(lines[i])) para.push(lines[i++].trim());
    content.push(paragraph(para.join(' ')));
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
