import { nanoid } from 'nanoid';
import type { ScriptBlock, ScriptBlockType, ScriptTitlePage } from '../model/types';
import { displayText } from './layout';

/** Fountain (fountain.io) and Final Draft (.fdx) import and export. */

export const EMPTY_TITLE_PAGE: ScriptTitlePage = { title: '', credit: '', authors: '', source: '', draftDate: '', contact: '' };

export interface ParsedScript {
  titlePage: ScriptTitlePage;
  blocks: ScriptBlock[];
}

const block = (type: ScriptBlockType, text: string, dual = false): ScriptBlock => ({ id: nanoid(10), type, text, ...(dual ? { dual: true } : {}) });

// ---------- Fountain ----------

const FOUNTAIN_SCENE = /^(INT|EXT|EST|INT\.?\/EXT|INT\/EXT|I\/E|ИНТ|НАТ|ЭКСТ|ИНТ\.?\/НАТ)[.\s]/i;
const STANDARD_SCENE = /^(INT|EXT|EST|INT\.?\/EXT|INT\/EXT|I\/E)[.\s]/i;
const TITLE_KEYS: Record<string, keyof ScriptTitlePage> = {
  title: 'title',
  credit: 'credit',
  author: 'authors',
  authors: 'authors',
  source: 'source',
  'draft date': 'draftDate',
  date: 'draftDate',
  contact: 'contact',
};

const isUpper = (s: string) => /\p{L}/u.test(s) && s === s.toLocaleUpperCase('ru-RU');
/** Removes Fountain emphasis markers and notes. */
const plain = (s: string) =>
  s
    .replace(/\[\[[\s\S]*?\]\]/g, '')
    .replace(/\\\*/g, '\u0000')
    .replace(/\*{1,3}([^*]+?)\*{1,3}/g, '$1')
    .replace(/_([^_]+?)_/g, '$1')
    .replace(/\u0000/g, '*')
    .trim();

export function parseFountain(source: string): ParsedScript {
  let text = source.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const titlePage = { ...EMPTY_TITLE_PAGE };

  // Title page: "Key: value" lines at the very top, up to the first blank line.
  const firstBlank = text.search(/\n\s*\n/);
  const head = firstBlank >= 0 ? text.slice(0, firstBlank) : text;
  if (/^[A-Za-z ]+:/.test(head.trimStart())) {
    let key: keyof ScriptTitlePage | null = null;
    for (const line of head.split('\n')) {
      const m = line.match(/^([A-Za-z ]+):\s*(.*)$/);
      if (m && !/^\s/.test(line)) {
        key = TITLE_KEYS[m[1].trim().toLowerCase()] ?? null;
        if (key && m[2].trim()) titlePage[key] = plain(m[2]);
      } else if (key && line.trim()) {
        titlePage[key] = titlePage[key] ? `${titlePage[key]}\n${plain(line)}` : plain(line);
      }
    }
    text = firstBlank >= 0 ? text.slice(firstBlank) : '';
  }

  const lines = text.split('\n');
  const blocks: ScriptBlock[] = [];
  let inDialogue = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const prevBlank = i === 0 || !lines[i - 1].trim();
    const nextBlank = i === lines.length - 1 || !lines[i + 1].trim();
    if (!line) {
      inDialogue = false;
      continue;
    }
    if (/^(#|=(?!==)|===+$)/.test(line)) continue; // sections, synopses, page breaks
    if (inDialogue) {
      if (/^\(.*\)$/.test(line)) blocks.push(block('parenthetical', plain(line.slice(1, -1))));
      else {
        const last = blocks[blocks.length - 1];
        // Consecutive dialogue lines belong to one speech paragraph.
        if (last?.type === 'dialogue') last.text = `${last.text} ${plain(line)}`;
        else blocks.push(block('dialogue', plain(line)));
      }
      continue;
    }
    if (line.startsWith('!')) {
      blocks.push(block('action', plain(line.slice(1))));
      continue;
    }
    if (/^>.*<$/.test(line)) {
      blocks.push(block('centered', plain(line.slice(1, -1))));
      continue;
    }
    if (line.startsWith('>')) {
      blocks.push(block('transition', plain(line.slice(1))));
      continue;
    }
    if (prevBlank && (line.startsWith('.') && !line.startsWith('..') ? true : FOUNTAIN_SCENE.test(line))) {
      const heading = (line.startsWith('.') ? line.slice(1) : line).replace(/\s*#[^#]+#\s*$/, '');
      blocks.push(block('scene', plain(heading)));
      continue;
    }
    if (prevBlank && nextBlank && isUpper(line) && /TO:$|^(ЗТМ|ЗАТЕМНЕНИЕ)/.test(line)) {
      blocks.push(block('transition', plain(line)));
      continue;
    }
    const forcedCharacter = line.startsWith('@');
    const name = forcedCharacter ? line.slice(1) : line;
    if (prevBlank && !nextBlank && (forcedCharacter || isUpper(name.replace(/\(.*?\)/g, '')))) {
      const dual = /\^\s*$/.test(name);
      blocks.push(block('character', plain(name.replace(/\s*\^\s*$/, '')), dual));
      inDialogue = true;
      continue;
    }
    const last = blocks[blocks.length - 1];
    // Action lines without a blank line between them form one paragraph.
    if (!prevBlank && last?.type === 'action') last.text = `${last.text}\n${plain(line)}`;
    else blocks.push(block('action', plain(raw.replace(/^\t/, '    ').trimEnd())));
  }
  return { titlePage, blocks: blocks.length ? blocks : [block('scene', '')] };
}

export function toFountain(blocks: ScriptBlock[], titlePage: ScriptTitlePage): string {
  const out: string[] = [];
  const tp: [string, string][] = [
    ['Title', titlePage.title],
    ['Credit', titlePage.credit],
    ['Author', titlePage.authors],
    ['Source', titlePage.source],
    ['Draft date', titlePage.draftDate],
    ['Contact', titlePage.contact],
  ];
  const filled = tp.filter(([, v]) => v.trim());
  if (filled.length) {
    for (const [k, v] of filled) {
      const [first, ...rest] = v.split('\n');
      out.push(rest.length ? `${k}:\n${[first, ...rest].map((l) => `    ${l}`).join('\n')}` : `${k}: ${first}`);
    }
    out.push('');
  }
  const push = (text: string, blankBefore: boolean) => {
    if (blankBefore && out.length && out[out.length - 1] !== '') out.push('');
    out.push(text);
  };
  for (const b of blocks) {
    const text = displayText(b);
    switch (b.type) {
      case 'scene':
        push(STANDARD_SCENE.test(text) ? text : `.${text}`, true);
        break;
      case 'character':
        push(`${/[^\x00-\x7f]/.test(text) ? '@' : ''}${text}${b.dual ? ' ^' : ''}`, true);
        break;
      case 'parenthetical':
      case 'dialogue':
        push(text, false);
        break;
      case 'transition':
        push(/TO:$/.test(text) ? text : `> ${text}`, true);
        break;
      case 'centered':
        push(`> ${text} <`, true);
        break;
      case 'shot':
        push(`!${text}`, true);
        break;
      default: {
        // Lines that Fountain would read as something else are forced to action.
        const risky = isUpper(text) || FOUNTAIN_SCENE.test(text) || text.startsWith('>') || text.startsWith('.');
        push(`${risky ? '!' : ''}${text}`, true);
      }
    }
  }
  return `${out.join('\n').trim()}\n`;
}

// ---------- Final Draft ----------

const FDX_TYPES: Record<string, ScriptBlockType> = {
  'Scene Heading': 'scene',
  Action: 'action',
  Character: 'character',
  Parenthetical: 'parenthetical',
  Dialogue: 'dialogue',
  Transition: 'transition',
  Shot: 'shot',
  General: 'action',
};
const FDX_NAMES: Record<ScriptBlockType, string> = {
  scene: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  shot: 'Shot',
  centered: 'Action',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function parseFdx(xml: string): ParsedScript {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || !doc.querySelector('FinalDraft')) throw new Error('Это не файл Final Draft (.fdx).');
  const textOf = (p: Element) =>
    [...p.children]
      .filter((c) => c.tagName === 'Text')
      .map((t) => t.textContent ?? '')
      .join('')
      .replace(/\s+\n/g, '\n')
      .trim();
  const blocks: ScriptBlock[] = [];
  const read = (p: Element, dualSecond: boolean) => {
    const type = FDX_TYPES[p.getAttribute('Type') ?? ''] ?? 'action';
    let text = textOf(p);
    if (type === 'parenthetical') text = text.replace(/^\(|\)$/g, '');
    const centred = p.getAttribute('Alignment') === 'Center' && type === 'action';
    blocks.push(block(centred ? 'centered' : type, text, dualSecond && type === 'character'));
  };
  const content = doc.querySelector('FinalDraft > Content');
  for (const p of content ? [...content.children] : []) {
    if (p.tagName !== 'Paragraph') continue;
    const dual = p.querySelector(':scope > DualDialogue');
    if (dual) {
      let characters = 0;
      for (const inner of [...dual.children]) {
        if (inner.tagName !== 'Paragraph') continue;
        if (inner.getAttribute('Type') === 'Character') characters++;
        read(inner, characters === 2);
      }
    } else read(p, false);
  }
  const titlePage = { ...EMPTY_TITLE_PAGE };
  const tpLines = [...doc.querySelectorAll('FinalDraft > TitlePage Paragraph')].map(textOf).filter(Boolean);
  if (tpLines.length) {
    titlePage.title = tpLines[0];
    const credit = tpLines.findIndex((l, i) => i > 0 && /written by|screenplay by|by$|автор|сценарий/i.test(l));
    if (credit > 0) {
      titlePage.credit = tpLines[credit];
      titlePage.authors = tpLines[credit + 1] ?? '';
      titlePage.contact = tpLines.slice(credit + 2).join('\n');
    } else titlePage.contact = tpLines.slice(1).join('\n');
  }
  return { titlePage, blocks: blocks.length ? blocks : [block('scene', '')] };
}

export function toFdx(blocks: ScriptBlock[], titlePage: ScriptTitlePage): string {
  const para = (b: ScriptBlock) => {
    const text = b.type === 'parenthetical' ? displayText(b) : b.text;
    const align = b.type === 'centered' ? ' Alignment="Center"' : '';
    return `    <Paragraph Type="${FDX_NAMES[b.type]}"${align}>\n      <Text>${esc(text)}</Text>\n    </Paragraph>`;
  };
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // A speech followed by a dual one: wrap both in <DualDialogue>.
    if (b.type === 'character') {
      let j = i + 1;
      while (j < blocks.length && (blocks[j].type === 'dialogue' || blocks[j].type === 'parenthetical')) j++;
      if (blocks[j]?.type === 'character' && blocks[j].dual) {
        let k = j + 1;
        while (k < blocks.length && (blocks[k].type === 'dialogue' || blocks[k].type === 'parenthetical')) k++;
        out.push(`    <Paragraph>\n      <DualDialogue>\n${blocks.slice(i, k).map((x) => para(x).replace(/^/gm, '    ')).join('\n')}\n      </DualDialogue>\n    </Paragraph>`);
        i = k - 1;
        continue;
      }
    }
    out.push(para(b));
  }
  const tp = [titlePage.title, '', titlePage.credit, titlePage.authors, '', titlePage.source, titlePage.draftDate, titlePage.contact]
    .flatMap((l) => l.split('\n'))
    .map((l) => `      <Paragraph Alignment="Center" Type="Action">\n        <Text>${esc(l)}</Text>\n      </Paragraph>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script" Template="No" Version="5">\n  <Content>\n${out.join('\n')}\n  </Content>\n  <TitlePage>\n    <Content>\n${tp}\n    </Content>\n  </TitlePage>\n</FinalDraft>\n`;
}
