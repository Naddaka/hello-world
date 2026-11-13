import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { actions, useStore } from '../model/store';
import type { ImageElement, SketchElement, Stroke } from '../model/types';
import { useMediaSrc } from '../storage/media';
import { handleDrawKey, hitsStroke, PEN_SIZES, strokePath, useDrawTool } from './strokes';
import { DrawToolbar } from './DrawToolbar';
import { shotNumber, sizeShort } from '../script/storyboard';
import { shortcutKey } from '../ui/keys';

/** Sketch and image strokes use 1000 units across the width. */
const UNITS = 1000;

export const useSketchEditor = create<{ id: string | null }>(() => ({ id: null }));
export const openSketchEditor = (id: string) => {
  // Always start with the pen; the eraser may still be selected from earlier.
  useDrawTool.setState({ tool: 'pen' });
  useSketchEditor.setState({ id });
};

export function StrokesSvg({ strokes, aspect, className }: { strokes: Stroke[]; aspect: number; className?: string }) {
  return (
    <svg className={className} viewBox={`0 0 ${UNITS} ${UNITS / aspect}`} preserveAspectRatio="none" aria-hidden="true">
      {strokes.map((s, i) => (
        <path key={i} d={strokePath(s.points)} stroke={s.color} strokeWidth={s.size} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/** A card to sketch on, e.g. a storyboard frame. */
export function SketchCard({ element, selected }: { element: SketchElement; selected: boolean }) {
  const backdrop = useMediaSrc(element.backdrop ?? null);
  const shot = element.shot;
  const facts = shot ? [shot.size && sizeShort(shot.size), shot.angle, shot.movement, shot.lens].filter(Boolean).join(' · ') : '';
  return (
    <figure className={`media-card sketch-card${shot ? ' frame-card' : ''}${selected ? ' selected' : ''}`}>
      {shot && (
        <div className="frame-head">
          <span className="frame-no">{shotNumber(shot) || 'Кадр'}</span>
          <span className="frame-facts">{facts}</span>
          {shot.duration != null && <span className="frame-dur">{shot.duration} с</span>}
        </div>
      )}
      <div className="sketch-surface" style={{ aspectRatio: `${element.aspect}`, backgroundImage: backdrop ? `url("${backdrop}")` : undefined }}>
        <StrokesSvg strokes={element.strokes} aspect={element.aspect} className="sketch-svg" />
        {element.strokes.length === 0 && !backdrop && <span className="sketch-empty">Двойной клик — рисовать<br />или перетащите сюда картинку</span>}
      </div>
      {element.caption && <figcaption>{element.caption}</figcaption>}
    </figure>
  );
}

export const ASPECTS: { label: string; value: number }[] = [
  { label: '16:9', value: 16 / 9 },
  { label: '2.39:1', value: 2.39 },
  { label: '4:3', value: 4 / 3 },
  { label: '1:1', value: 1 },
  { label: '9:16', value: 9 / 16 },
];

function Editor({ element }: { element: SketchElement | ImageElement }) {
  const isImage = element.type === 'IMAGE';
  const aspect = isImage ? element.naturalWidth / element.naturalHeight : element.aspect;
  const initial = (isImage ? element.annotations : element.strokes) ?? [];
  const [strokes, setStrokes] = useState<Stroke[]>(initial);
  const [live, setLive] = useState<Stroke | null>(null);
  const latest = useRef(initial);
  latest.current = strokes;
  const surface = useRef<HTMLDivElement>(null);
  const imageSrc = useMediaSrc(isImage ? element.media : (element.backdrop ?? null));

  const field = isImage ? 'annotations' : 'strokes';
  const close = () => {
    actions.update(element.id, { [field]: latest.current });
    useSketchEditor.setState({ id: null });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if ((e.metaKey || e.ctrlKey) && shortcutKey(e) === 'z') {
        e.preventDefault();
        setStrokes((s) => s.slice(0, -1));
      } else if (handleDrawKey(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxW = Math.max(320, window.innerWidth - 160);
  const maxH = Math.max(240, window.innerHeight - 200);
  const width = Math.min(maxW, maxH * aspect);

  const toUnits = (clientX: number, clientY: number) => {
    const r = surface.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * UNITS, y: ((clientY - r.top) / r.width) * UNITS };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const { tool, color, size } = useDrawTool.getState();
    const p0 = toUnits(e.clientX, e.clientY);
    const stroke: Stroke = { color, size: PEN_SIZES[size - 1] * 2, points: [Math.round(p0.x), Math.round(p0.y)] };
    const erase = (x: number, y: number) => setStrokes((s) => s.filter((st) => !hitsStroke(st, x, y, 12)));
    if (tool === 'pen') setLive(stroke);
    else erase(p0.x, p0.y);
    const onMove = (ev: PointerEvent) => {
      const p = toUnits(ev.clientX, ev.clientY);
      if (tool === 'eraser') return erase(p.x, p.y);
      const pts = stroke.points;
      if (Math.hypot(p.x - pts[pts.length - 2], p.y - pts[pts.length - 1]) < 2) return;
      stroke.points = [...pts, Math.round(p.x), Math.round(p.y)];
      setLive({ ...stroke });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (tool === 'pen') {
        setLive(null);
        setStrokes((s) => [...s, stroke]);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="sketch-overlay" role="dialog" aria-label={isImage ? 'Рисование на изображении' : 'Скетч'}>
      <header className="doc-head" data-tauri-drag-region>
        <span className="sketch-title">{isImage ? `Рисование: ${element.name}` : 'Скетч'}</span>
        {!isImage && (
          <span className="aspect-pick">
            {ASPECTS.map((a) => (
              <button key={a.label} type="button" className={`fmt${Math.abs(element.aspect - a.value) < 0.01 ? ' on' : ''}`} onClick={() => actions.update(element.id, { aspect: a.value })}>
                {a.label}
              </button>
            ))}
          </span>
        )}
        <button type="button" className="link-btn" style={{ marginLeft: 'auto' }} disabled={strokes.length === 0} onClick={() => setStrokes([])}>Очистить</button>
      </header>
      <div className="sketch-stage">
        <div
          ref={surface}
          className="sketch-paper"
          style={{ width, height: width / aspect, backgroundImage: imageSrc ? `url("${imageSrc}")` : undefined }}
          onPointerDown={onPointerDown}
        >
          <svg viewBox={`0 0 ${UNITS} ${UNITS / aspect}`} width={width} height={width / aspect} aria-hidden="true">
            {[...strokes, ...(live ? [live] : [])].map((s, i) => (
              <path key={i} d={strokePath(s.points)} stroke={s.color} strokeWidth={s.size} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </svg>
        </div>
      </div>
      <div className="draw-bar-wrap">
        <DrawToolbar onDone={close} doneLabel="Сохранить" />
      </div>
    </div>
  );
}

export function SketchEditorOverlay() {
  const id = useSketchEditor((s) => s.id);
  const element = useStore((s) => (id ? s.elements[id] : undefined));
  if (!element || (element.type !== 'SKETCH' && element.type !== 'IMAGE')) return null;
  return <Editor key={element.id} element={element} />;
}

export function newSketchFields() {
  return { type: 'SKETCH' as const, strokes: [], aspect: 16 / 9, caption: '' };
}
