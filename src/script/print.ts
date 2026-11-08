import type { ScriptElement, ScriptBlockType } from '../model/types';
import { DUAL_CHARS, FORMATS, paginate, displayText, CHARS_PER_INCH, type FormatSpec, type Line, type Page } from './layout';
import { fileName, printHtml, saveFile } from '../storage/files';
import { toFdx, toFountain } from './formats';

/** Printed pages of a screenplay: exact layout from the paginator, in Courier 12 pt. */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = "'Courier New', Cousine, 'Courier Prime', Courier, monospace";

function lineHtml(line: Line, f: FormatSpec, numbers: boolean, dual = false): string {
  const ind = f.indent[line.type];
  const left = dual ? dualLeft(line.type) : ind.left;
  const width = dual ? (DUAL_CHARS[line.type] ?? 26) / CHARS_PER_INCH : ind.width;
  const align = line.generated === 'more' ? 'left' : (ind.align ?? 'left');
  const bold = line.type === 'scene' && f.sceneBold ? 'font-weight:700;' : '';
  let text = esc(line.text) || '&nbsp;';
  let margins = '';
  if (line.sceneNumber && numbers) {
    if (f.sceneNumbers === 'prefix') text = `${line.sceneNumber}. ${text}`;
    else margins = `<span class="sp-num l">${line.sceneNumber}</span><span class="sp-num r">${line.sceneNumber}</span>`;
  }
  const leftIn = line.generated === 'more' ? f.indent.character.left : left;
  return `<div class="sp-l" style="margin-left:${leftIn}in;width:${width}in;text-align:${align};${bold}">${margins}${text}</div>`;
}

function dualLeft(type: ScriptBlockType): number {
  return type === 'character' ? 0.9 : type === 'parenthetical' ? 0.4 : 0;
}

function pageHtml(page: Page, f: FormatSpec, numbers: boolean): string {
  const body = page.items
    .map((item) => {
      if (item.kind === 'blank') return '<div class="sp-l">&nbsp;</div>';
      if (item.kind === 'line') return lineHtml(item.line, f, numbers);
      const col = (lines: Line[]) => lines.map((l) => lineHtml(l, f, numbers, true)).join('');
      return `<div class="sp-dual"><div>${col(item.left)}</div><div>${col(item.right)}</div></div>`;
    })
    .join('');
  const num = page.number > 1 ? `<div class="sp-pageno">${page.number}.</div>` : '';
  return `<section class="sp-page" style="width:${f.page.w}in;height:${f.page.h}in;padding:${f.margin.top}in ${f.margin.right}in 0 ${f.margin.left}in">${num}${body}</section>`;
}

function titlePageHtml(s: ScriptElement, f: FormatSpec): string {
  const tp = s.titlePage;
  const title = tp.title || s.title;
  if (!title && !tp.authors) return '';
  const lines = (t: string) => esc(t).replace(/\n/g, '<br>');
  return `<section class="sp-page sp-title" style="width:${f.page.w}in;height:${f.page.h}in;padding:${f.margin.top}in ${f.margin.right}in ${f.margin.bottom}in ${f.margin.left}in">
    <div class="sp-title-main"><div class="sp-title-name">${lines(title.toLocaleUpperCase('ru-RU'))}</div>
    ${tp.credit ? `<div class="sp-gap">${lines(tp.credit)}</div>` : ''}${tp.authors ? `<div class="sp-gap1">${lines(tp.authors)}</div>` : ''}${tp.source ? `<div class="sp-gap">${lines(tp.source)}</div>` : ''}</div>
    <div class="sp-title-foot"><div>${lines(tp.contact)}</div><div>${lines(tp.draftDate)}</div></div>
  </section>`;
}

export function scriptPrintHtml(s: ScriptElement): string {
  const f = FORMATS[s.format];
  const pages = paginate(s.blocks, f);
  const css = `<style>
    @page { size: ${f.page.css}; margin: 0; }
    .sp-page { box-sizing: border-box; position: relative; overflow: hidden; background: #fff; color: #000; font: 12pt/${1 / 6}in ${FONT}; page-break-after: always; break-after: page; }
    .sp-page:last-child { page-break-after: auto; break-after: auto; }
    .sp-l { position: relative; height: ${1 / 6}in; white-space: pre; }
    .sp-num { position: absolute; top: 0; }
    .sp-num.l { left: -${f.indent.scene.left + 0.75}in; }
    .sp-num.r { right: -0.75in; }
    .sp-dual { display: grid; grid-template-columns: 3.05in 3.05in; }
    .sp-pageno { position: absolute; top: 0.5in; right: ${f.margin.right}in; }
    .sp-title { display: flex; flex-direction: column; justify-content: space-between; }
    .sp-title-main { margin-top: 3in; text-align: center; }
    .sp-title-name { text-decoration: underline; }
    .sp-gap { margin-top: ${2 / 6}in; } .sp-gap1 { margin-top: ${1 / 6}in; }
    .sp-title-foot { display: flex; justify-content: space-between; align-items: flex-end; }
  </style>`;
  return `${css}<div class="sp-print">${titlePageHtml(s, f)}${pages.map((p) => pageHtml(p, f, s.sceneNumbers)).join('')}</div>`;
}

export type ScriptExportFormat = 'pdf' | 'fountain' | 'fdx' | 'doc' | 'txt';

export async function exportScript(s: ScriptElement, format: ScriptExportFormat): Promise<boolean> {
  const title = s.titlePage.title || s.title || 'Сценарий';
  switch (format) {
    case 'pdf':
      await printHtml(scriptPrintHtml(s), title);
      return true;
    case 'fountain':
      return saveFile(fileName(title, 'fountain'), toFountain(s.blocks, { ...s.titlePage, title }), 'text/plain', { name: 'Fountain', extensions: ['fountain'] });
    case 'fdx':
      return saveFile(fileName(title, 'fdx'), toFdx(s.blocks, { ...s.titlePage, title }), 'application/xml', { name: 'Final Draft', extensions: ['fdx'] });
    case 'txt':
      return saveFile(fileName(title, 'txt'), plainText(s), 'text/plain', { name: 'Текст', extensions: ['txt'] });
    case 'doc':
      return saveFile(fileName(title, 'doc'), wordHtml(s), 'application/msword', { name: 'Word', extensions: ['doc'] });
  }
}

/** The pages as plain monospaced text (what a typewriter would produce). */
export function plainText(s: ScriptElement): string {
  const f = FORMATS[s.format];
  const pad = (l: Line) => {
    const ind = f.indent[l.type];
    const width = Math.floor(ind.width * CHARS_PER_INCH);
    const lead = Math.round(ind.left * CHARS_PER_INCH);
    const text = l.sceneNumber && s.sceneNumbers ? `${l.sceneNumber}. ${l.text}` : l.text;
    if (ind.align === 'right') return ' '.repeat(Math.max(0, lead + width - [...text].length)) + text;
    if (ind.align === 'center') return ' '.repeat(Math.max(0, lead + Math.floor((width - [...text].length) / 2))) + text;
    return ' '.repeat(lead) + text;
  };
  return paginate(s.blocks, f)
    .map((p) =>
      p.items
        .flatMap((item) => (item.kind === 'blank' ? [''] : item.kind === 'line' ? [pad(item.line)] : [...item.left, ...item.right].map(pad)))
        .join('\n'),
    )
    .join('\n\f\n');
}

function wordHtml(s: ScriptElement): string {
  const f = FORMATS[s.format];
  let scene = 0;
  const paras = s.blocks
    .map((b) => {
      const ind = f.indent[b.type];
      const space = f.spaceBefore[b.type] ? 'margin-top:12pt;' : 'margin-top:0;';
      let text = esc(displayText(b));
      if (b.type === 'scene' && s.sceneNumbers) text = `${++scene}. ${text}`;
      const bold = b.type === 'scene' && f.sceneBold ? 'font-weight:bold;' : '';
      return `<p style="${space}margin-bottom:0;margin-left:${ind.left}in;width:${ind.width}in;text-align:${ind.align ?? 'left'};${bold}">${text || '&nbsp;'}</p>`;
    })
    .join('\n');
  const tp = s.titlePage;
  const titleBlock = tp.title || s.title ? `<p style="text-align:center;margin-top:3in">${esc((tp.title || s.title).toLocaleUpperCase('ru-RU'))}</p><p style="text-align:center">${esc(tp.credit)}</p><p style="text-align:center">${esc(tp.authors)}</p><br style="page-break-before:always">` : '';
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(s.title)}</title>
<style>@page Section1 { size: ${f.page.w}in ${f.page.h}in; margin: ${f.margin.top}in ${f.margin.right}in ${f.margin.bottom}in ${f.margin.left}in; } div.Section1 { page: Section1; } body, p { font-family: 'Courier New', monospace; font-size: 12pt; line-height: 12pt; }</style></head>
<body><div class="Section1">${titleBlock}${paras}</div></body></html>`;
}
