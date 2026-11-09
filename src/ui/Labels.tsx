import { confirmDialog } from './Confirm';
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { actions, allLabels, labelUsage, useStore } from '../model/store';
import type { LabelColor } from '../model/types';
import { labelTint } from './colors';
import { CustomColors } from './CustomColor';

const COLORS: LabelColor[] = ['blue', 'orange', 'green', 'purple', 'pink', 'yellow', 'red', 'gray'];

/** Coloured chips of an element's labels. */
export function LabelChips({ ids }: { ids: string[] }) {
  const elements = useStore((s) => s.elements);
  const labels = ids.map((id) => elements[id]).filter((l) => l?.type === 'LABEL');
  if (labels.length === 0) return null;
  return (
    <div className="label-chips">
      {labels.map((l) => l.type === 'LABEL' && (
        <span key={l.id} className="label-chip" style={{ background: labelTint(l.color).bg, color: labelTint(l.color).fg }}>
          {l.name}
        </span>
      ))}
    </div>
  );
}

export const useLabelPicker = create<{ x: number; y: number; ids: string[] | null }>(() => ({ x: 0, y: 0, ids: null }));

export function openLabelPicker(x: number, y: number, ids: string[]) {
  useLabelPicker.setState({ x, y, ids });
}

/** Picker to add, remove, create, rename, recolour and delete labels. */
export function LabelPicker() {
  const { x, y, ids } = useLabelPicker();
  const elements = useStore((s) => s.elements);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [coloring, setColoring] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const labels = useMemo(() => allLabels(elements), [elements]);
  const usage = useMemo(() => labelUsage(elements), [elements]);

  useEffect(() => {
    if (!ids) return;
    setQuery('');
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) useLabelPicker.setState({ ids: null });
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [ids]);

  if (!ids) return null;
  const close = () => useLabelPicker.setState({ ids: null });
  const q = query.trim().toLowerCase();
  const shown = labels.filter((l) => !q || l.name.toLowerCase().includes(q));
  const exact = labels.find((l) => l.name.toLowerCase() === q);
  const has = (labelId: string) => ids.every((id) => elements[id]?.labels?.includes(labelId));

  const submit = () => {
    if (!q) return;
    if (exact) actions.toggleLabel(ids, exact.id);
    else actions.createLabel(query, ids);
    setQuery('');
  };

  return (
    <div ref={ref} className="label-picker panel" role="dialog" aria-label="Метки" style={{ left: Math.min(x, window.innerWidth - 300), top: Math.min(y, window.innerHeight - 380) }}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="sr-only" htmlFor="label-query">Найти или создать метку</label>
        <input id="label-query" className="label-query" autoFocus value={query} placeholder="Найти или создать метку" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }} />
      </form>
      <ul className="label-list">
        {shown.map((l) => (
          <li key={l.id} className="label-row">
            <input type="checkbox" checked={has(l.id)} aria-label={`Метка ${l.name}`} onChange={() => actions.toggleLabel(ids, l.id)} />
            <button
              type="button"
              className="label-dot"
              aria-label="Сменить цвет"
              title="Сменить цвет"
              aria-expanded={coloring === l.id}
              style={{ background: labelTint(l.color).dot }}
              onClick={() => setColoring(coloring === l.id ? null : l.id)}
            />
            {renaming === l.id ? (
              <input
                className="label-rename"
                aria-label="Новое название"
                autoFocus
                defaultValue={l.name}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    actions.updateLabel(l.id, { name: e.currentTarget.value });
                    setRenaming(null);
                  }
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onBlur={(e) => {
                  actions.updateLabel(l.id, { name: e.currentTarget.value });
                  setRenaming(null);
                }}
              />
            ) : (
              <span className="label-name" onDoubleClick={() => setRenaming(l.id)} title="Двойной клик — переименовать">{l.name}</span>
            )}
            <span className="label-usage">{usage[l.id] ?? 0}</span>
            <button
              type="button"
              className="task-del"
              aria-label={`Удалить метку ${l.name}`}
              title="Удалить метку отовсюду"
              onClick={async () => {
                const ok = await confirmDialog({ title: `Удалить метку «${l.name}»?`, message: `Она исчезнет со всех карточек (${usage[l.id] ?? 0}).`, confirm: 'Удалить', danger: true });
                if (ok) actions.deleteLabel(l.id);
              }}
            >
              ✕
            </button>
            {coloring === l.id && (
              <span className="label-colors" role="group" aria-label={`Цвет метки ${l.name}`}>
                {COLORS.map((c) => (
                  <button key={c} type="button" className={`pb-swatch${l.color === c ? ' on' : ''}`} style={{ background: `var(--label-${c}-fg)` }} aria-label={c} aria-pressed={l.color === c} onClick={() => actions.updateLabel(l.id, { color: c })} />
                ))}
                <CustomColors value={l.color} swatchClass="pb-swatch" onPreview={(hex) => actions.previewMany([l.id], { color: hex })} onPick={(hex) => actions.updateMany([l.id], { color: hex })} />
              </span>
            )}
          </li>
        ))}
        {q && !exact && (
          <li>
            <button type="button" className="menu-item" onClick={submit}>
              Создать метку «{query.trim()}»
            </button>
          </li>
        )}
        {shown.length === 0 && !q && <li className="col-empty">Меток пока нет — введите название</li>}
      </ul>
    </div>
  );
}
