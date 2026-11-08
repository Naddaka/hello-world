import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import type { ScriptBlock, ScriptBlockType } from '../model/types';
import { FORMATS, displayText, linesPerPage, looksLikeScene, looksLikeTransition, paginate, parseHeading, scriptStats, wrap, type Page } from './layout';
import { parseFdx, parseFountain, toFdx, toFountain } from './formats';
import { blocksToDoc, docToBlocks, scriptExtensions } from './schema';
import { plainText } from './print';

let n = 0;
const b = (type: ScriptBlockType, text: string, dual = false): ScriptBlock => ({ id: `b${n++}`, type, text, ...(dual ? { dual: true } : {}) });
const hollywood = FORMATS.hollywood;
const lineCount = (p: Page) => p.items.reduce((s, it) => s + (it.kind === 'dual' ? Math.max(it.left.length, it.right.length) : 1), 0);
const texts = (p: Page) => p.items.flatMap((it) => (it.kind === 'line' ? [it.line.text] : it.kind === 'blank' ? [''] : []));
const sentence = 'Она медленно идёт по пирсу и смотрит на воду.';

describe('screenplay layout', () => {
  it('wraps between words and hard-splits very long words', () => {
    expect(wrap('один два три четыре', 9)).toEqual(['один два', 'три', 'четыре']);
    expect(wrap('ааааааааааааа', 5)).toEqual(['ааааа', 'ааааа', 'ааа']);
    expect(wrap('', 10)).toEqual(['']);
  });

  it('prints headings and names in capitals and parentheticals in brackets', () => {
    expect(displayText({ type: 'scene', text: 'инт. кухня — день' })).toBe('ИНТ. КУХНЯ — ДЕНЬ');
    expect(displayText({ type: 'parenthetical', text: 'тихо' })).toBe('(тихо)');
    expect(displayText({ type: 'action', text: 'Маша входит.' })).toBe('Маша входит.');
  });

  it('recognises scene headings and transitions', () => {
    expect(looksLikeScene('инт. кухня — день')).toBe(true);
    expect(looksLikeScene('НАТ. ПИРС - НОЧЬ')).toBe(true);
    expect(looksLikeScene('EXT. PIER - NIGHT')).toBe(true);
    expect(looksLikeScene('Интересно, что дальше')).toBe(false);
    expect(looksLikeTransition('CUT TO:')).toBe(true);
    expect(looksLikeTransition('СМЕНА ПЛАНА:')).toBe(true);
    expect(looksLikeTransition('Он сказал:')).toBe(false);
    expect(parseHeading('ИНТ. КВАРТИРА МАШИ — НОЧЬ')).toEqual({ prefix: 'ИНТ.', location: 'КВАРТИРА МАШИ', time: 'НОЧЬ' });
  });

  it('fills pages to the line limit and never leaves a scene heading at the bottom', () => {
    const blocks: ScriptBlock[] = [];
    for (let s = 0; s < 30; s++) {
      blocks.push(b('scene', `ИНТ. КОМНАТА ${s} — ДЕНЬ`));
      for (let a = 0; a < 5; a++) blocks.push(b('action', `${sentence} ${sentence}`));
    }
    const pages = paginate(blocks, hollywood);
    const capacity = linesPerPage(hollywood);
    expect(capacity).toBe(54);
    expect(pages.length).toBeGreaterThan(5);
    for (const p of pages) {
      expect(lineCount(p)).toBeLessThanOrEqual(capacity);
      const last = p.items.filter((it) => it.kind !== 'blank').at(-1);
      if (p !== pages.at(-1) && last?.kind === 'line') expect(last.line.type).not.toBe('scene');
      // No page starts with an empty line.
      expect(p.items[0].kind).not.toBe('blank');
    }
  });

  it("splits a long speech with (MORE) and (CONT'D)", () => {
    const blocks = [b('scene', 'INT. ROOM - DAY'), ...Array.from({ length: 22 }, () => b('action', 'He waits. And waits.')), b('character', 'Mary'), b('dialogue', Array.from({ length: 30 }, () => 'I never said that.').join(' '))];
    const pages = paginate(blocks, hollywood);
    expect(pages.length).toBe(2);
    const first = texts(pages[0]);
    const second = texts(pages[1]);
    expect(first.at(-1)).toBe('(MORE)');
    expect(second[0]).toBe("MARY (CONT'D)");
    expect(first.at(-2)!.trim().endsWith('.')).toBe(true); // split at a sentence end
  });

  it('uses Russian words for Russian scripts', () => {
    const blocks = [b('scene', 'ИНТ. КОМНАТА — ДЕНЬ'), ...Array.from({ length: 26 }, () => b('action', 'Он ждёт. И ждёт.')), b('character', 'Маша'), b('dialogue', Array.from({ length: 30 }, () => 'Я этого не говорила.').join(' '))];
    const pages = paginate(blocks, FORMATS.russian);
    expect(texts(pages[0]).at(-1)).toBe('(ДАЛЬШЕ)');
    expect(texts(pages[1])[0]).toBe('МАША (ПРОД.)');
  });

  it('puts dual dialogue side by side', () => {
    const pages = paginate([b('character', 'Маша'), b('dialogue', 'Да!'), b('character', 'Петя', true), b('dialogue', 'Нет!')], hollywood);
    const dual = pages[0].items.find((it) => it.kind === 'dual');
    expect(dual).toMatchObject({ kind: 'dual', left: [{ text: 'МАША' }, { text: 'Да!' }], right: [{ text: 'ПЕТЯ' }, { text: 'Нет!' }] });
  });

  it('measures scenes in eighths of a page and lists the cast', () => {
    const blocks = [
      b('scene', 'ИНТ. КУХНЯ — ДЕНЬ'),
      b('action', 'Маша варит кофе.'),
      b('character', 'Маша'),
      b('dialogue', 'Привет.'),
      b('character', 'Петя (З.К.)'),
      b('dialogue', 'Привет!'),
      b('scene', 'НАТ. ДВОР — НОЧЬ'),
      ...Array.from({ length: 13 }, () => b('action', 'Тишина.')),
    ];
    const stats = scriptStats(blocks, hollywood);
    expect(stats.scenes.map((s) => s.heading)).toEqual(['ИНТ. КУХНЯ — ДЕНЬ', 'НАТ. ДВОР — НОЧЬ']);
    expect(stats.scenes[0].eighths).toBe(1); // 9 lines of 54
    expect(stats.scenes[1].eighths).toBe(4); // 28 lines
    expect(stats.scenes[0].characters).toEqual(['МАША', 'ПЕТЯ']);
    expect(stats.characters.map((c) => c.name)).toEqual(['МАША', 'ПЕТЯ']);
    expect(stats.locations).toEqual(['ДВОР', 'КУХНЯ']);
    expect(stats.pages).toBe(1);
    expect(stats.minutes).toBe(1);
  });

  it('renders plain text pages with industry indents', () => {
    const text = plainText({ format: 'hollywood', sceneNumbers: false, blocks: [b('character', 'Mary'), b('dialogue', 'Hi.')] } as never);
    expect(text.split('\n')).toEqual([`${' '.repeat(22)}MARY`, `${' '.repeat(10)}Hi.`]);
  });
});

const FOUNTAIN = `Title: Северный ветер
Credit: Автор сценария
Author: Роман

INT. PIER - NIGHT

Wind. A lighthouse blinks.

MARY
(quietly)
Where is he?

.ПОДВАЛ — ДЕНЬ

@МАША
Здесь.

ПЕТЯ ^
Тоже здесь.

CUT TO:

> THE END <
`;

describe('Fountain and Final Draft', () => {
  it('parses Fountain', () => {
    const { titlePage, blocks } = parseFountain(FOUNTAIN);
    expect(titlePage).toMatchObject({ title: 'Северный ветер', credit: 'Автор сценария', authors: 'Роман' });
    expect(blocks.map((x) => [x.type, x.text])).toEqual([
      ['scene', 'INT. PIER - NIGHT'],
      ['action', 'Wind. A lighthouse blinks.'],
      ['character', 'MARY'],
      ['parenthetical', 'quietly'],
      ['dialogue', 'Where is he?'],
      ['scene', 'ПОДВАЛ — ДЕНЬ'],
      ['character', 'МАША'],
      ['dialogue', 'Здесь.'],
      ['character', 'ПЕТЯ'],
      ['dialogue', 'Тоже здесь.'],
      ['transition', 'CUT TO:'],
      ['centered', 'THE END'],
    ]);
    expect(blocks[8].dual).toBe(true);
  });

  it('round-trips through Fountain and Final Draft', () => {
    const { titlePage, blocks } = parseFountain(FOUNTAIN);
    const shape = (list: ScriptBlock[]) => list.map((x) => [x.type, displayText(x), !!x.dual]);
    expect(shape(parseFountain(toFountain(blocks, titlePage)).blocks)).toEqual(shape(blocks));
    const fdx = toFdx(blocks, titlePage);
    expect(fdx).toContain('<DualDialogue>');
    const back = parseFdx(fdx);
    expect(shape(back.blocks)).toEqual(shape(blocks));
    expect(back.titlePage.title).toBe('Северный ветер');
    expect(back.titlePage.authors).toBe('Роман');
  });

  it('rejects files that are not Final Draft', () => {
    expect(() => parseFdx('<html></html>')).toThrow();
  });
});

describe('screenplay editor keys', () => {
  const editorWith = (blocks: ScriptBlock[]) => new Editor({ extensions: scriptExtensions(), content: blocksToDoc(blocks) });
  const kinds = (e: Editor) => docToBlocks(e.getJSON()).map((x) => `${x.type}:${x.text}`);

  it('Enter and Tab move through the usual sequence of paragraphs', () => {
    const e = editorWith([b('action', '')]);
    e.commands.focus('end');
    e.commands.insertContent('инт. кухня — день');
    e.commands.keyboardShortcut('Enter'); // the heading is recognised, next is action
    e.commands.insertContent('Маша варит кофе.');
    e.commands.keyboardShortcut('Enter');
    e.commands.keyboardShortcut('Tab'); // empty action → character
    e.commands.insertContent('маша');
    e.commands.keyboardShortcut('Enter'); // → dialogue
    e.commands.insertContent('Доброе утро.');
    e.commands.keyboardShortcut('Tab'); // at the end of dialogue → a new parenthetical
    e.commands.insertContent('зевает');
    e.commands.keyboardShortcut('Enter'); // → dialogue
    e.commands.insertContent('Кофе будешь?');
    e.commands.keyboardShortcut('Enter'); // → action
    e.commands.keyboardShortcut('Enter'); // empty action stays action and adds another line
    expect(kinds(e)).toEqual([
      'scene:инт. кухня — день',
      'action:Маша варит кофе.',
      'character:маша',
      'dialogue:Доброе утро.',
      'parenthetical:зевает',
      'dialogue:Кофе будешь?',
      'action:',
      'action:',
    ]);
    e.destroy();
  });

  it('⌘ shortcuts pick a paragraph kind and Enter on an empty line returns to action', () => {
    const e = editorWith([b('action', 'ЗТМ')]);
    e.commands.focus('end');
    e.commands.keyboardShortcut('Mod-6');
    expect(kinds(e)).toEqual(['transition:ЗТМ']);
    e.commands.keyboardShortcut('Enter'); // transition → scene heading
    expect(kinds(e)).toEqual(['transition:ЗТМ', 'scene:']);
    e.commands.keyboardShortcut('Enter'); // empty heading → action
    expect(kinds(e)).toEqual(['transition:ЗТМ', 'action:']);
    e.destroy();
  });

  it('keeps block ids unique', () => {
    const blocks = docToBlocks(blocksToDoc([b('action', 'a'), { ...b('action', 'b'), id: 'b0x' }, { ...b('action', 'c'), id: 'b0x' }]));
    expect(new Set(blocks.map((x) => x.id)).size).toBe(3);
  });
});
