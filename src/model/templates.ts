import { nanoid } from 'nanoid';
import type { JSONContent } from '@tiptap/core';
import type { ZElement } from './types';

const text = (t: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const doc = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks });
const h = (level: 1 | 2, t: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [text(t)] });
const p = (t: string): JSONContent => ({ type: 'paragraph', content: t ? [text(t)] : [] });

interface Builder {
  all: ZElement[];
  roots: ZElement[];
}

function make() {
  const all: ZElement[] = [];
  const roots: ZElement[] = [];
  let z = 0;
  return {
    all,
    roots,
    /** Adds an element; without a parent it is a top-level element of the template. */
    add(fields: Record<string, unknown>, parent?: string): string {
      const el = { id: nanoid(), parentId: parent ?? 'ROOT', section: 'CANVAS', x: 0, y: 0, width: 40, z: ++z, createdAt: 0, updatedAt: 0, ...fields } as unknown as ZElement;
      all.push(el);
      if (!parent) roots.push(el);
      return el.id;
    },
  };
}

const task = (t: string) => ({ id: nanoid(), text: t, done: false, due: null, indent: 0 });

export interface BuiltInTemplate {
  id: string;
  name: string;
  description: string;
  build: () => Builder;
}

/** Starting layouts for video production, offered on every empty board. */
export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    id: 'video-project',
    name: 'Проект ролика',
    description: 'Идея, референсы, задачи и смета на одной доске',
    build() {
      const b = make();
      b.add({ type: 'CARD', x: 0, y: 0, width: 40, color: 'default', content: doc(h(1, 'Название проекта'), p('Логлайн: о чём ролик в одном предложении.'), { type: 'bulletList', content: ['Хронометраж', 'Формат кадра', 'Площадка публикации', 'Дедлайн'].map((t) => ({ type: 'listItem', content: [p(t)] })) }) });
      const refs = b.add({ type: 'COLUMN', x: 46, y: 0, width: 36, title: 'Референсы', collapsed: false });
      b.add({ type: 'CARD', color: 'yellow', content: doc(p('Перетащите сюда кадры, ссылки и видео')) }, refs);
      b.add({ type: 'TASK_LIST', x: 0, y: 34, width: 40, title: 'Препродакшн', showTitle: true, items: ['Сценарий', 'Раскадровка', 'Локации', 'Кастинг', 'План съёмок'].map(task) });
      b.add({ type: 'TABLE', x: 88, y: 0, width: 46, cells: [['Статья', 'Сумма'], ['Камера и оптика', ''], ['Свет', ''], ['Площадка', ''], ['Итого', '=SUM(B2:B4)']], colWidths: [180, 160], formats: { '4,1': { kind: 'currency', bold: true }, '1,1': { kind: 'currency' }, '2,1': { kind: 'currency' }, '3,1': { kind: 'currency' } }, header: true });
      return b;
    },
  },
  {
    id: 'storyboard',
    name: 'Раскадровка',
    description: 'Шесть кадров 16:9 с номерами и параметрами кадра',
    build() {
      const b = make();
      const sizes = ['Общий', 'Средний', 'Крупный'];
      for (let i = 0; i < 6; i++) {
        const shot = { scene: String(Math.floor(i / 3) + 1), shot: String((i % 3) + 1), size: sizes[i % 3], angle: '', movement: i % 3 === 0 ? 'Статика' : '', lens: '', duration: null };
        b.add({ type: 'SKETCH', x: (i % 3) * 30, y: Math.floor(i / 3) * 27, width: 27, strokes: [], aspect: 16 / 9, caption: '', shot });
      }
      return b;
    },
  },
  {
    id: 'moodboard',
    name: 'Мудборд',
    description: 'Колонки для настроения, света и цвета',
    build() {
      const b = make();
      ['Настроение', 'Свет', 'Цвет и фактуры'].forEach((title, i) => {
        const col = b.add({ type: 'COLUMN', x: i * 40, y: 0, width: 36, title, collapsed: false });
        b.add({ type: 'CARD', color: 'default', content: doc(p('Добавьте изображения и ссылки')) }, col);
      });
      ['#1e2a44', '#3f5a8a', '#f4b183', '#e9e1d6'].forEach((hex, i) => b.add({ type: 'COLOR_SWATCH', x: 122 + i * 14, y: 0, width: 12, hex, name: '', display: 'hex' }));
      return b;
    },
  },
  {
    id: 'shot-list',
    name: 'Shot list',
    description: 'Таблица кадров с крупностью, оптикой и общей длительностью',
    build() {
      const b = make();
      const header = ['Сцена', 'Кадр', 'Крупность', 'Ракурс', 'Движение', 'Оптика', 'Длит., с', 'Описание'];
      const rows = [
        ['1', '1', 'Общий', 'Нейтральный', 'Статика', '24 мм', '5', ''],
        ['1', '2', 'Средний', '', 'Наезд', '35 мм', '4', ''],
        ['1', '3', 'Крупный', '', 'Статика', '85 мм', '3', ''],
      ];
      const cells = [header, ...rows, ['Итого', '3', '', '', '', '', '=SUM(G2:G4)', '']];
      const formats: Record<string, { bold: boolean }> = {};
      header.forEach((_, c) => (formats[`4,${c}`] = { bold: true }));
      b.add({ type: 'TABLE', x: 0, y: 0, width: 116, cells, colWidths: [64, 56, 110, 110, 110, 110, 80, 240], formats, header: true });
      return b;
    },
  },
  {
    id: 'shooting-day',
    name: 'Съёмочный день',
    description: 'Shot list, чек-лист и контакты команды',
    build() {
      const b = make();
      b.add({ type: 'TABLE', x: 0, y: 0, width: 72, cells: [['Кадр', 'Крупность', 'Оптика', 'Движение', 'Время'], ['1.1', 'Общий', '24', 'Статика', ''], ['1.2', 'Средний', '35', 'Наезд', ''], ['1.3', 'Крупный', '85', 'Статика', '']], colWidths: [80, 130, 90, 140, 110], formats: {}, header: true });
      b.add({ type: 'TASK_LIST', x: 0, y: 26, width: 40, title: 'Перед сменой', showTitle: true, items: ['Зарядить аккумуляторы', 'Проверить карты памяти', 'Прогноз погоды', 'Вызывной лист'].map(task) });
      b.add({ type: 'CARD', x: 46, y: 26, width: 34, color: 'blue', content: doc(h(2, 'Команда'), p('Режиссёр — '), p('Оператор — '), p('Звук — ')) });
      return b;
    },
  },
];
