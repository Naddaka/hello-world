import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { actions, useStore } from '../model/store';
import type { MediaRef, SketchElement } from '../model/types';
import { useMediaSrc } from '../storage/media';
import { IconSparkle } from '../ui/icons';
import { FRAME_STYLES, frameImageSize, framePrompt, shotWords, type FrameStyle } from './framePrompt';
import { openAiSettings, refreshKeys, useAiSettings } from './settings';
import { NoKeyError, generateImage } from './transport';

const useFrameImage = create<{ id: string | null }>(() => ({ id: null }));

/** Opens "generate a picture for this frame". */
export const openFrameImage = (id: string) => useFrameImage.setState({ id });

type Phase = { kind: 'form' } | { kind: 'no-key' } | { kind: 'running' } | { kind: 'done'; ref: MediaRef } | { kind: 'error'; message: string };

const STYLE_KEY = 'zadum.ai.frameStyle';

function Dialog({ frame }: { frame: SketchElement }) {
  const [description, setDescription] = useState(frame.caption);
  const [style, setStyle] = useState<FrameStyle>(() => {
    const saved = localStorage.getItem(STYLE_KEY);
    return FRAME_STYLES.some((s) => s.id === saved) ? (saved as FrameStyle) : 'sketch';
  });
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const { imageModel, imageQuality, settingsOpen } = useAiSettings();
  const preview = useMediaSrc(phase.kind === 'done' ? phase.ref : null);
  const words = shotWords(frame);
  const close = () => useFrameImage.setState({ id: null });

  // Back from the settings with a key saved: show the form again.
  useEffect(() => {
    if (!settingsOpen && phase.kind === 'no-key') void refreshKeys().then((keys) => keys.openai && setPhase({ kind: 'form' }));
  }, [settingsOpen, phase.kind]);

  const generate = async () => {
    if (!description.trim()) return;
    try {
      localStorage.setItem(STYLE_KEY, style);
    } catch {
      // Not remembered; nothing else depends on it.
    }
    const keys = await refreshKeys();
    if (!keys.openai) return setPhase({ kind: 'no-key' });
    setPhase({ kind: 'running' });
    try {
      const image = await generateImage(framePrompt(description, frame, style), frameImageSize(frame.aspect), imageModel, imageQuality);
      // Closed while it was running: the picture is not put anywhere.
      if (useFrameImage.getState().id !== frame.id) return;
      setPhase({ kind: 'done', ref: { id: image.id, ext: image.ext } });
    } catch (error) {
      if (error instanceof NoKeyError) return setPhase({ kind: 'no-key' });
      setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const accept = (ref: MediaRef) => {
    const live = useStore.getState().elements[frame.id];
    if (live?.type !== 'SKETCH') return close();
    // The description becomes the frame's caption when it had none.
    actions.update(frame.id, { backdrop: ref, ...(live.caption.trim() ? {} : { caption: description.trim() }) });
    actions.showToast('Картинка поставлена в кадр. Отменить — ⌘Z');
    close();
  };

  const busy = phase.kind === 'running';
  return (
    <div className="modal-backdrop ai-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="modal panel ai-dialog" role="dialog" aria-modal="true" aria-labelledby="frame-image-title" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' && !busy) close(); }}>
        <header className="modal-head">
          <h2 id="frame-image-title"><IconSparkle size={17} /> Сгенерировать кадр</h2>
          <button type="button" className="ibtn" aria-label="Закрыть" onClick={close}>✕</button>
        </header>
        <div className="modal-body">
          {phase.kind === 'no-key' ? (
            <>
              <p>Картинки рисует модель OpenAI, для неё нужен отдельный ключ API OpenAI. Он хранится в связке ключей macOS.</p>
              <footer className="modal-foot">
                <button type="button" className="ibtn wide" onClick={close}>Не сейчас</button>
                <button type="button" className="btn-accent" autoFocus onClick={openAiSettings}>Настройки ИИ…</button>
              </footer>
            </>
          ) : phase.kind === 'done' ? (
            <>
              <div className="ai-frame-preview" style={{ aspectRatio: `${frame.aspect}`, backgroundImage: preview ? `url("${preview}")` : undefined }} role="img" aria-label="Сгенерированный кадр" />
              <footer className="modal-foot">
                <button type="button" className="ibtn wide" onClick={close}>Не ставить</button>
                <button type="button" className="ibtn wide" onClick={() => setPhase({ kind: 'form' })}>Изменить описание</button>
                <button type="button" className="ibtn wide" onClick={() => void generate()}>Ещё вариант</button>
                <button type="button" className="btn-accent" autoFocus onClick={() => accept(phase.ref)}>Поставить в кадр</button>
              </footer>
            </>
          ) : (
            <>
              <label className="sr-only" htmlFor="frame-image-text">Что в кадре</label>
              <textarea
                id="frame-image-text"
                className="ai-ask"
                rows={4}
                autoFocus
                disabled={busy}
                placeholder="Что в кадре: кто, где, что происходит, время суток, свет. Например: женщина в плаще идёт по мокрому пирсу на рассвете, туман над водой"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="ai-row">
                <label htmlFor="frame-image-style">Стиль</label>
                <select id="frame-image-style" value={style} disabled={busy} onChange={(e) => setStyle(e.target.value as FrameStyle)}>
                  {FRAME_STYLES.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
              <p className="side-hint" style={{ padding: 0 }}>
                {words ? `Из параметров кадра добавлю: ${words}. ` : ''}В OpenAI уйдёт только это описание. Одна картинка стоит от нескольких центов по тарифу OpenAI; генерация занимает до пары минут.
              </p>
              {phase.kind === 'error' && <p className="mn-warn" role="alert">{phase.message}</p>}
              {busy && <p className="ai-wait">Рисую кадр…</p>}
              <footer className="modal-foot">
                <button type="button" className="ibtn wide" onClick={close}>{busy ? 'Закрыть (картинка не будет поставлена)' : 'Отмена'}</button>
                <button type="button" className="btn-accent" disabled={busy || !description.trim()} onClick={() => void generate()}>Сгенерировать</button>
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function FrameImageDialog() {
  const id = useFrameImage((s) => s.id);
  const frame = useStore((s) => (id ? s.elements[id] : undefined));
  if (!frame || frame.type !== 'SKETCH') return null;
  return <Dialog key={frame.id} frame={frame} />;
}
