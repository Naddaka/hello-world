import { PEN_COLORS, PEN_SIZES, setColor, useDrawTool } from './strokes';
import { IconDraw } from '../ui/icons';

/** Pen / eraser, colours and sizes; used on the board and in the sketch editor. */
export function DrawToolbar({ onDone, doneLabel = 'Готово' }: { onDone: () => void; doneLabel?: string }) {
  const { tool, color, size } = useDrawTool();
  return (
    <div className="draw-bar panel" role="toolbar" aria-label="Рисование" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className={`fmt${tool === 'pen' ? ' on' : ''}`} aria-label="Перо (D)" title="Перо (D)" onClick={() => useDrawTool.setState({ tool: 'pen' })}>
        <IconDraw size={17} />
      </button>
      <button type="button" className={`fmt${tool === 'eraser' ? ' on' : ''}`} aria-label="Ластик (E)" title="Ластик (E)" onClick={() => useDrawTool.setState({ tool: 'eraser' })}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 21h10" /><path d="M5 15l9-9 5 5-8 8H8z" /></svg>
      </button>
      <span className="fmt-sep" aria-hidden="true" />
      {PEN_COLORS.map((c) => (
        <button key={c} type="button" className={`pen-color${c === color && tool === 'pen' ? ' on' : ''}`} aria-label={`Цвет ${c}`} title="X — предыдущий цвет" style={{ background: c }} onClick={() => setColor(c)} />
      ))}
      <span className="fmt-sep" aria-hidden="true" />
      {PEN_SIZES.map((w, i) => (
        <button key={w} type="button" className={`fmt${size === i + 1 ? ' on' : ''}`} aria-label={`Толщина ${i + 1}`} title={`Толщина ${i + 1}`} onClick={() => useDrawTool.setState({ size: i + 1 })}>
          <span style={{ width: Math.max(4, w), height: Math.max(4, w), borderRadius: '50%', background: 'currentColor' }} />
        </button>
      ))}
      <span className="fmt-sep" aria-hidden="true" />
      <button type="button" className="btn-accent" onClick={onDone} title="Esc">{doneLabel}</button>
    </div>
  );
}
