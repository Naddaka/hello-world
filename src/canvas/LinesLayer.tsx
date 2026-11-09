import { useState } from 'react';
import { create } from 'zustand';
import { actions, useStore } from '../model/store';
import { GRID, type ElementFields, type LineColor, type LineElement, type LineEnd, type ZElement, type LineStyle } from '../model/types';
import { arrowHead, bendFor, lineGeometry, type Pt } from './lineGeometry';
import { screenToCanvas, useSizeVersion } from './runtime';
import { openMenu, type MenuEntry } from '../ui/ContextMenu';

export const LINE_STYLES: { key: LineStyle; label: string }[] = [
  { key: 'solid', label: 'Сплошная' },
  { key: 'dashed', label: 'Пунктир' },
  { key: 'dotted', label: 'Точками' },
];

/** Dash pattern for a line style at a stroke width (dots are round caps on zero-length dashes). */
export function dashFor(style: LineStyle | undefined, width: number): string | undefined {
  if (style === 'dashed') return `${width * 4} ${width * 3}`;
  if (style === 'dotted') return `0.01 ${width * 2.4}`;
  return undefined;
}

export const LINE_COLORS: { key: LineColor; label: string }[] = [
  { key: 'default', label: 'Серая' },
  { key: 'blue', label: 'Синяя' },
  { key: 'red', label: 'Красная' },
  { key: 'green', label: 'Зелёная' },
  { key: 'orange', label: 'Оранжевая' },
  { key: 'purple', label: 'Фиолетовая' },
];

/** A line being drawn from a card's handle, before it is created. */
export const useLineDraft = create<{ from: string | null; to: Pt | null; target: string | null }>(() => ({ from: null, to: null, target: null }));

/** Element (not a line) under a screen point that a line end could attach to. */
function attachableAt(clientX: number, clientY: number, exclude: string[]): string | null {
  const els = document.elementsFromPoint(clientX, clientY);
  for (const node of els) {
    const id = (node as HTMLElement).closest?.<HTMLElement>('[data-element-id]')?.dataset.elementId;
    if (id && !exclude.includes(id)) return id;
  }
  return null;
}

function endAt(clientX: number, clientY: number, exclude: string[]): LineEnd {
  const target = attachableAt(clientX, clientY, exclude);
  const p = screenToCanvas(clientX, clientY);
  return { elementId: target, x: p.x / GRID, y: p.y / GRID };
}

/** Starts drawing a new line from an element's handle; creates it on release. */
export function startLineFrom(elementId: string, e: React.PointerEvent) {
  e.stopPropagation();
  e.preventDefault();
  const onMove = (ev: PointerEvent) => {
    const p = screenToCanvas(ev.clientX, ev.clientY);
    useLineDraft.setState({ from: elementId, to: p, target: attachableAt(ev.clientX, ev.clientY, [elementId]) });
  };
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const { to } = useLineDraft.getState();
    useLineDraft.setState({ from: null, to: null, target: null });
    if (!to) return;
    const end = endAt(ev.clientX, ev.clientY, [elementId]);
    const boardId = useStore.getState().boardId;
    const id = actions.insert(newLine({ elementId, x: 0, y: 0 }, end), boardId, 0, 0, 0);
    actions.select([id]);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

export function newLine(start: LineEnd, end: LineEnd): ElementFields<LineElement> {
  return { type: 'LINE', start, end, bend: 0, label: '', color: 'default', weight: 2, arrowStart: false, arrowEnd: true };
}

function lineMenu(line: LineElement): MenuEntry[] {
  return [
    { label: line.label ? 'Изменить подпись' : 'Подпись', hint: 'двойной клик', run: () => actions.setEditing(line.id) },
    { label: line.bend ? 'Сделать прямой' : 'Прямая', disabled: !line.bend, run: () => actions.update(line.id, { bend: 0 }) },
    { label: line.arrowEnd ? 'Убрать стрелку в конце' : 'Стрелка в конце', run: () => actions.update(line.id, { arrowEnd: !line.arrowEnd }) },
    { label: line.arrowStart ? 'Убрать стрелку в начале' : 'Стрелка в начале', run: () => actions.update(line.id, { arrowStart: !line.arrowStart }) },
    'sep',
    ...LINE_COLORS.map((c) => ({ label: `${c.key === line.color ? '● ' : ''}${c.label}`, run: () => actions.update(line.id, { color: c.key }) })),
    'sep',
    ...([1, 2, 3] as const).map((w) => ({ label: `${w === line.weight ? '● ' : ''}${['Тонкая', 'Средняя', 'Толстая'][w - 1]}`, run: () => actions.update(line.id, { weight: w }) })),
    'sep',
    ...LINE_STYLES.map((s) => ({ label: `${s.key === (line.style ?? 'solid') ? '● ' : ''}${s.label}`, run: () => actions.update(line.id, { style: s.key }) })),
    'sep',
    { label: 'Удалить', danger: true, run: () => actions.trash([line.id]) },
  ];
}

function LabelInput({ line }: { line: LineElement }) {
  const [value, setValue] = useState(line.label);
  const finish = () => {
    actions.update(line.id, { label: value.trim() });
    actions.setEditing(null);
  };
  return (
    <input
      className="line-label-input"
      aria-label="Подпись линии"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') finish();
      }}
      onBlur={finish}
    />
  );
}

function LineView({ line, elements, boardId, selected, editing }: { line: LineElement; elements: Record<string, ZElement>; boardId: string; selected: boolean; editing: boolean }) {
  const [live, setLive] = useState<Pick<LineElement, 'start' | 'end' | 'bend'> | null>(null);
  const geo = lineGeometry(live ?? line, elements, boardId);
  if (!geo) return null;
  const { a, b, ctrl, mid } = geo;
  const d = `M ${a.x} ${a.y} Q ${ctrl.x} ${ctrl.y} ${b.x} ${b.y}`;
  const stroke = `var(--line-${line.color})`;
  const w = line.weight === 1 ? 1.5 : line.weight === 2 ? 2.25 : 3.5;
  const dash = dashFor(line.style, w);

  const drag = (e: React.PointerEvent, part: 'start' | 'end' | 'mid' | 'body') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    actions.select([line.id]);
    const startPt = screenToCanvas(e.clientX, e.clientY);
    let moved = false;
    let next: Pick<LineElement, 'start' | 'end' | 'bend'> = { start: line.start, end: line.end, bend: line.bend };
    const onMove = (ev: PointerEvent) => {
      const p = screenToCanvas(ev.clientX, ev.clientY);
      if (!moved && Math.hypot(p.x - startPt.x, p.y - startPt.y) < 3) return;
      moved = true;
      if (part === 'mid') next = { ...next, bend: bendFor(p, a, b) };
      else if (part === 'body') {
        // Only free ends move with the line; attached ends stay on their cards.
        const dx = (p.x - startPt.x) / GRID;
        const dy = (p.y - startPt.y) / GRID;
        const shift = (end: LineEnd) => (end.elementId ? end : { ...end, x: end.x + dx, y: end.y + dy });
        next = { ...next, start: shift(line.start), end: shift(line.end) };
      } else {
        const other = part === 'start' ? geo.b : geo.a;
        const end = endAt(ev.clientX, ev.clientY, [line.id]);
        if (ev.shiftKey && !end.elementId) {
          // Shift keeps the line perfectly horizontal or vertical.
          const px = end.x * GRID;
          const py = end.y * GRID;
          if (Math.abs(px - other.x) > Math.abs(py - other.y)) end.y = other.y / GRID;
          else end.x = other.x / GRID;
        }
        next = { ...next, [part]: end };
      }
      setLive(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLive(null);
      if (moved) actions.update(line.id, next);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    actions.select([line.id]);
    openMenu(e.clientX, e.clientY, lineMenu(line));
  };

  return (
    <g className={`line${selected ? ' selected' : ''}`} data-line-id={line.id}>
      <path d={d} className="line-hit" onPointerDown={(e) => drag(e, 'body')} onDoubleClick={(e) => { e.stopPropagation(); actions.setEditing(line.id); }} onContextMenu={onContext} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeDasharray={dash} className="line-path" />
      {line.arrowEnd && <polygon points={arrowHead(b, ctrl, 3 + w)} fill={stroke} />}
      {line.arrowStart && <polygon points={arrowHead(a, ctrl, 3 + w)} fill={stroke} />}
      {(line.label || editing) && (
        // Sits just above the line, so the bend handle in the middle stays reachable.
        <foreignObject x={mid.x - 120} y={mid.y - 36} width={240} height={32} className="line-label-box">
          <div className="line-label-wrap">
            {editing ? <LabelInput line={line} /> : <span className="line-label" onPointerDown={(e) => drag(e, 'body')} onDoubleClick={(e) => { e.stopPropagation(); actions.setEditing(line.id); }} onContextMenu={onContext}>{line.label}</span>}
          </div>
        </foreignObject>
      )}
      {selected && !editing && (
        <>
          <circle cx={a.x} cy={a.y} r={6} className="line-handle" onPointerDown={(e) => drag(e, 'start')} />
          <circle cx={b.x} cy={b.y} r={6} className="line-handle" onPointerDown={(e) => drag(e, 'end')} />
          <circle cx={mid.x} cy={mid.y} r={5} className="line-handle mid" onPointerDown={(e) => drag(e, 'mid')} onDoubleClick={(e) => { e.stopPropagation(); actions.update(line.id, { bend: 0 }); }}>
            <title>Потяните, чтобы изогнуть; двойной клик — прямая</title>
          </circle>
        </>
      )}
    </g>
  );
}

/** SVG layer with all lines of the board, drawn under the cards. */
export function LinesLayer({ lines }: { lines: LineElement[] }) {
  useSizeVersion((s) => s.v);
  const elements = useStore((s) => s.elements);
  const boardId = useStore((s) => s.boardId);
  const selection = useStore((s) => s.selection);
  const editingId = useStore((s) => s.editingId);
  const draft = useLineDraft();
  const draftGeo = draft.from && draft.to ? lineGeometry({ start: { elementId: draft.from, x: 0, y: 0 }, end: { elementId: draft.target, x: draft.to.x / GRID, y: draft.to.y / GRID }, bend: 0 }, elements, boardId) : null;
  return (
    <svg className="lines" width="1" height="1" aria-hidden="true">
      {lines.map((line) => (
        <LineView key={line.id} line={line} elements={elements} boardId={boardId} selected={selection.includes(line.id)} editing={editingId === line.id} />
      ))}
      {draftGeo && (
        <g>
          <path d={`M ${draftGeo.a.x} ${draftGeo.a.y} L ${draftGeo.b.x} ${draftGeo.b.y}`} stroke="var(--accent)" strokeWidth={2.25} strokeDasharray="6 5" fill="none" />
          <polygon points={arrowHead(draftGeo.b, draftGeo.a, 5)} fill="var(--accent)" />
        </g>
      )}
    </svg>
  );
}
