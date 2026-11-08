import { nanoid } from 'nanoid';
import { commit, useStore, canvasChildren, columnChildren } from '../model/store';
import type { Op } from '../model/ops';
import { DEFAULT_WIDTH, GRID, type ScriptElement, type ShotInfo, type SketchElement, type TableElement, type ZElement } from '../model/types';
import { FORMATS, eighthsLabel, scriptStats } from './layout';
import { breakdownTable } from './breakdown';

/** Shot vocabulary, with the usual abbreviations for the shot list. */
export const SHOT_SIZES: { label: string; short: string }[] = [
  { label: 'Дальний', short: 'EWS' },
  { label: 'Общий', short: 'WS' },
  { label: 'Средний', short: 'MS' },
  { label: 'Поясной', short: 'MCU' },
  { label: 'Крупный', short: 'CU' },
  { label: 'Сверхкрупный', short: 'ECU' },
  { label: 'Деталь', short: 'INSERT' },
];
export const SHOT_ANGLES = ['Нейтральный', 'Сверху', 'Снизу', 'С высоты птичьего полёта', 'Голландский угол', 'Через плечо', 'Субъективный (POV)'];
export const SHOT_MOVES = ['Статика', 'Панорама', 'Наклон', 'Наезд', 'Отъезд', 'Тревеллинг', 'Кран', 'Стедикам', 'С рук', 'Дрон', 'Зум'];

export const emptyShot = (scene = '', shot = ''): ShotInfo => ({ scene, shot, size: '', angle: '', movement: '', lens: '', duration: null });

/** "1.2" — scene and shot. */
export const shotNumber = (s: ShotInfo) => [s.scene, s.shot].filter(Boolean).join('.');

export const sizeShort = (size: string) => SHOT_SIZES.find((s) => s.label === size)?.short ?? size;

const FRAME_WIDTH = 26;
const FRAME_GAP = 3;
const ROW_HEIGHT = 27;

/**
 * Builds a storyboard board next to the script: one row per scene with the
 * heading and a summary, followed by empty frames numbered for that scene.
 * Returns the id of the new board.
 */
export function makeStoryboard(script: ScriptElement, framesPerScene = 3): string | null {
  const stats = scriptStats(script.blocks, FORMATS[script.format]);
  if (!stats.scenes.length) return null;
  const now = Date.now();
  const parentId = script.parentId ?? useStore.getState().boardId;
  const boardId = nanoid();
  const base = (parent: string, x: number, y: number, z: number, width: number) => ({ id: nanoid(), parentId: parent, section: 'CANVAS' as const, x, y, z, width, createdAt: now, updatedAt: now });
  const ops: Op[] = [{ kind: 'create', element: { ...base(parentId, script.x, script.y + 20, script.z + 1, DEFAULT_WIDTH.BOARD), id: boardId, type: 'BOARD', title: `Раскадровка · ${script.title}`, color: 'purple' } }];
  let z = 1;
  stats.scenes.forEach((scene, row) => {
    const y = row * ROW_HEIGHT;
    const next = stats.scenes[row + 1]?.block ?? script.blocks.length;
    const action = script.blocks.slice(scene.block + 1, next).find((b) => b.type === 'action' && b.text.trim())?.text ?? '';
    const summary = action.length > 160 ? `${action.slice(0, 157)}…` : action;
    ops.push({
      kind: 'create',
      element: {
        ...base(boardId, 0, y, z++, 30),
        type: 'CARD',
        color: 'yellow',
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: `${scene.number}. ${scene.heading}`, marks: [{ type: 'bold' }] }] },
            ...(summary ? [{ type: 'paragraph', content: [{ type: 'text', text: summary }] }] : []),
            { type: 'paragraph', content: [{ type: 'text', text: `${eighthsLabel(scene.eighths)} стр.${scene.characters.length ? ` · ${scene.characters.join(', ')}` : ''}`, marks: [{ type: 'small' }] }] },
          ],
        },
      },
    });
    for (let k = 0; k < framesPerScene; k++) {
      ops.push({
        kind: 'create',
        element: { ...base(boardId, 33 + k * (FRAME_WIDTH + FRAME_GAP), y, z++, FRAME_WIDTH), type: 'SKETCH', strokes: [], aspect: 16 / 9, caption: '', shot: emptyShot(String(scene.number), String(k + 1)) },
      });
    }
  });
  commit(ops);
  return boardId;
}

/** A new frame right after `frame`, numbered as the next shot of the same scene. */
export function addFrameAfter(frame: SketchElement): string {
  const now = Date.now();
  const shot = frame.shot ?? emptyShot();
  const n = Number.parseInt(shot.shot, 10);
  const element: SketchElement = {
    id: nanoid(),
    type: 'SKETCH',
    parentId: frame.parentId,
    section: frame.section,
    x: frame.x + frame.width + FRAME_GAP,
    y: frame.y,
    z: frame.z + 1,
    width: frame.width,
    createdAt: now,
    updatedAt: now,
    strokes: [],
    aspect: frame.aspect,
    caption: '',
    shot: emptyShot(shot.scene, Number.isFinite(n) ? String(n + 1) : ''),
  };
  commit([{ kind: 'create', element }]);
  return element.id;
}

/** Natural order of shot numbers: 2 < 10, 1A after 1. */
function compareShots(a: ShotInfo, b: ShotInfo) {
  const cmp = (x: string, y: string) => x.localeCompare(y, 'ru', { numeric: true });
  return cmp(a.scene, b.scene) || cmp(a.shot, b.shot);
}

/** Storyboard frames on a board (including inside its columns), in shot order. */
export function framesOn(boardId: string): SketchElement[] {
  const elements = useStore.getState().elements;
  const all: ZElement[] = [];
  for (const e of canvasChildren(elements, boardId)) {
    all.push(e);
    if (e.type === 'COLUMN') all.push(...columnChildren(elements, e.id));
  }
  return all.filter((e): e is SketchElement => e.type === 'SKETCH' && !!e.shot).sort((a, b) => compareShots(a.shot!, b.shot!) || a.y - b.y || a.x - b.x);
}

export const SHOT_LIST_HEADER = ['Сцена', 'Кадр', 'Крупность', 'Ракурс', 'Движение', 'Оптика', 'Длит., с', 'Описание'];

/** Rows of a shot list for the frames, with a total of the planned durations. */
export function shotListCells(frames: SketchElement[]): string[][] {
  const rows = frames.map((f) => {
    const s = f.shot!;
    return [s.scene, s.shot, s.size, s.angle, s.movement, s.lens, s.duration != null ? String(s.duration) : '', f.caption];
  });
  const total = rows.length ? ['Итого', String(rows.length), '', '', '', '', `=SUM(G2:G${rows.length + 1})`, ''] : [];
  return [SHOT_LIST_HEADER, ...rows, ...(rows.length ? [total] : [])];
}

const COL_WIDTHS: Record<string, number> = { Сцена: 64, Кадр: 56, 'Длит., с': 80, Описание: 240, Персонажи: 180, '№': 40, Объект: 160 };

/** A table element ready to be placed on a board. */
export function tableFields(cells: string[][], totalRow: boolean): Pick<TableElement, 'type' | 'cells' | 'colWidths' | 'formats' | 'header'> {
  const colWidths = cells[0].map((h) => COL_WIDTHS[h] ?? 110);
  const formats: TableElement['formats'] = {};
  if (totalRow) cells[cells.length - 1].forEach((_, c) => (formats[`${cells.length - 1},${c}`] = { bold: true }));
  return { type: 'TABLE', cells, colWidths, formats, header: true };
}

const tableWidthGU = (colWidths: number[]) => Math.ceil(colWidths.reduce((a, b) => a + b, 0) / GRID) + 2;

function placeTable(fields: Pick<TableElement, 'type' | 'cells' | 'colWidths' | 'formats' | 'header'>, parentId: string, x: number, y: number): string {
  const now = Date.now();
  const elements = useStore.getState().elements;
  const z = Math.max(0, ...canvasChildren(elements, parentId).map((e) => e.z)) + 1;
  const element: TableElement = { id: nanoid(), parentId, section: 'CANVAS', x, y, z, width: tableWidthGU(fields.colWidths), createdAt: now, updatedAt: now, ...fields };
  commit([{ kind: 'create', element }]);
  return element.id;
}

/** Shot list of all frames on the board, placed below them. */
export function makeShotList(boardId: string): string | null {
  const frames = framesOn(boardId);
  if (!frames.length) return null;
  const left = Math.min(...frames.map((f) => f.x));
  const bottom = Math.max(...frames.map((f) => f.y + Math.ceil((f.width * GRID) / f.aspect / GRID) + 8));
  return placeTable(tableFields(shotListCells(frames), true), boardId, left, bottom + 4);
}

/** Breakdown table of the script, placed next to its tile. */
export function makeBreakdownTable(script: ScriptElement): string {
  const parentId = script.parentId ?? useStore.getState().boardId;
  return placeTable(tableFields(breakdownTable(script), false), parentId, script.x, script.y + 24);
}
