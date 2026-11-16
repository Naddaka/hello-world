import { beforeEach, describe, expect, it } from 'vitest';
import type { ScriptBlock, ScriptElement, SketchElement, TableElement } from '../model/types';
import { __resetForTests, actions, clearHistory, useStore } from '../model/store';
import { FORMATS, scriptStats } from '../script/layout';
import { findStoryboard, framesOn, placeShots } from '../script/storyboard';
import { BREAKDOWN_SCHEMA, SHOTS_SCHEMA, applyTranslation, breakdownRequest, checkItems, checkShots, scriptForModel, shotsRequest, translateLines } from './scriptPrompts';

const block = (type: ScriptBlock['type'], text: string, i: number): ScriptBlock => ({ id: `b${i}`, type, text });
const BLOCKS: ScriptBlock[] = [
  ['scene', 'ИНТ. КУХНЯ — НОЧЬ'],
  ['action', 'Анна достаёт из ящика старый револьвер и кладёт на стол рядом с чашкой.'],
  ['character', 'Анна'],
  ['parenthetical', 'тихо'],
  ['dialogue', 'Он не заряжен.'],
  ['scene', 'НАТ. ДВОР — УТРО'],
  ['action', 'Старый грузовик стоит под дождём. Анна прячет револьвер в бардачок грузовика.'],
  ['transition', 'затемнение'],
].map(([t, text], i) => block(t as ScriptBlock['type'], text, i));

const script = { id: 's1', type: 'SCRIPT', parentId: 'home', section: 'CANVAS', x: 0, y: 0, z: 1, width: 20, title: 'Маяк', blocks: BLOCKS, format: 'russian', titlePage: { title: 'Маяк', credit: '', authors: '', source: '', draftDate: '', contact: '' }, sceneNumbers: true, createdAt: 0, updatedAt: 0 } as ScriptElement;

/** Every object of a schema the API accepts: closed, with all properties required. */
function assertStrict(schema: unknown, path = 'schema') {
  if (!schema || typeof schema !== 'object') return;
  const s = schema as Record<string, unknown>;
  if (s.type === 'object') {
    expect(s.additionalProperties, path).toBe(false);
    expect([...(s.required as string[])].sort(), path).toEqual(Object.keys(s.properties as object).sort());
    for (const [k, v] of Object.entries(s.properties as object)) assertStrict(v, `${path}.${k}`);
  }
  if (s.type === 'array') assertStrict(s.items, `${path}[]`);
  for (const banned of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) expect(s, path).not.toHaveProperty(banned);
}

describe('script features', () => {
  it('sends the script with numbered scenes, the same text for every action', () => {
    const text = scriptForModel(script);
    expect(text).toContain('### Сцена 1. ИНТ. КУХНЯ — НОЧЬ');
    expect(text).toContain('### Сцена 2. НАТ. ДВОР — УТРО');
    expect(text).toContain('    АННА\n    (тихо)\n    Он не заряжен.');
    const scene = scriptStats(BLOCKS, FORMATS.russian).scenes[1];
    // Two different actions share the cached script text.
    expect(breakdownRequest(script).context).toBe(shotsRequest(script, scene).context);
    expect(shotsRequest(script, scene).prompt).toContain('сцены 2');
  });

  it('uses schemas the API accepts', () => {
    assertStrict(BREAKDOWN_SCHEMA);
    assertStrict(SHOTS_SCHEMA);
  });

  it('checks proposed breakdown items against the text', () => {
    const items = checkItems(
      [
        { category: 'props', name: ' Револьвер. ', scenes: [1, 2] },
        { category: 'props', name: 'револьвер', scenes: [1] },
        { category: 'vehicles', name: 'старый грузовик', scenes: [2] },
        { category: 'props', name: 'чашка', scenes: [1] },
        { category: 'sfx', name: 'дождевальная машина', scenes: [2] },
        { category: 'weapons' as never, name: 'нож', scenes: [] },
        { category: 'props', name: '', scenes: [] },
      ],
      script,
      [{ id: 'x', category: 'props', name: 'Чашка' }],
    );
    expect(items.map((i) => [i.category, i.name, i.found, i.known])).toEqual([
      ['props', 'Револьвер', 2, false],
      ['props', 'чашка', 1, true],
      ['vehicles', 'старый грузовик', 1, false],
      // Not in the text: kept, but marked as not found.
      ['sfx', 'дождевальная машина', 0, false],
    ]);
  });

  it('keeps shots within the app’s vocabulary', () => {
    const shots = checkShots([
      { size: 'Крупный', angle: 'Снизу', movement: 'Наезд', lens: '85 мм', duration: 4.4, description: '  Револьвер   на столе. ' },
      { size: 'Гигантский', angle: 'Сбоку', movement: 'Полёт', lens: '', duration: -5, description: 'Двор' },
      { size: '', angle: '', movement: '', lens: '', duration: 3, description: '' },
    ] as never);
    expect(shots).toEqual([
      { size: 'Крупный', angle: 'Снизу', movement: 'Наезд', lens: '85 мм', duration: 4, description: 'Револьвер на столе.' },
      { size: '', angle: '', movement: '', lens: '', duration: 1, description: 'Двор' },
    ]);
  });

  it('applies a translation by line number and keeps what was skipped', () => {
    expect(translateLines(BLOCKS, 2, 5)).toBe('2|character|Анна\n3|parenthetical|тихо\n4|dialogue|Он не заряжен.');
    let n = 0;
    const { blocks, translated } = applyTranslation(BLOCKS, [{ i: 0, text: 'INT. KITCHEN — NIGHT' }, { i: 3, text: '(quietly)' }, { i: 4, text: "It's not loaded." }, { i: 99, text: 'x' }, { i: 1, text: '' }], () => `n${n++}`);
    expect(translated).toBe(3);
    expect(blocks[0]).toEqual({ id: 'n0', type: 'scene', text: 'INT. KITCHEN — NIGHT' });
    expect(blocks[3].text).toBe('quietly');
    expect(blocks[1].text).toBe(BLOCKS[1].text);
    expect(blocks).toHaveLength(BLOCKS.length);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(BLOCKS.length);
  });
});

describe('planned shots on the storyboard', () => {
  beforeEach(() => {
    __resetForTests();
    const home = { id: 'home', type: 'BOARD', parentId: null, section: 'CANVAS', x: 0, y: 0, z: 0, width: 8, title: 'Главная', color: 'blue', createdAt: 0, updatedAt: 0 };
    useStore.setState({ elements: { home, s1: script } as never, boardId: 'home', selection: [] });
    clearHistory();
  });

  const plan = [
    { size: 'Общий', angle: 'Нейтральный', movement: 'Статика', lens: '', duration: 5, description: 'Двор под дождём' },
    { size: 'Крупный', angle: 'Нейтральный', movement: 'Наезд', lens: '50 мм', duration: 3, description: 'Револьвер в бардачке' },
  ];

  it('makes the storyboard, fills the scene’s row, builds the shot list — and undoes in one step', () => {
    const boardId = placeShots(script, 2, plan)!;
    expect(findStoryboard(script)).toBe(boardId);
    const frames = framesOn(boardId);
    expect(frames.map((f) => [f.shot!.scene, f.shot!.shot, f.shot!.size, f.caption])).toEqual([
      ['2', '1', 'Общий', 'Двор под дождём'],
      ['2', '2', 'Крупный', 'Револьвер в бардачке'],
    ]);
    // In the row of the second scene, side by side.
    expect(new Set(frames.map((f) => f.y)).size).toBe(1);
    expect(frames[1].x).toBeGreaterThan(frames[0].x + frames[0].width);
    const table = Object.values(useStore.getState().elements).find((e): e is TableElement => e.type === 'TABLE' && e.parentId === boardId)!;
    expect(table.cells[1].slice(0, 3)).toEqual(['2', '1', 'Общий']);
    expect(table.cells.at(-1)![0]).toBe('Итого');
    actions.undo();
    expect(Object.values(useStore.getState().elements).map((e) => e.id).sort()).toEqual(['home', 's1']);
  });

  it('adds to a scene that already has frames and keeps one shot list', () => {
    const boardId = placeShots(script, 2, plan.slice(0, 1))!;
    placeShots(script, 2, plan.slice(1));
    placeShots(script, 1, plan.slice(0, 1));
    const frames = framesOn(boardId) as SketchElement[];
    expect(frames.map((f) => `${f.shot!.scene}.${f.shot!.shot}`)).toEqual(['1.1', '2.1', '2.2']);
    expect(frames[0].y).toBeLessThan(frames[1].y);
    expect(Object.values(useStore.getState().elements).filter((e) => e.type === 'TABLE' && e.parentId === boardId)).toHaveLength(1);
  });
});
