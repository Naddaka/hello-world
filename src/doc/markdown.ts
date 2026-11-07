import type { JSONContent } from '@tiptap/core';

function inline(nodes: JSONContent[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n';
      if (n.type !== 'text') return inline(n.content);
      let t = (n.text ?? '').replace(/([*_`~\\[\]])/g, '\\$1');
      for (const mark of n.marks ?? []) {
        if (mark.type === 'code') t = '`' + (n.text ?? '') + '`';
        else if (mark.type === 'bold') t = `**${t}**`;
        else if (mark.type === 'italic') t = `*${t}*`;
        else if (mark.type === 'strike') t = `~~${t}~~`;
        else if (mark.type === 'highlight') t = `==${t}==`;
        else if (mark.type === 'link') t = `[${t}](${mark.attrs?.href ?? ''})`;
      }
      return t;
    })
    .join('');
}

function block(node: JSONContent, indent: string): string[] {
  const children = node.content ?? [];
  switch (node.type) {
    case 'paragraph':
      return [indent + inline(children)];
    case 'heading':
      return [`${'#'.repeat(node.attrs?.level ?? 1)} ${inline(children)}`];
    case 'blockquote':
      return children.flatMap((c) => block(c, '')).map((l) => `> ${l}`);
    case 'codeBlock':
      return ['```', ...(children.map((c) => c.text ?? '').join('').split('\n')), '```'];
    case 'horizontalRule':
      return ['---'];
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return children.flatMap((item, i) => {
        const marker =
          node.type === 'orderedList' ? `${i + 1}. ` : node.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}] ` : '- ';
        const [first, ...rest] = item.content ?? [];
        const head = first ? block(first, '')[0] ?? '' : '';
        const sub = rest.flatMap((c) => block(c, indent + '  '));
        return [`${indent}${marker}${head.trimStart()}`, ...sub];
      });
    default:
      return children.flatMap((c) => block(c, indent));
  }
}

/** Converts a rich text document to Markdown. */
export function toMarkdown(doc: JSONContent): string {
  const lines: string[] = [];
  for (const node of doc.content ?? []) {
    const out = block(node, '');
    if (lines.length && !(node.type?.endsWith('List') && lines[lines.length - 1] === '')) lines.push('');
    lines.push(...out);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
