import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { actions, useStore } from '../model/store';
import type { FileElement, MarkerColor, VideoMarker } from '../model/types';
import { media, useMediaSrc } from '../storage/media';
import { fileName, saveFile } from '../storage/files';
import { isTauri } from '../storage/repo';
import { DEFAULT_FPS, FRAME_RATES, canDropFrame, clock, frameMiddle, frameOf, snapFps, sortMarkers, timecode, toFcpxml, toMarkersCsv, toPremiereXml, toResolveEdl, toYoutubeChapters, youtubeChapterProblems } from './markers';
import { shortcutKey } from '../ui/keys';
import { freeSpot } from '../canvas/placement';

/** Which video or audio file is open for review. */
export const useReview = create<{ id: string | null }>(() => ({ id: null }));
export const openReview = (id: string) => useReview.setState({ id });

export const isReviewable = (e: { type: string; mime?: string }) => e.type === 'FILE' && /^(video|audio)\//.test(e.mime ?? '');

const COLORS: MarkerColor[] = ['blue', 'red', 'green', 'yellow', 'purple'];
const COLOR_LABELS: Record<MarkerColor, string> = { blue: 'Синий', red: 'Красный', green: 'Зелёный', yellow: 'Жёлтый', purple: 'Фиолетовый' };

/** Path editing software should open: the original file if it was imported from disk, else the library copy (desktop only). */
async function mediaPath(file: FileElement): Promise<string | undefined> {
  if (file.sourcePath) return file.sourcePath;
  if (!isTauri()) return undefined;
  const { invoke } = await import('@tauri-apps/api/core');
  const dir = await invoke<string>('media_location');
  return `${dir}/${file.media.id}.${file.media.ext}`;
}

type ExportKind = 'edl' | 'premiere' | 'fcpxml' | 'csv' | 'youtube';

async function exportMarkers(file: FileElement, kind: ExportKind, duration: number, size: { w: number; h: number }) {
  const fps = file.fps ?? DEFAULT_FPS;
  const df = !!file.dropFrame && canDropFrame(fps);
  const markers = file.markers ?? [];
  const base = file.name.replace(/\.[^.]+$/, '') || 'Видео';
  const clip = { name: file.name, duration, path: await mediaPath(file), width: size.w || undefined, height: size.h || undefined };
  switch (kind) {
    case 'edl':
      return saveFile(fileName(`${base} — маркеры`, 'edl'), toResolveEdl(markers, fps, base, 1, df), 'text/plain', { name: 'EDL', extensions: ['edl'] });
    case 'premiere':
      return saveFile(fileName(`${base} — ревью`, 'xml'), toPremiereXml(markers, fps, clip, df), 'application/xml', { name: 'XML', extensions: ['xml'] });
    case 'fcpxml':
      return saveFile(fileName(`${base} — ревью`, 'fcpxml'), toFcpxml(markers, fps, clip, df), 'application/xml', { name: 'FCPXML', extensions: ['fcpxml'] });
    case 'csv':
      return saveFile(fileName(`${base} — комментарии`, 'csv'), toMarkersCsv(markers, fps, df), 'text/csv', { name: 'CSV', extensions: ['csv'] });
    case 'youtube': {
      const problems = youtubeChapterProblems(markers, duration);
      if (problems.length && !window.confirm(`YouTube не покажет эти главы: ${problems.join('; ')}. Сохранить всё равно?`)) return false;
      return saveFile(fileName(`${base} — главы`, 'txt'), toYoutubeChapters(markers), 'text/plain', { name: 'Текст', extensions: ['txt'] });
    }
  }
}

/** Saves the current video frame as an image card next to the video. */
export async function grabFrame(file: FileElement, video: HTMLVideoElement): Promise<string | null> {
  if (!video.videoWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  const tc = timecode(video.currentTime, file.fps ?? DEFAULT_FPS, !!file.dropFrame);
  const name = `${file.name.replace(/\.[^.]+$/, '')} ${tc.replace(/:/g, '-')}.png`;
  const info = await (await media()).importFile(new File([blob], name, { type: 'image/png' }));
  const width = 26;
  const spot = freeSpot(file.parentId!, file.x + file.width + 3, file.y, width, Math.ceil((width * video.videoHeight) / video.videoWidth) + 5);
  return actions.insert(
    { type: 'IMAGE', media: { id: info.id, ext: info.ext }, name, naturalWidth: video.videoWidth, naturalHeight: video.videoHeight, caption: `${file.name} · ${tc}`, showCaption: true },
    file.parentId!,
    spot.x,
    spot.y,
    width,
  );
}

function Review({ file }: { file: FileElement }) {
  const src = useMediaSrc(file.media);
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [draft, setDraft] = useState('');
  const [color, setColor] = useState<MarkerColor>('blue');
  const [menu, setMenu] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const fps = file.fps ?? DEFAULT_FPS;
  const df = !!file.dropFrame && canDropFrame(fps);
  const tc = (seconds: number) => timecode(seconds, fps, df);
  const markers = sortMarkers(file.markers ?? []);
  const isVideo = file.mime.startsWith('video/');

  const setMarkers = (next: VideoMarker[]) => actions.update(file.id, { markers: next });

  // Frame rate: read from the file's container; if it does not say, measured from frames while playing.
  useEffect(() => {
    if (file.fps != null || !isVideo) return;
    let cancelled = false;
    const found = (raw: number) => {
      if (cancelled || !Number.isFinite(raw) || raw < 1 || raw > 240) return;
      if (useStore.getState().elements[file.id]?.type === 'FILE' && (useStore.getState().elements[file.id] as FileElement).fps == null) {
        actions.setLive(file.id, { fps: snapFps(raw), fpsDetected: true });
      }
    };
    const measure = () => {
      const v = video.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number }) | null;
      if (!v?.requestVideoFrameCallback) return;
      const times: number[] = [];
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        if (cancelled) return;
        if (!v.paused) times.push(meta.mediaTime);
        if (times.length < 16) v.requestVideoFrameCallback!(onFrame);
        else {
          // The shortest steady gap between presented frames is one frame.
          const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 0).sort((a, b) => a - b);
          if (gaps.length) found(1 / gaps[Math.floor(gaps.length / 3)]);
        }
      };
      v.requestVideoFrameCallback(onFrame);
    };
    if (isTauri()) {
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke<number | null>('media_frame_rate', { file: `${file.media.id}.${file.media.ext}` }))
        .then((raw) => (raw ? found(raw) : measure()))
        .catch(measure);
    } else measure();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, file.fps == null, src]);
  const seek = useCallback(
    (t: number) => {
      const v = video.current;
      if (!v) return;
      v.currentTime = Math.max(0, Math.min(t, v.duration || t));
      setTime(v.currentTime);
    },
    [],
  );
  const step = (frames: number) => {
    video.current?.pause();
    seek(frameMiddle(frameOf(video.current?.currentTime ?? 0, fps) + frames, fps));
  };
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };
  const addMarker = () => {
    const v = video.current;
    const text = draft.trim();
    if (!v || !text) return;
    setMarkers([...(file.markers ?? []), { id: nanoid(8), time: Math.round(v.currentTime * 1000) / 1000, text, color, done: false }]);
    setDraft('');
  };
  const close = () => useReview.setState({ id: null });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('textarea, input, select');
      if (e.key === 'Escape') {
        e.preventDefault();
        if (menu) setMenu(false);
        else if (typing) (e.target as HTMLElement).blur();
        else close();
        return;
      }
      if (typing) return;
      const t = video.current?.currentTime ?? 0;
      const k = shortcutKey(e);
      if (e.key === ' ') toggle();
      else if (e.key === 'ArrowLeft') step(e.shiftKey ? -Math.round(fps) : -1);
      else if (e.key === 'ArrowRight') step(e.shiftKey ? Math.round(fps) : 1);
      else if (k === 'm') {
        video.current?.pause();
        input.current?.focus();
      } else if (k === '[') {
        const prev = [...markers].reverse().find((m) => m.time < t - 0.01);
        if (prev) seek(prev.time);
      } else if (k === ']') {
        const next = markers.find((m) => m.time > t + 0.01);
        if (next) seek(next.time);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const shown = hideDone ? markers.filter((m) => !m.done) : markers;
  const open = markers.filter((m) => !m.done).length;
  const size = { w: video.current?.videoWidth ?? 0, h: video.current?.videoHeight ?? 0 };

  return (
    <div className="doc-overlay vr-overlay" role="dialog" aria-label={`Ревью: ${file.name}`}>
      <header className="doc-head" data-tauri-drag-region>
        <button type="button" className="link-btn" onClick={close}>
          ← К доске
        </button>
        <span className="vr-title">{file.name}</span>
        <span className="doc-count" style={{ marginLeft: 'auto' }}>
          {markers.length ? `${markers.length} комм. · открыто ${open}` : 'Комментариев пока нет'}
        </span>
        <label className="sp-check">
          Кадров/с
          <select
            className="sp-select"
            value={fps}
            title={file.fpsDetected ? 'Определено по файлу' : file.fps == null ? 'Не определено — выберите частоту' : 'Выбрано вручную'}
            onChange={(e) => actions.update(file.id, { fps: Number(e.target.value), fpsDetected: false })}
          >
            {[...new Set([...FRAME_RATES, fps])]
              .sort((a, b) => a - b)
              .map((r) => (
                <option key={r} value={r}>
                  {r}
                  {file.fpsDetected && r === fps ? ' (по файлу)' : ''}
                </option>
              ))}
          </select>
        </label>
        {canDropFrame(fps) && (
          <label className="sp-check" title="Drop-frame: таймкод с «;», идёт вровень с часами">
            <input type="checkbox" checked={df} onChange={(e) => actions.update(file.id, { dropFrame: e.target.checked })} />
            DF
          </label>
        )}
        {isVideo && (
          <button
            type="button"
            className="ibtn wide"
            title="Сохранить текущий кадр картинкой на доске"
            onClick={async () => {
              if (!video.current) return;
              video.current.pause();
              const id = await grabFrame(file, video.current);
              actions.showToast(id ? `Стоп-кадр ${tc(video.current.currentTime)} добавлен на доску` : 'Не удалось взять кадр');
            }}
          >
            Стоп-кадр в карточку
          </button>
        )}
        <div style={{ position: 'relative' }}>
          <button type="button" className="btn-accent" aria-expanded={menu} disabled={!markers.length} onClick={() => setMenu(!menu)}>
            Экспорт маркеров
          </button>
          {menu && (
            <div className="popover panel" style={{ left: 'auto', right: 0, width: 270 }} role="menu">
              {(
                [
                  ['edl', 'DaVinci Resolve (EDL)', 'Timeline → Import → Timeline Markers from EDL'],
                  ['premiere', 'Premiere Pro (XML)', 'Файл → Импорт: секвенция с маркерами'],
                  ['fcpxml', 'Final Cut Pro (FCPXML)', 'Проект с маркерами; открытые — как задачи'],
                  ['csv', 'Таблица (CSV)', 'Таймкод, комментарий, отметка'],
                  ['youtube', 'Главы YouTube', 'Для описания ролика'],
                ] as const
              ).map(([kind, label, hint]) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  className="menu-item menu-item-2"
                  onClick={() => {
                    setMenu(false);
                    void exportMarkers(file, kind, duration, size);
                  }}
                >
                  <span>{label}</span>
                  <small>
                    {hint}
                    {(kind === 'premiere' || kind === 'fcpxml') && !file.sourcePath ? '. Ссылается на копию в медиатеке Zadum — в монтажке перелинкуйте на оригинал' : ''}
                  </small>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      <div className="vr-body">
        <div className="vr-main">
          <div className="vr-stage">
            {src &&
              (isVideo ? (
                <video
                  ref={video}
                  className="vr-video"
                  src={src}
                  crossOrigin="anonymous"
                  preload="auto"
                  onClick={toggle}
                  onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                  onSeeked={(e) => setTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                />
              ) : (
                <audio
                  ref={video as unknown as React.RefObject<HTMLAudioElement>}
                  src={src}
                  preload="auto"
                  onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                  onSeeked={(e) => setTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                />
              ))}
          </div>
          <div className="vr-controls">
            <button type="button" className="ibtn" aria-label="Кадр назад (←)" title="Кадр назад (←)" onClick={() => step(-1)}>
              ⏮
            </button>
            <button type="button" className="ibtn vr-play" aria-label={playing ? 'Пауза (пробел)' : 'Воспроизвести (пробел)'} onClick={toggle}>
              {playing ? '❚❚' : '▶'}
            </button>
            <button type="button" className="ibtn" aria-label="Кадр вперёд (→)" title="Кадр вперёд (→)" onClick={() => step(1)}>
              ⏭
            </button>
            <span className="vr-tc" aria-live="off">
              {tc(time)}
            </span>
            <div
              className="vr-timeline"
              role="slider"
              aria-label="Позиция"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(time)}
              tabIndex={0}
              onPointerDown={(e) => {
                const bar = e.currentTarget;
                const at = (x: number) => {
                  const r = bar.getBoundingClientRect();
                  seek(((x - r.left) / r.width) * duration);
                };
                at(e.clientX);
                const move = (ev: PointerEvent) => at(ev.clientX);
                const up = () => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
              }}
            >
              <div className="vr-progress" style={{ width: duration ? `${(time / duration) * 100}%` : 0 }} />
              {duration > 0 &&
                markers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`vr-pin c-${m.color}${m.done ? ' done' : ''}`}
                    style={{ left: `${(m.time / duration) * 100}%` }}
                    title={`${tc(m.time)} — ${m.text}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      seek(m.time);
                    }}
                  />
                ))}
            </div>
            <span className="vr-tc muted">{tc(duration)}</span>
          </div>
          <p className="vr-keys">Пробел — пуск/пауза · ← → — кадр (с Shift — секунда) · M — комментарий · [ ] — к соседнему комментарию</p>
        </div>
        <aside className="vr-side" aria-label="Комментарии">
          <form
            className="vr-new"
            onSubmit={(e) => {
              e.preventDefault();
              addMarker();
            }}
          >
            <div className="vr-new-head">
              <span>Комментарий на {tc(time)}</span>
              <span className="vr-colors" role="radiogroup" aria-label="Цвет маркера">
                {COLORS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={COLOR_LABELS[c]} className={`vr-dot c-${c}${c === color ? ' on' : ''}`} onClick={() => setColor(c)} />
                ))}
              </span>
            </div>
            <textarea
              ref={input}
              rows={2}
              value={draft}
              placeholder="Что поправить в этом месте… (Enter — добавить)"
              onFocus={() => video.current?.pause()}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  addMarker();
                }
              }}
            />
          </form>
          <label className="vr-filter">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Скрыть исправленные
          </label>
          <ol className="vr-list">
            {shown.map((m) => (
              <li key={m.id} className={`vr-item${m.done ? ' done' : ''}${Math.abs(m.time - time) < 0.5 / fps + 0.02 ? ' current' : ''}`}>
                <button type="button" className={`vr-time c-${m.color}`} onClick={() => seek(m.time)} title="Перейти">
                  {clock(m.time)}
                  <small>{tc(m.time)}</small>
                </button>
                <textarea
                  key={`${m.id}:${m.text}`}
                  className="vr-text"
                  aria-label={`Комментарий на ${tc(m.time)}`}
                  defaultValue={m.text}
                  rows={Math.min(4, m.text.split('\n').length + Math.floor(m.text.length / 40))}
                  onBlur={(e) => e.target.value.trim() !== m.text && setMarkers((file.markers ?? []).map((x) => (x.id === m.id ? { ...x, text: e.target.value.trim() } : x)))}
                />
                <span className="vr-item-actions">
                  <label title="Исправлено">
                    <input type="checkbox" checked={m.done} onChange={(e) => setMarkers((file.markers ?? []).map((x) => (x.id === m.id ? { ...x, done: e.target.checked } : x)))} />
                    <span className="sr-only">Исправлено</span>
                  </label>
                  <button type="button" className="ibtn sp-bd-del" aria-label="Удалить комментарий" onClick={() => setMarkers((file.markers ?? []).filter((x) => x.id !== m.id))}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
            {!shown.length && <li className="col-empty">{markers.length ? 'Всё исправлено' : 'Поставьте видео на паузу в нужном месте и напишите комментарий'}</li>}
          </ol>
        </aside>
      </div>
    </div>
  );
}

export function VideoReviewOverlay() {
  const id = useReview((s) => s.id);
  const file = useStore((s) => (id ? s.elements[id] : undefined));
  if (!file || file.type !== 'FILE') return null;
  return <Review key={file.id} file={file} />;
}
