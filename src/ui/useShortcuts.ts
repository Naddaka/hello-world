import { useEffect } from 'react';
import { actions, canvasChildren, useStore } from '../model/store';
import { GRID, type CardElement } from '../model/types';
import { setCamera, sizes, zoomAt, zoomToFit } from '../canvas/runtime';
import { closeMenu, useMenu } from './ContextMenu';

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'));
}

function hasText(card: CardElement) {
  return JSON.stringify(card.content).includes('"text":');
}

/** App-wide keyboard shortcuts (the editor handles its own while a note is being edited). */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Theme toggle works everywhere, even while typing.
      if (mod && e.shiftKey && key === 'd') {
        e.preventDefault();
        actions.toggleTheme();
        return;
      }
      if (mod && key === 'f') {
        e.preventDefault();
        actions.setPanel('search');
        return;
      }
      if (isTyping(e.target) || useMenu.getState().items) return;

      const state = useStore.getState();
      const selected = state.selection.map((id) => state.elements[id]).filter(Boolean);

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) actions.redo();
        else actions.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        actions.redo();
      } else if (mod && key === 'a') {
        e.preventDefault();
        actions.selectAll();
      } else if (mod && e.key === '[') {
        e.preventDefault();
        actions.goBack();
      } else if (mod && e.key === ']') {
        e.preventDefault();
        actions.goForward();
      } else if (mod && key === 'u') {
        e.preventDefault();
        actions.goParent();
      } else if (mod && e.shiftKey && e.key === 'ArrowUp') {
        e.preventDefault();
        actions.bringToFront();
      } else if (mod && e.shiftKey && e.key === 'ArrowDown') {
        e.preventDefault();
        actions.sendToBack();
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomAt(1.25);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        zoomAt(1 / 1.25);
      } else if (mod && e.key === '0') {
        e.preventDefault();
        setCamera({ ...(state.cameras[state.boardId] ?? { x: 120, y: 40, zoom: 1 }), zoom: 1 });
      } else if (mod && e.key === 'Enter' && selected.length === 1) {
        // ⌘Enter on a selected note or board: add another one next to it.
        e.preventDefault();
        const el = selected[0];
        const size = sizes.get(el.id);
        if (el.parentId !== state.boardId) return;
        if (el.type === 'CARD' || el.type === 'TASK_LIST') actions.create({ type: el.type }, state.boardId, el.x, el.y + Math.ceil((size?.h ?? 120) / GRID) + 2, { width: el.width });
        else if (el.type === 'BOARD' || el.type === 'COLUMN') actions.create({ type: el.type }, state.boardId, el.x + Math.ceil((size?.w ?? 112) / GRID) + 2, el.y);
      } else if (!mod && key === 'z') {
        e.preventDefault();
        zoomToFit(canvasChildren(state.elements, state.boardId));
      } else if (e.key === 'Escape') {
        closeMenu();
        if (state.panel) actions.setPanel(state.panel);
        else actions.clearSelection();
      } else if (e.key === 'Enter' && selected.length === 1) {
        e.preventDefault();
        const el = selected[0];
        if (el.type === 'BOARD') actions.openBoard(el.id);
        else if (!el.locked && el.section !== 'TRASH') actions.setEditing(el.id);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length > 0) {
        e.preventDefault();
        // As in the reference app, notes with text are only deleted from the menu,
        // so they are never lost to a stray key press.
        const deletable = selected.filter((el) => !el.locked && !(el.type === 'CARD' && hasText(el)));
        if (deletable.length) actions.trash(deletable.map((el) => el.id));
        if (deletable.length < selected.length) {
          actions.showToast('Заметки с текстом удаляются через меню (правый клик → Удалить) — чтобы не потерять их случайно');
        }
      } else if (e.key.startsWith('Arrow') && selected.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0];
        actions.nudge(d[0], d[1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
