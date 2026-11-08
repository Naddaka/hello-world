import { useEffect } from 'react';
import { create } from 'zustand';
import { actions, useStore } from '../model/store';
import { GRID } from '../model/types';
import { isTauri } from '../storage/repo';
import { setCamera, sizes } from '../canvas/runtime';

const KEY = 'zadum.presentation';

function loadOptions() {
  try {
    return { preventEdit: true, focusOnClick: true, hideComments: false, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { preventEdit: true, focusOnClick: true, hideComments: false };
  }
}

interface PresentState {
  active: boolean;
  preventEdit: boolean;
  focusOnClick: boolean;
  hideComments: boolean;
}

export const usePresent = create<PresentState>(() => ({ active: false, ...loadOptions() }));

function remember() {
  const { preventEdit, focusOnClick, hideComments } = usePresent.getState();
  try {
    localStorage.setItem(KEY, JSON.stringify({ preventEdit, focusOnClick, hideComments }));
  } catch {
    /* preferences are optional */
  }
}

async function setFullscreen(on: boolean) {
  try {
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setFullscreen(on);
    } else if (on) await document.documentElement.requestFullscreen?.();
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* full screen is a nicety; presenting works without it */
  }
}

export function startPresenting() {
  actions.clearSelection();
  usePresent.setState({ active: true });
  void setFullscreen(true);
}

export function stopPresenting() {
  usePresent.setState({ active: false });
  void setFullscreen(false);
}

/** Enlarges one card to fill the screen (focus mode). */
export function focusOn(id: string) {
  const el = useStore.getState().elements[id];
  const viewport = document.querySelector('[data-canvas]')?.getBoundingClientRect();
  if (!el || !viewport) return;
  const size = sizes.get(id) ?? { w: el.width * GRID, h: 200 };
  const zoom = Math.min(3, (viewport.width * 0.8) / size.w, (viewport.height * 0.8) / size.h);
  setCamera({ zoom, x: viewport.width / 2 - (el.x * GRID + size.w / 2) * zoom, y: viewport.height / 2 - (el.y * GRID + size.h / 2) * zoom });
}

/** Bottom bar while presenting: options and the way out. */
export function PresentBar() {
  const { active, preventEdit, focusOnClick, hideComments } = usePresent();
  const back = useStore((s) => s.back.length > 0);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopPresenting();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!active) return null;
  const toggle = (key: 'preventEdit' | 'focusOnClick' | 'hideComments') => {
    usePresent.setState({ [key]: !usePresent.getState()[key] });
    remember();
  };
  return (
    <div className="present-bar panel" role="toolbar" aria-label="Презентация">
      {back && <button type="button" className="link-btn" onClick={() => actions.goBack()}>← Назад</button>}
      <label><input type="checkbox" checked={preventEdit} onChange={() => toggle('preventEdit')} /> Запретить редактирование</label>
      <label><input type="checkbox" checked={focusOnClick} onChange={() => toggle('focusOnClick')} /> Фокус по клику</label>
      <label><input type="checkbox" checked={hideComments} onChange={() => toggle('hideComments')} /> Скрыть комментарии</label>
      <button type="button" className="btn-accent" onClick={stopPresenting}>Завершить (Esc)</button>
    </div>
  );
}
