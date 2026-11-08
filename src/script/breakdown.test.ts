import { describe, expect, it } from 'vitest';
import type { ScriptBlock, ScriptBlockType, SketchElement } from '../model/types';
import { addItem, breakdownScenes, breakdownTable, findItem, itemSceneCounts, renameItem } from './breakdown';
import { shotListCells, sizeShort, shotNumber, emptyShot } from './storyboard';
import { tableToCsv } from '../table/csv';
import { computeTable } from '../table/formula';

let n = 0;
const b = (type: ScriptBlockType, text: string): ScriptBlock => ({ id: `x${n++}`, type, text });

describe('breakdown', () => {
  it('finds items in any grammatical form, but not inside other words', () => {
    expect(findItem('Он достаёт револьвер.', 'револьвер')).toEqual([[11, 20]]);
    expect(findItem('Стреляет из револьвера, потом прячет револьвером…', 'Револьвер')).toHaveLength(2);
    expect(findItem('Подъезжает старого грузовика нет, стоит старый грузовик.', 'старый грузовик')).toHaveLength(2);
    expect(findItem('Кот спит. Котлета остыла. Нет кота.', 'кот')).toEqual([[0, 3], [30, 34]]);
    expect(findItem('скот', 'кот')).toEqual([]);
    expect(findItem('Он ждёт Машу. Машей. Машина уехала.', 'МАША')).toEqual([[8, 12], [14, 19]]);
    expect(findItem('', 'кот')).toEqual([]);
  });

  const script = {
    format: 'russian' as const,
    blocks: [
      b('scene', 'ИНТ. КВАРТИРА — ДЕНЬ'),
      b('action', 'Маша прячет револьвер в красный плащ.'),
      b('character', 'Маша'),
      b('dialogue', 'Никто не узнает.'),
      b('scene', 'НАТ. ДОРОГА — НОЧЬ'),
      b('action', 'По дороге несётся старый грузовик. В кабине — Петя с револьвером.'),
      b('character', 'Петя (З.К.)'),
      b('dialogue', 'Быстрее!'),
    ],
    breakdown: [
      { id: '1', category: 'props' as const, name: 'револьвер' },
      { id: '2', category: 'wardrobe' as const, name: 'красный плащ' },
      { id: '3', category: 'vehicles' as const, name: 'грузовик' },
    ],
  };

  it('builds a sheet for each scene', () => {
    const scenes = breakdownScenes(script);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({ number: 1, setting: 'ИНТ.', location: 'КВАРТИРА', time: 'ДЕНЬ', cast: ['МАША'], items: { props: ['револьвер'], wardrobe: ['красный плащ'] } });
    expect(scenes[1]).toMatchObject({ setting: 'НАТ.', location: 'ДОРОГА', time: 'НОЧЬ', cast: ['ПЕТЯ'], items: { props: ['револьвер'], vehicles: ['грузовик'] } });
    expect(itemSceneCounts(script).get('револьвер')).toBe(2);
  });

  it('lays the breakdown out as a table with a column per category in use', () => {
    const rows = breakdownTable(script);
    expect(rows[0]).toEqual(['№', 'Режим', 'Объект', 'Время', 'Стр.', 'Объём', 'Персонажи', 'Реквизит', 'Костюм', 'Транспорт']);
    expect(rows[1]).toEqual(['1', 'ИНТ.', 'КВАРТИРА', 'ДЕНЬ', '1', '1/8', 'МАША', 'револьвер', 'красный плащ', '']);
    expect(rows[2].slice(-3)).toEqual(['револьвер', '', 'грузовик']);
  });

  it('counts characters who are only mentioned in the action', () => {
    const scenes = breakdownScenes({
      format: 'russian',
      blocks: [b('scene', 'ИНТ. КУХНЯ — ДЕНЬ'), b('character', 'Маша'), b('dialogue', 'Пока.'), b('scene', 'ИНТ. СПАЛЬНЯ — НОЧЬ'), b('action', 'Петя смотрит на спящую Машу.'), b('character', 'Петя'), b('dialogue', 'Спи.')],
    });
    expect(scenes[1].cast).toEqual(['ПЕТЯ', 'МАША']);
    expect(scenes[0].cast).toEqual(['МАША']);
  });

  it('renames an item, e.g. to the base form of the word', () => {
    const list = [{ id: 'a', category: 'set' as const, name: 'лестнице' }];
    expect(renameItem(list, 'a', ' лестница ')).toEqual([{ id: 'a', category: 'set', name: 'лестница' }]);
    expect(renameItem(list, 'a', '  ')).toBe(list);
  });

  it('does not add the same item twice', () => {
    const list = addItem([], { id: 'a', category: 'props', name: ' Лампа ' });
    expect(list).toEqual([{ id: 'a', category: 'props', name: 'Лампа' }]);
    expect(addItem(list, { id: 'b', category: 'props', name: 'лампа' })).toBe(list);
    expect(addItem(list, { id: 'c', category: 'set', name: 'лампа' })).toHaveLength(2);
  });
});

describe('storyboard and shot list', () => {
  const frame = (scene: string, shot: string, extra: Partial<SketchElement['shot']> = {}, caption = ''): SketchElement =>
    ({ id: `f${scene}${shot}`, type: 'SKETCH', strokes: [], aspect: 16 / 9, caption, shot: { ...emptyShot(scene, shot), ...extra } }) as unknown as SketchElement;

  it('numbers and abbreviates shots', () => {
    expect(shotNumber(emptyShot('3', '2'))).toBe('3.2');
    expect(sizeShort('Крупный')).toBe('CU');
    expect(sizeShort('свой')).toBe('свой');
  });

  it('builds a shot list whose total duration is a formula', () => {
    const cells = shotListCells([frame('1', '1', { size: 'Общий', duration: 5 }, 'Пирс на рассвете'), frame('1', '2', { duration: 2.5 })]);
    expect(cells[0][0]).toBe('Сцена');
    expect(cells[1]).toEqual(['1', '1', 'Общий', '', '', '', '5', 'Пирс на рассвете']);
    expect(cells.at(-1)![6]).toBe('=SUM(G2:G3)');
    expect(computeTable(cells).at(-1)![6]).toBe(7.5);
  });

  it('exports tables to CSV with computed values', () => {
    const csv = tableToCsv([['Статья', 'Сумма'], ['Свет; аренда', '100'], ['Итого', '=SUM(B2:B2)']]);
    expect(csv).toBe('﻿Статья;Сумма\r\n"Свет; аренда";100\r\nИтого;100\r\n');
  });
});
