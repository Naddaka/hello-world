import { describe, expect, it, vi } from 'vitest';
import { getSchema, type JSONContent } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import fixture from '../../e2e/fixtures/milanote-export.json';
import { noteExtensions } from '../editor/extensions';
import { boardIconFrom, MN_ICON_TO_LUCIDE, planIconRefresh } from './milanoteIcons';
import { decodeSvgSource, sanitizeSvg } from '../icons/svgIcon';
import { boardIconOf, convertMilanote, customHex, finalizeImport, isMilanoteExport, type MilanoteExport, type StoredMedia } from './milanote';
import { draftToDoc, milanoteDoc, milanotePlain } from './milanoteText';
import exporterSource from './milanoteExporter.js?raw';
import type { ZElement } from '../model/types';

const data = fixture as unknown as MilanoteExport;
const schema = getSchema(noteExtensions());

/** Throws unless the document fits our editor schema exactly. */
function assertValid(doc: JSONContent) {
  Node.fromJSON(schema, doc).check();
}

function convert() {
  const plan = convertMilanote(data, 0);
  const byId = Object.fromEntries(plan.elements.map((e) => [e.id, e])) as Record<string, ZElement>;
  return { plan, byId };
}

const textOf = (doc: JSONContent): string => (doc.text ?? '') + (doc.content ?? []).map(textOf).join('');

describe('Milanote text', () => {
  it('converts Draft.js blocks, styles, links and lists', () => {
    const doc = milanoteDoc(data.elements.c1.content!.textContent);
    assertValid(doc);
    const [h1, para, bullets, tasks, small, code, centred] = doc.content!;
    expect(h1).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(para.content![0]).toEqual({ type: 'text', text: 'Клип', marks: [{ type: 'bold' }] });
    expect(para.content!.find((n) => n.marks?.some((m) => m.type === 'link'))).toMatchObject({ text: 'Сайт режиссёра', marks: [{ type: 'link', attrs: { href: 'https://example.com/director' } }] });
    expect(bullets.type).toBe('bulletList');
    expect(bullets.content).toHaveLength(2);
    expect(bullets.content![0].content![1].type).toBe('bulletList'); // nested "на рассвете"
    expect(tasks).toMatchObject({ type: 'taskList', content: [{ attrs: { checked: true } }, { attrs: { checked: false } }] });
    expect(small.content![0].marks).toEqual([{ type: 'small' }]);
    expect(code).toEqual({ type: 'codeBlock', content: [{ type: 'text', text: 'ffmpeg -i in.mov\n-c:v prores' }] });
    expect(centred.attrs).toEqual({ textAlign: 'center' });
    // Offsets count an emoji as one character.
    expect(centred.content!.find((n) => n.marks)).toMatchObject({ text: '🎬', marks: [{ type: 'italic' }] });
  });

  it('maps the Milanote TipTap schema onto ours', () => {
    const doc = milanoteDoc(data.elements.c2.content!.textContent);
    assertValid(doc);
    expect(doc.content![0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(doc.content![1].content![0].marks).toEqual([{ type: 'small' }]);
    expect(doc.content![2]).toMatchObject({ type: 'blockquote' });
    expect(textOf(doc.content![2])).toBe('💡 Идея: снимать на 35 мм');
    expect(textOf(doc.content![3])).toBe('Позвонить @Рома цвет маркер');
    // Text colour is dropped, bold kept; a yellow highlight is the plain one.
    expect(doc.content![3].content!.find((n) => n.text === ' цвет')!.marks).toEqual([{ type: 'bold' }]);
    expect(doc.content![3].content!.find((n) => n.text === ' маркер')!.marks).toEqual([{ type: 'highlight' }]);
  });

  it('turns plain strings and JSON strings into documents', () => {
    expect(milanoteDoc('a\nb').content).toHaveLength(2);
    expect(milanotePlain(JSON.stringify({ blocks: [{ text: 'из JSON' }] }))).toBe('из JSON');
    expect(milanoteDoc(null)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    assertValid(draftToDoc({ blocks: [] }));
  });
});

describe('Milanote conversion', () => {
  it('recognises the export format', () => {
    expect(isMilanoteExport(data)).toBe(true);
    expect(isMilanoteExport({ elements: {} })).toBe(false);
  });

  it('builds the board tree under a "Milanote" board', () => {
    const { plan, byId } = convert();
    expect(plan.rootId).toBe('mn-H');
    expect(byId['mn-H']).toMatchObject({ type: 'BOARD', title: 'Milanote' });
    expect(byId['mn-Q']).toMatchObject({ type: 'BOARD', title: 'Быстрые заметки', parentId: 'mn-H' });
    expect(byId['mn-T']).toMatchObject({ type: 'BOARD', title: 'Шаблоны', parentId: 'mn-H', isTemplate: true });
    expect(byId['mn-t1']).toMatchObject({ parentId: 'mn-T', isTemplate: true });
    expect(byId['mn-q1'].parentId).toBe('mn-Q');
    expect(byId['mn-b1']).toMatchObject({ type: 'BOARD', title: 'Клип «Северный ветер»', color: 'blue', parentId: 'mn-H', x: 84, y: 4 });
    expect(byId['mn-b2']).toMatchObject({ title: 'Архив' });
    expect(byId['mn-b3c'].parentId).toBe('mn-b3');
    expect(byId['mn-c1']).toMatchObject({ width: 34, createdAt: 1700000000000, updatedAt: 1700000500000 });
  });

  it('keeps stacking order, colours and labels', () => {
    const { byId } = convert();
    expect(byId['mn-c2'].z).toBeLessThan(byId['mn-c1'].z);
    expect(byId['mn-c1'].z).toBeLessThan(byId['mn-c3'].z);
    expect(byId['mn-c2']).toMatchObject({ color: 'yellow' });
    expect(byId['mn-c3']).toMatchObject({ color: '#7cd651', labels: ['mn-label-lab1'] });
    expect(byId['mn-label-lab1']).toMatchObject({ type: 'LABEL', name: 'Важно', color: 'red', parentId: null });
  });

  it('converts columns, task lists, tables, swatches and lines', () => {
    const { byId } = convert();
    expect(byId['mn-cc2'].z).toBeLessThan(byId['mn-cc1'].z);
    expect(byId['mn-cc1'].parentId).toBe('mn-col1');
    expect(byId['mn-col1']).toMatchObject({ type: 'COLUMN', title: 'Сцены' });
    expect(byId['mn-tl1']).toMatchObject({
      type: 'TASK_LIST',
      title: 'Подготовка',
      items: [
        { text: 'Арендовать свет', done: true, due: null },
        { text: 'Взять дрон', done: false, due: 1767225600000 },
      ],
    });
    expect(byId['mn-tl2']).toMatchObject({
      title: 'Монтаж',
      items: [
        { text: 'Черновая сборка', done: true, indent: 0 },
        { text: 'звук', done: false, indent: 1 },
        { text: 'Цветокор', done: false, indent: 0 },
      ],
    });
    expect(byId['mn-tb1']).toMatchObject({
      type: 'TABLE',
      header: true,
      cells: [
        ['Позиция', 'Цена', 'Кол-во'],
        ['Свет', '5000', '2'],
        ['Итого', '=SUM(B2:B2)', ''],
      ],
      colWidths: [112, 80, 80],
    });
    expect((byId['mn-tb1'] as Extract<ZElement, { type: 'TABLE' }>).formats['1,1']).toEqual({ kind: 'currency' });
    expect((byId['mn-tb1'] as Extract<ZElement, { type: 'TABLE' }>).formats['2,0']).toEqual({ bold: true });
    expect(byId['mn-sw1']).toMatchObject({ type: 'COLOR_SWATCH', hex: '#ff8d48', name: 'Закатный' });
    expect(byId['mn-ln1']).toMatchObject({
      type: 'LINE',
      parentId: 'mn-b1',
      start: { elementId: 'mn-img1' },
      end: { elementId: 'mn-f1' },
      label: 'смотри',
      weight: 3,
      color: 'red',
      arrowEnd: true,
      arrowStart: false,
    });
    expect(byId['mn-ln2']).toMatchObject({ start: { elementId: null, x: 10, y: 60 }, end: { elementId: null, x: 30, y: 60 }, weight: 1, arrowEnd: false });
  });

  it('converts comments, synced copies, shortcuts and documents', () => {
    const { byId } = convert();
    expect(byId['mn-ct1']).toMatchObject({ type: 'COMMENT', attachedTo: 'mn-cc1', parentId: 'mn-b1' });
    expect((byId['mn-ct1'] as Extract<ZElement, { type: 'COMMENT' }>).messages.map((m) => m.text)).toEqual(['Пересветить небо', 'Согласен']);
    expect((byId['mn-ct1'] as Extract<ZElement, { type: 'COMMENT' }>).messages[1].reactions).toEqual(['👍']);
    expect(byId['mn-ct2']).toMatchObject({ attachedTo: null, parentId: 'mn-b1' });
    const clone = byId['mn-cl1'] as Extract<ZElement, { type: 'CARD' }>;
    expect(clone.syncGroup).toBeTruthy();
    expect((byId['mn-c1'] as Extract<ZElement, { type: 'CARD' }>).syncGroup).toBe(clone.syncGroup);
    expect(clone.content).toEqual((byId['mn-c1'] as Extract<ZElement, { type: 'CARD' }>).content);
    expect(byId['mn-al1']).toMatchObject({ type: 'ALIAS', targetId: 'mn-b2' });
    expect(byId['mn-d1']).toMatchObject({ type: 'DOCUMENT', title: 'Сценарий' });
  });

  it('skips the trash, parks orphans and marks unknown types', () => {
    const { plan, byId } = convert();
    expect(byId['mn-tr1']).toBeUndefined();
    expect(plan.report.trashed).toBe(1);
    expect(byId['mn-in1']).toMatchObject({ section: 'INBOX', parentId: 'mn-b1' });
    expect(byId['mn-o1']).toMatchObject({ section: 'INBOX', parentId: 'mn-H' });
    expect(plan.report.orphans).toBe(1);
    expect(plan.report.unknownTypes).toEqual(['HOLOGRAM']);
    expect(byId['mn-hx'].type).toBe('CARD');
    expect(plan.report.exportErrors).toHaveLength(1);
  });

  it('every converted note and document fits the editor schema', () => {
    const { plan } = convert();
    for (const e of plan.elements) if (e.type === 'CARD' || e.type === 'DOCUMENT') assertValid(e.content);
  });

  it('lists media and fills them in after download; failures become links', () => {
    const { plan } = convert();
    const keys = plan.media.map((m) => m.key).sort();
    expect(keys).toEqual(['file-f1', 'icon-t1', 'img-img1', 'img-img2', 'svg-sk1']);
    expect(plan.media.find((m) => m.key === 'svg-sk1')!.svg).toContain('<svg');
    const results = new Map<string, StoredMedia | null>([
      ['img-img1', { id: 'm1', ext: 'svg', width: 400, height: 300 }],
      ['file-f1', { id: 'm2', ext: 'txt', size: 12 }],
      ['svg-sk1', { id: 'm3', ext: 'svg' }],
      ['img-img2', null],
      ['icon-t1', { id: 'm4', ext: 'png' }],
    ]);
    const done = Object.fromEntries(finalizeImport(plan, results).map((e) => [e.id, e]));
    expect(done['mn-img1']).toMatchObject({ type: 'IMAGE', media: { id: 'm1', ext: 'svg' }, caption: 'Кадр с пирса', showCaption: true });
    expect(done['mn-f1']).toMatchObject({ type: 'FILE', media: { id: 'm2', ext: 'txt' }, name: 'заметки.txt' });
    expect(done['mn-sk1']).toMatchObject({ type: 'IMAGE', media: { id: 'm3' }, caption: 'Раскадровка 1', naturalWidth: 320, naturalHeight: 180 });
    expect(done['mn-img2']).toMatchObject({ type: 'LINK', url: 'https://media.invalid/p/missing.jpg' });
    expect(plan.report.failedMedia).toEqual([{ name: 'missing.jpg', url: 'https://media.invalid/p/missing.jpg' }]);
    // Nothing still points at a pending download.
    expect(JSON.stringify(Object.values(done))).not.toContain('pending:');
  });
});

describe('Milanote exporter script', () => {
  it('crawls every board through the API and hands the result over in chunks', async () => {
    const boards: Record<string, Record<string, unknown>> = {
      root: { root: { id: 'root', elementType: 'BOARD', location: {} }, a: { id: 'a', elementType: 'BOARD', location: { parentId: 'root' } }, s: { id: 's', elementType: 'ALIAS', location: { parentId: 'root' }, content: { linkTo: 'far' } } },
      a: { a: { id: 'a', elementType: 'BOARD', location: { parentId: 'root' } }, n: { id: 'n', elementType: 'CARD', location: { parentId: 'a' } } },
      far: { far: { id: 'far', elementType: 'BOARD', location: { parentId: 'someone-else' } } },
    };
    const requests: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      requests.push(url);
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      const u = new URL(url, 'https://app.milanote.com');
      if (u.pathname === '/api/users/me') return new Response(JSON.stringify({ user: { rootBoardId: 'root' } }));
      const ids = u.searchParams.get('ids')!.split(',');
      return new Response(JSON.stringify({ elements: Object.assign({}, ...ids.map((id) => boards[id] ?? {})), comments: {}, labels: {} }));
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('token', 'tok');
    const messages: { kind: string; data: string }[] = [];
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (_cmd: string, args: { kind: string; data: string }) => void messages.push(args),
    };
    const run = new Function(`return (${exporterSource})`)() as (o: object) => Promise<{ boards: number; elements: number }>;
    const result = await run({ tauri: true });
    vi.unstubAllGlobals();

    expect(result).toEqual({ boards: 3, elements: 5, errors: 0 });
    expect(requests.filter((r) => r.includes('/api/boards'))).toHaveLength(2);
    const json = messages.filter((m) => m.kind === 'chunk').map((m) => m.data).join('');
    const exported = JSON.parse(json);
    expect(isMilanoteExport(exported)).toBe(true);
    expect(Object.keys(exported.elements).sort()).toEqual(['a', 'far', 'n', 'root', 's']);
    expect(messages.at(-1)!.kind).toBe('done');
  });
});

describe('Milanote highlight colours', () => {
  it('keeps the colour of a highlight and stays valid for the editor', () => {
    const para = (color: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'highlight', attrs: { color } }] }] }] });
    const marks = (color: string) => {
      const doc = milanoteDoc(para(color));
      assertValid(doc);
      return doc.content![0].content![0].marks;
    };
    expect(marks('green')).toEqual([{ type: 'highlight', attrs: { color: 'green' } }]);
    expect(marks('#12ab34')).toEqual([{ type: 'highlight', attrs: { color: '#12ab34' } }]);
    expect(marks('yellow')).toEqual([{ type: 'highlight' }]);
    expect(marks('CHARCOAL')).toEqual([{ type: 'highlight' }]);
  });
});

describe('Milanote board icons and custom colours', () => {
  const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  const duotone = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512"><defs><style>.fa-secondary{opacity:.4}</style></defs><path class="fa-secondary" d="M0 0h10v10z"/><path class="fa-primary" d="M20 0h10v10z"/></svg>';

  it('draws mn-svg glyphs from the export in the board colour, the faint layer kept faint', () => {
    const got = boardIconOf({ type: 'mn-svg', id: 'reel-fake', name: 'Катушка', svg: b64(duotone), png: 'https://media.invalid/x.png' });
    expect(got).toMatchObject({ exact: true });
    const icon = (got as { icon: string }).icon;
    expect(icon.startsWith('svg:<svg')).toBe(true);
    expect(icon).toContain('viewBox="0 0 640 512"');
    expect(icon).toContain('fill="currentColor"');
    expect(icon).toContain('<path d="M0 0h10v10z" opacity="0.4">');
    expect(icon).toContain('<path d="M20 0h10v10z">');
    expect(icon).not.toContain('style');
  });

  it('keeps nothing but shapes from an SVG', () => {
    const evil = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" onload="alert(1)"><script>alert(2)</script><path d="M1 1h2" onclick="alert(3)" style="fill:url(javascript:x)"/><a xlink:href="javascript:alert(4)"><path d="M5 5h1"/></a><image href="https://evil.invalid/x.png"/><foreignObject><div>x</div></foreignObject><path d="M1 1&quot; onmouseover=&quot;x" transform="url(#a)"/></svg>';
    const clean = sanitizeSvg(evil)!;
    expect(clean).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1 1h2"></path></svg>');
    expect(sanitizeSvg('<html><script>x</script></html>')).toBeNull();
    expect(sanitizeSvg('<svg><script>x</script></svg>')).toBeNull();
    expect(decodeSvgSource('data:image/svg+xml;base64,' + b64(duotone))).toBe(duotone);
  });

  it('fills Sketch-style glyphs (a coloured group inside a fill="none" group) with the board colour', () => {
    const sketch = '<svg viewBox="0 0 24 24"><g fill="none" fill-rule="evenodd"><g fill="#000000"><path d="M2 2h20v20H2z"/></g></g></svg>';
    expect(sanitizeSvg(sketch)).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><g fill-rule="evenodd" fill="none"><g fill="currentColor"><path d="M2 2h20v20H2z"></path></g></g></svg>');
    expect(sanitizeSvg('<svg viewBox="0 0 24 24"><path fill="#ff0000" stroke="#00ff00" d="M1 1h2"/></svg>')).toContain('<path d="M1 1h2" fill="currentColor" stroke="currentColor">');
  });

  it('draws a glyph made of the secondary layer alone at full strength', () => {
    const numberOnly = '<svg viewBox="0 0 24 24"><path class="fa-secondary" d="M1 1h2"/></svg>';
    expect(sanitizeSvg(numberOnly)).not.toContain('opacity');
    // Milanote's two-digit numbers: the whole glyph sits under opacity 0.4.
    const allFaint = '<svg viewBox="0 0 24 24"><g fill="none" opacity="0.4"><g fill="#000000"><path d="M1 1h2"/></g></g></svg>';
    expect(sanitizeSvg(allFaint)).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><g fill="none"><g fill="currentColor"><path d="M1 1h2"></path></g></g></svg>');
    // Framed numbers: a faint frame next to a solid digit keeps its opacity.
    const framed = '<svg viewBox="0 0 24 24"><path opacity="0.4" d="M0 0h24v24H0z"/><path d="M8 8h8v8H8z"/></svg>';
    expect(sanitizeSvg(framed)).toContain('<path opacity="0.4" d="M0 0h24v24H0z">');
    const grouped = '<svg viewBox="0 0 24 24"><g class="fa-secondary"><path d="M1 1h2"/></g><path class="fa-primary" d="M3 3h2"/></svg>';
    expect(sanitizeSvg(grouped)).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><g opacity="0.4"><path d="M1 1h2"></path></g><path d="M3 3h2"></path></svg>');
  });

  it('falls back to a number or a Lucide icon of the same meaning without the SVG', () => {
    expect(boardIconOf({ type: 'mn-svg', id: 'mn-square-12' })).toEqual({ icon: 'text-box:12', exact: false });
    expect(boardIconOf({ type: 'mn-svg', id: 'square-3' })).toEqual({ icon: 'text-box:3', exact: false });
    expect(boardIconOf({ type: 'mn-svg', id: 'mn-15' })).toEqual({ icon: 'text:15', exact: false });
    expect(boardIconOf({ type: 'mn-svg', id: '7' })).toEqual({ icon: 'text:7', exact: false });
    expect(boardIconOf({ type: 'mn-svg', id: 'masks-theater' })).toEqual({ icon: 'lucide:drama', exact: false });
    expect(boardIconOf({ type: 'mn-svg', id: 'no-such-glyph' })).toBeNull();
  });

  it('every Lucide icon in the fallback table exists', async () => {
    const { default: lucide } = await import('../icons/lucide.json');
    const names = new Set((lucide as [string][]).map((i) => i[0]));
    expect(Object.values(MN_ICON_TO_LUCIDE).filter((n) => !names.has(n))).toEqual([]);
  });

  it('maps text, emoji and pictures', () => {
    expect(boardIconOf({ type: 'string', id: 'str-1', string: '1' })).toEqual({ icon: 'text:1', exact: true });
    expect(boardIconOf({ type: 'string', id: 'str-1', string: '2024' })).toEqual({ icon: 'text:2024', exact: true });
    expect(boardIconOf({ type: 'string', id: 'str-1', string: '~' })).toEqual({ icon: 'text:~', exact: true });
    expect(boardIconOf({ type: 'emoji', id: '1f3ac' })).toEqual({ icon: 'emoji:🎬', exact: true });
    expect(boardIconOf({ type: 'letter', id: 'a' })).toEqual({ icon: 'text:A', exact: true });
    expect(boardIconFrom({ icon: null, image: { regular: 'https://media.invalid/i/160.png', original: 'https://media.invalid/i/big.png' } })).toEqual({ match: { imageUrl: 'https://media.invalid/i/160.png' }, present: true, shape: 'image' });
    expect(boardIconFrom({ icon: null, image: null })).toEqual({ match: null, present: false, shape: '' });
    expect(boardIconOf(undefined)).toBeNull();
  });

  it('brings every kind of icon of the export over, and counts how', () => {
    const { plan, byId } = convert();
    expect(byId['mn-b1']).toMatchObject({ icon: expect.stringMatching(/^svg:<svg/) });
    expect(byId['mn-b2']).toMatchObject({ icon: 'text-box:12' });
    expect(byId['mn-b3']).toMatchObject({ icon: 'text:7' });
    expect(byId['mn-t1']).toMatchObject({ icon: 'pending:icon-t1' });
    expect(plan.report.icons).toEqual({ exact: 3, approx: 1, missing: 0, shapes: [] });
    const done = Object.fromEntries(finalizeImport(plan, new Map([['icon-t1', null]])).map((e) => [e.id, e]));
    expect(done['mn-t1']).not.toHaveProperty('icon');
    expect(plan.report.icons).toEqual({ exact: 2, approx: 1, missing: 1, shapes: ['image: не скачалась'] });
  });

  it('reports icons it does not understand by their shape, never their contents', () => {
    const copy = structuredClone(data) as MilanoteExport;
    (copy.elements.b1.content as Record<string, unknown>).icon = { type: 'sticker', ref: 'secret-name' };
    (copy.elements.b2.content as Record<string, unknown>).icon = { color: 'RED' };
    const { report } = convertMilanote(copy, 0);
    expect(report.icons.shapes).toEqual(['sticker: ref']);
    expect(report.icons.missing).toBe(1);
    expect(JSON.stringify(report.icons)).not.toContain('secret-name');
  });

  it('refreshes icons of imported boards only, keeping icons chosen by hand', () => {
    const boards = Object.entries(data.elements).filter(([, e]) => e.elementType === 'BOARD').map(([id, e]) => ({ id, content: e.content }));
    const els = {
      'mn-b1': { id: 'mn-b1', type: 'BOARD', icon: 'lucide:film' },
      'mn-b2': { id: 'mn-b2', type: 'BOARD' },
      'mn-b3': { id: 'mn-b3', type: 'BOARD', icon: 'text:7' },
    };
    const plan = planIconRefresh(els, boards, false);
    expect(plan.changes).toEqual([{ id: 'mn-b2', icon: 'text-box:12' }]);
    expect(plan).toMatchObject({ kept: 2, absent: 1, approx: 1 });
    const all = planIconRefresh(els, boards, true);
    expect(all.changes.map((c) => c.id)).toEqual(['mn-b1', 'mn-b2']);
    // A glyph stored by an earlier import is drawn again from the export even without "replace".
    const redraw = planIconRefresh({ ...els, 'mn-b1': { id: 'mn-b1', type: 'BOARD', icon: 'svg:<svg viewBox="0 0 1 1"></svg>' } }, boards, false);
    expect(redraw.changes.map((c) => c.id)).toEqual(['mn-b1', 'mn-b2']);
  });

  it('keeps colours mixed in Milanote and maps palette names to presets', () => {
    expect(customHex({ space: 'HEX', value: '#7cd651' })).toBe('#7cd651');
    expect(customHex('#ff8d48')).toBe('#ff8d48');
    expect(customHex('BLUE')).toBeNull();
    expect(customHex('TABLE_DEFAULT_HEADER_BACKGROUND_COLOR')).toBeNull();
    expect(customHex('#ffffff')).toBeNull();
  });
});
