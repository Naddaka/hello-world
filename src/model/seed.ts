import type { JSONContent } from '@tiptap/core';
import { HOME_ID, type BoardElement, type CardElement, type ZElement } from './types';

const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const li = (text: string): JSONContent => ({ type: 'listItem', content: [p(t(text))] });

/** Content created on first launch: the home board, a welcome note and a sample project. */
export function seedElements(at: number): ZElement[] {
  const base = { section: 'CANVAS' as const, createdAt: at, updatedAt: at };
  const home: BoardElement = { ...base, id: HOME_ID, type: 'BOARD', parentId: null, x: 0, y: 0, width: 14, z: 0, title: 'Главная', color: 'blue' };
  const welcome: CardElement = {
    ...base,
    id: 'welcome',
    type: 'CARD',
    parentId: HOME_ID,
    x: 0,
    y: 0,
    width: 42,
    z: 1,
    color: 'default',
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [t('Добро пожаловать в Zadum')] },
        p(t('Это ваша '), t('главная доска', [{ type: 'bold' }]), t(' — отсюда начинаются все проекты.')),
        {
          type: 'bulletList',
          content: [
            li('Двойной клик по пустому месту — новая заметка'),
            li('Перетащите «Доску» с панели слева, чтобы начать проект'),
            li('Двойной клик по доске открывает её'),
            li('Пробел + перетаскивание — двигать холст, ⌘ + колесо — масштаб'),
          ],
        },
        p(t('⌘⇧D', [{ type: 'code' }]), t(' переключает тёмную тему.')),
      ],
    },
  };
  const project: BoardElement = { ...base, id: 'sample-project', type: 'BOARD', parentId: HOME_ID, x: 48, y: 0, width: 14, z: 2, title: 'Мой первый проект', color: 'orange' };
  const projectNote: CardElement = {
    ...base,
    id: 'sample-note',
    type: 'CARD',
    parentId: project.id,
    x: 0,
    y: 0,
    width: 40,
    z: 1,
    color: 'yellow',
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [t('Идея')] },
        p(t('Соберите здесь всё по проекту: заметки, референсы, задачи и вложенные доски.')),
      ],
    },
  };
  return [home, welcome, project, projectNote];
}
