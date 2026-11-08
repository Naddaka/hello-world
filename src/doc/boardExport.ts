import { plainText as scriptPlain } from '../script/print';
import { toPng } from 'html-to-image';
import { zipSync } from 'fflate';
import { generateHTML } from '@tiptap/core';
import { boardPath, canvasChildren, columnChildren, countChildren, useStore } from '../model/store';
import { GRID, type MediaRef, type ZElement } from '../model/types';
import { computeTable } from '../table/formula';
import { noteExtensions } from '../editor/extensions';
import { docText } from '../model/text';
import { toMarkdown } from './markdown';
import { media } from '../storage/media';
import { sizes } from '../canvas/runtime';
import { fileName, printHtml, saveFile } from '../storage/files';

const ext = noteExtensions();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const html = (doc: Parameters<typeof generateHTML>[0]) => {
  try {
    return generateHTML(doc, ext);
  } catch {
    return '';
  }
};

interface Block {
  md: string;
  html: string;
  text: string;
}

function cellText(v: unknown) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toLocaleDateString('ru-RU');
  if (typeof v === 'number') return v.toLocaleString('ru-RU');
  return String(v);
}

/** One element as Markdown, HTML and plain text, for the linear exports. */
function blockOf(e: ZElement, depth: number): Block[] {
  const elements = useStore.getState().elements;
  switch (e.type) {
    case 'CARD':
      return [{ md: toMarkdown(e.content).trim(), html: html(e.content), text: docText(e.content) }];
    case 'DOCUMENT':
      return [{ md: `## ${e.title}\n\n${toMarkdown(e.content).trim()}`, html: `<h2>${esc(e.title)}</h2>${html(e.content)}`, text: `${e.title}\n${docText(e.content)}` }];
    case 'SCRIPT': {
      const text = scriptPlain(e);
      return [{ md: `## ${e.title}\n\n\`\`\`\n${text}\n\`\`\``, html: `<h2>${esc(e.title)}</h2><pre style="font-family:'Courier New',monospace">${esc(text)}</pre>`, text: `${e.title}\n\n${text}` }];
    }
    case 'BOARD':
      return [{ md: `**Доска «${e.title}»** — ${countChildren(elements, e.id)} карт.`, html: `<p><b>Доска «${esc(e.title)}»</b></p>`, text: `Доска «${e.title}»` }];
    case 'ALIAS': {
      const t = elements[e.targetId];
      const title = t?.type === 'BOARD' ? t.title : 'удалённая доска';
      return [{ md: `↗ Ярлык на «${title}»`, html: `<p>↗ Ярлык на «${esc(title)}»</p>`, text: `Ярлык на «${title}»` }];
    }
    case 'COLUMN': {
      const inner = columnChildren(elements, e.id).flatMap((c) => blockOf(c, depth + 1));
      const h = '#'.repeat(Math.min(6, depth + 2));
      return [{ md: `${h} ${e.title}`, html: `<h${Math.min(6, depth + 2)}>${esc(e.title)}</h${Math.min(6, depth + 2)}>`, text: e.title.toUpperCase() }, ...inner];
    }
    case 'TASK_LIST': {
      const lines = e.items.map((i) => `${'  '.repeat(i.indent)}- [${i.done ? 'x' : ' '}] ${i.text}`);
      return [{
        md: `${e.showTitle ? `**${e.title}**\n\n` : ''}${lines.join('\n')}`,
        html: `${e.showTitle ? `<p><b>${esc(e.title)}</b></p>` : ''}<ul>${e.items.map((i) => `<li>${i.done ? '☑' : '☐'} ${esc(i.text)}</li>`).join('')}</ul>`,
        text: `${e.showTitle ? `${e.title}\n` : ''}${e.items.map((i) => `${i.done ? '[x]' : '[ ]'} ${i.text}`).join('\n')}`,
      }];
    }
    case 'TABLE': {
      const values = computeTable(e.cells).map((row) => row.map(cellText));
      if (values.length === 0) return [];
      const md = [`| ${values[0].join(' | ')} |`, `| ${values[0].map(() => '---').join(' | ')} |`, ...values.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n');
      return [{ md, html: `<table border="1" cellpadding="4">${values.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`, text: values.map((r) => r.join('\t')).join('\n') }];
    }
    case 'LINK':
      return [{ md: `[${e.title || e.url}](${e.url})${e.description ? `\n${e.description}` : ''}`, html: `<p><a href="${esc(e.url)}">${esc(e.title || e.url)}</a>${e.description ? `<br>${esc(e.description)}` : ''}</p>`, text: `${e.title} — ${e.url}` }];
    case 'IMAGE':
      return [{ md: `![${e.caption || e.name}](files/${e.media.id}.${e.media.ext})`, html: `<p>🖼 ${esc(e.caption || e.name)}</p>`, text: `[Изображение: ${e.caption || e.name}]` }];
    case 'FILE':
      return [{ md: `📎 ${e.name}`, html: `<p>📎 ${esc(e.name)}</p>`, text: `[Файл: ${e.name}]` }];
    case 'COLOR_SWATCH':
      return [{ md: `■ ${e.name} ${e.hex.toUpperCase()}`, html: `<p><span style="color:${e.hex}">■</span> ${esc(e.name)} ${e.hex.toUpperCase()}</p>`, text: `${e.name} ${e.hex}` }];
    case 'COMMENT':
      return e.messages.map((m) => ({ md: `> 💬 ${m.text}`, html: `<blockquote>💬 ${esc(m.text)}</blockquote>`, text: `Комментарий: ${m.text}` }));
    case 'SKETCH':
      return [{ md: `[Скетч${e.caption ? `: ${e.caption}` : ''}]`, html: `<p>[Скетч${e.caption ? `: ${esc(e.caption)}` : ''}]</p>`, text: `[Скетч ${e.caption}]` }];
    default:
      return [];
  }
}

/** Board content in reading order: top to bottom, then left to right. */
function linear(boardId: string): Block[] {
  const items = canvasChildren(useStore.getState().elements, boardId)
    .filter((e) => e.type !== 'LINE' && e.type !== 'DRAWING')
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return items.flatMap((e) => blockOf(e, 0));
}

function mediaOnBoard(boardId: string): { ref: MediaRef; name: string }[] {
  const elements = useStore.getState().elements;
  const seen = new Map<string, { ref: MediaRef; name: string }>();
  const visit = (parent: string) => {
    for (const e of Object.values(elements)) {
      if (e.parentId !== parent || e.section === 'TRASH') continue;
      if (e.type === 'IMAGE' || e.type === 'FILE') seen.set(e.media.id, { ref: e.media, name: e.name });
      if (e.type === 'LINK' && e.image) seen.set(e.image.id, { ref: e.image, name: `${e.title || 'превью'}.${e.image.ext}` });
      if (e.type === 'COLUMN') visit(e.id);
    }
  };
  visit(boardId);
  return [...seen.values()];
}

/** Renders the whole current board (not just the visible part) to a PNG. */
async function boardPng(scale: number): Promise<{ dataUrl: string; bytes: Uint8Array }> {
  const { elements, boardId } = useStore.getState();
  const layer = document.querySelector<HTMLElement>('.layer');
  const children = canvasChildren(elements, boardId).filter((e) => e.type !== 'LINE');
  if (!layer || children.length === 0) throw new Error('На доске нечего экспортировать');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of children) {
    const s = sizes.get(e.id) ?? { w: e.width * GRID, h: 120 };
    minX = Math.min(minX, e.x * GRID);
    minY = Math.min(minY, e.y * GRID);
    maxX = Math.max(maxX, e.x * GRID + s.w);
    maxY = Math.max(maxY, e.y * GRID + s.h);
  }
  const pad = 48;
  const frame = document.createElement('div');
  frame.className = 'export-frame';
  frame.style.width = `${maxX - minX + pad * 2}px`;
  frame.style.height = `${maxY - minY + pad * 2}px`;
  const clone = layer.cloneNode(true) as HTMLElement;
  clone.style.transform = `translate(${pad - minX}px, ${pad - minY}px)`;
  clone.querySelectorAll('.resize, .line-from, .line-handle, .formatbar, .table-bar').forEach((n) => n.remove());
  frame.appendChild(clone);
  document.body.appendChild(frame);
  try {
    const background = getComputedStyle(document.querySelector('.canvas')!).backgroundColor;
    const dataUrl = await toPng(frame, { pixelRatio: scale, backgroundColor: background, cacheBust: false });
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
    return { dataUrl, bytes };
  } finally {
    frame.remove();
  }
}

export type BoardExportFormat = 'pdf' | 'png' | 'doc' | 'md' | 'txt' | 'zip';

export async function exportBoard(format: BoardExportFormat) {
  const { elements, boardId } = useStore.getState();
  const title = boardPath(elements, boardId).at(-1)?.title ?? 'Доска';
  if (format === 'png') {
    const { bytes } = await boardPng(2);
    return saveFile(fileName(title, 'png'), bytes, 'image/png', { name: 'PNG', extensions: ['png'] });
  }
  if (format === 'pdf') {
    const { dataUrl } = await boardPng(2);
    await printHtml(`<article class="print-doc"><h1>${esc(title)}</h1><img src="${dataUrl}" style="max-width:100%"></article>`, title);
    return true;
  }
  if (format === 'zip') {
    const lib = await media();
    const files: Record<string, Uint8Array> = {};
    for (const { ref, name } of mediaOnBoard(boardId)) {
      const src = await lib.src(ref);
      if (!src) continue;
      const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
      let unique = name;
      for (let i = 2; files[unique]; i++) unique = name.replace(/(\.[^.]+)?$/, ` (${i})$1`);
      files[unique] = bytes;
    }
    if (Object.keys(files).length === 0) throw new Error('На доске нет файлов');
    return saveFile(fileName(title, 'zip'), zipSync(files, { level: 0 }), 'application/zip', { name: 'ZIP', extensions: ['zip'] });
  }
  const blocks = linear(boardId);
  if (format === 'md') return saveFile(fileName(title, 'md'), `# ${title}\n\n${blocks.map((b) => b.md).join('\n\n')}\n`, 'text/markdown', { name: 'Markdown', extensions: ['md'] });
  if (format === 'txt') return saveFile(fileName(title, 'txt'), `${title}\n\n${blocks.map((b) => b.text).join('\n\n')}\n`, 'text/plain', { name: 'Текст', extensions: ['txt'] });
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="font-family:Calibri,Arial,sans-serif"><h1>${esc(title)}</h1>${blocks.map((b) => b.html).join('\n')}</body></html>`;
  return saveFile(fileName(title, 'doc'), doc, 'application/msword', { name: 'Word', extensions: ['doc'] });
}
