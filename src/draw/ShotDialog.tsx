import { useState } from 'react';
import { create } from 'zustand';
import { actions, useStore } from '../model/store';
import type { ShotInfo, SketchElement } from '../model/types';
import { SHOT_ANGLES, SHOT_MOVES, SHOT_SIZES, emptyShot } from '../script/storyboard';

/** Which frame's shot settings are being edited. */
export const useShotDialog = create<{ id: string | null }>(() => ({ id: null }));
export const openShotDialog = (id: string) => useShotDialog.setState({ id });

function Dialog({ frame }: { frame: SketchElement }) {
  const [shot, setShot] = useState<ShotInfo>(frame.shot ?? emptyShot());
  const [caption, setCaption] = useState(frame.caption);
  const close = () => useShotDialog.setState({ id: null });
  const save = () => {
    actions.update(frame.id, { shot, caption });
    close();
  };
  const text = (key: keyof ShotInfo, label: string, list?: string[], width?: number) => (
    <label className="sp-field" style={width ? { flex: `0 0 ${width}px` } : { flex: 1 }}>
      <span>{label}</span>
      <input
        list={list ? `shot-${key}` : undefined}
        value={(shot[key] as string | null) ?? ''}
        onChange={(e) => setShot({ ...shot, [key]: e.target.value })}
      />
      {list && (
        <datalist id={`shot-${key}`}>
          {list.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      )}
    </label>
  );
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="modal panel"
        role="dialog"
        aria-modal="true"
        aria-label="Параметры кадра"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') close();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
        }}
      >
        <header className="modal-head">
          <h2>Параметры кадра</h2>
          <button type="button" className="ibtn" aria-label="Закрыть" onClick={close}>
            ✕
          </button>
        </header>
        <div className="modal-body">
          <div className="shot-row">
            {text('scene', 'Сцена', undefined, 90)}
            {text('shot', 'Кадр', undefined, 90)}
            <label className="sp-field" style={{ flex: '0 0 110px' }}>
              <span>Длительность, с</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={shot.duration ?? ''}
                onChange={(e) => setShot({ ...shot, duration: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="shot-row">
            {text('size', 'Крупность', SHOT_SIZES.map((s) => s.label))}
            {text('angle', 'Ракурс', SHOT_ANGLES)}
          </div>
          <div className="shot-row">
            {text('movement', 'Движение камеры', SHOT_MOVES)}
            {text('lens', 'Оптика', ['14 мм', '24 мм', '35 мм', '50 мм', '85 мм', '135 мм'])}
          </div>
          <label className="sp-field">
            <span>Описание (что в кадре, звук, диалог)</span>
            <textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </label>
          <footer className="modal-foot">
            <button type="button" className="ibtn wide" onClick={close}>
              Отмена
            </button>
            <button type="button" className="btn-accent" onClick={save}>
              Сохранить
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

export function ShotDialog() {
  const id = useShotDialog((s) => s.id);
  const frame = useStore((s) => (id ? s.elements[id] : undefined));
  if (!frame || frame.type !== 'SKETCH') return null;
  return <Dialog key={frame.id} frame={frame} />;
}
