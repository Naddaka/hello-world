import { useEffect, useMemo, useRef, useState } from 'react';
import { actions, useStore } from '../model/store';
import { GRID, type CardColor, type CellFormat, type CellKind, type TableElement } from '../model/types';
import { colName, computeTable, FUNCTION_NAMES, type Value } from './formula';
import { openMenu, type MenuEntry } from '../ui/ContextMenu';

const num = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 10 });
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat('ru-RU');

export const KINDS: { kind: CellKind; label: string }[] = [
  { kind: 'auto', label: 'Авто' },
  { kind: 'number', label: 'Число' },
  { kind: 'currency', label: 'Валюта' },
  { kind: 'percent', label: 'Процент' },
  { kind: 'checkbox', label: 'Чекбокс' },
  { kind: 'text', label: 'Текст' },
  { kind: 'date', label: 'Дата' },
];

const FILLS: CardColor[] = ['default', 'yellow', 'green', 'blue', 'purple', 'pink', 'orange'];

function display(v: Value, raw: string, fmt: CellFormat | undefined): { text: string; numeric: boolean; error: boolean; check?: boolean } {
  const kind = fmt?.kind ?? 'auto';
  if (typeof v === 'string' && /^#[A-Z/0!?]+/.test(v)) return { text: v, numeric: false, error: true };
  if (kind === 'checkbox' || (kind === 'auto' && typeof v === 'boolean')) return { text: '', numeric: false, error: false, check: Boolean(v) };
  if (kind === 'text') return { text: raw, numeric: false, error: false };
  if (v === null) return { text: '', numeric: false, error: false };
  if (v instanceof Date) return { text: date.format(v), numeric: true, error: false };
  if (typeof v === 'number') {
    if (kind === 'currency') return { text: money.format(v), numeric: true, error: false };
    if (kind === 'percent') return { text: pct.format(v), numeric: true, error: false };
    if (kind === 'date') return { text: date.format(new Date((v - 25569) * 86_400_000)), numeric: true, error: false };
    return { text: num.format(v), numeric: true, error: false };
  }
  return { text: String(v), numeric: false, error: false };
}

const key = (r: number, c: number) => `${r},${c}`;

interface Pos {
  r: number;
  c: number;
}

function clampPos(p: Pos, rows: number, cols: number): Pos {
  return { r: Math.max(0, Math.min(rows - 1, p.r)), c: Math.max(0, Math.min(cols - 1, p.c)) };
}

/** Table data operations that keep cells, widths and formats consistent. */
function insertRow(t: Pick<TableElement, 'cells' | 'formats'>, at: number) {
  const cols = t.cells[0]?.length ?? 1;
  const cells = [...t.cells.slice(0, at), Array(cols).fill(''), ...t.cells.slice(at)];
  return { cells, formats: shiftFormats(t.formats, (r, c) => (r >= at ? [r + 1, c] : [r, c])) };
}
function insertCol(t: Pick<TableElement, 'cells' | 'formats' | 'colWidths'>, at: number) {
  return {
    cells: t.cells.map((row) => [...row.slice(0, at), '', ...row.slice(at)]),
    colWidths: [...t.colWidths.slice(0, at), 120, ...t.colWidths.slice(at)],
    formats: shiftFormats(t.formats, (r, c) => (c >= at ? [r, c + 1] : [r, c])),
  };
}
function deleteRow(t: Pick<TableElement, 'cells' | 'formats'>, at: number) {
  return { cells: t.cells.filter((_, r) => r !== at), formats: shiftFormats(t.formats, (r, c) => (r === at ? null : r > at ? [r - 1, c] : [r, c])) };
}
function deleteCol(t: Pick<TableElement, 'cells' | 'formats' | 'colWidths'>, at: number) {
  return {
    cells: t.cells.map((row) => row.filter((_, c) => c !== at)),
    colWidths: t.colWidths.filter((_, c) => c !== at),
    formats: shiftFormats(t.formats, (r, c) => (c === at ? null : c > at ? [r, c - 1] : [r, c])),
  };
}
function shiftFormats(formats: Record<string, CellFormat>, map: (r: number, c: number) => [number, number] | null) {
  const out: Record<string, CellFormat> = {};
  for (const [k, f] of Object.entries(formats)) {
    const [r, c] = k.split(',').map(Number);
    const to = map(r, c);
    if (to) out[key(to[0], to[1])] = f;
  }
  return out;
}

/** Card width in grid units for the given column widths (plus the card's padding). */
export function tableWidth(colWidths: number[]) {
  return Math.ceil((colWidths.reduce((a, b) => a + b, 0) + 20) / GRID);
}

function TableGrid({ element, editing }: { element: TableElement; editing: boolean }) {
  const values = useMemo(() => computeTable(element.cells), [element.cells]);
  const rows = element.cells.length;
  const cols = element.cells[0]?.length ?? 0;
  const [active, setActive] = useState<Pos>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [draft, setDraft] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // A hidden field keeps focus while no cell is being edited, so every kind of
  // text input (keyboard layouts, input methods, accents) starts editing a cell.
  const capture = useRef<HTMLTextAreaElement>(null);
  const focusGrid = () => capture.current?.focus();
  // Column where a run of Tabs started: Enter returns there on the next row.
  const tabFrom = useRef<number | null>(null);
  const start = useRef({ cells: element.cells, colWidths: element.colWidths, formats: element.formats, width: element.width });
  const current = useRef(element);
  current.current = element;

  useEffect(() => {
    if (!editing) return;
    start.current = { cells: element.cells, colWidths: element.colWidths, formats: element.formats, width: element.width };
    focusGrid();
    return () => {
      const e = current.current;
      if (!useStore.getState().elements[e.id]) return;
      actions.recordEdit(e.id, start.current, { cells: e.cells, colWidths: e.colWidths, formats: e.formats, width: e.width });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, element.id]);

  const save = (patch: Partial<Pick<TableElement, 'cells' | 'colWidths' | 'formats'>>) => {
    const colWidths = patch.colWidths ?? current.current.colWidths;
    actions.setLive(element.id, { ...patch, width: tableWidth(colWidths) });
  };
  const range = { r1: Math.min(active.r, anchor.r), r2: Math.max(active.r, anchor.r), c1: Math.min(active.c, anchor.c), c2: Math.max(active.c, anchor.c) };
  const inRange = (r: number, c: number) => r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
  const each = (fn: (r: number, c: number) => void) => {
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) fn(r, c);
  };

  const setCell = (r: number, c: number, raw: string) => {
    const cells = current.current.cells.map((row) => row.slice());
    cells[r][c] = raw;
    save({ cells });
  };
  const committing = useRef(false);
  const commitDraft = () => {
    // Moving focus blurs the cell input, which would commit a second time.
    if (committing.current) return;
    committing.current = true;
    if (draft !== null) setCell(active.r, active.c, draft);
    setDraft(null);
    // Focus synchronously: keys typed right after Enter/Tab must not be lost.
    focusGrid();
    committing.current = false;
  };
  const move = (p: Pos, extend = false) => {
    const next = clampPos(p, rows, cols);
    setActive(next);
    if (!extend) setAnchor(next);
  };
  const enterDown = () => {
    move({ r: active.r + 1, c: tabFrom.current ?? active.c });
    tabFrom.current = null;
  };
  const tab = (back: boolean) => {
    if (tabFrom.current === null) tabFrom.current = active.c;
    move({ r: active.r, c: active.c + (back ? -1 : 1) });
  };
  const formatRange = (patch: CellFormat) => {
    const formats = { ...current.current.formats };
    each((r, c) => (formats[key(r, c)] = { ...formats[key(r, c)], ...patch }));
    save({ formats });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const mod = e.metaKey || e.ctrlKey;
    if (draft !== null) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitDraft();
        enterDown();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitDraft();
        tab(e.shiftKey);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setDraft(null);
        focusGrid();
      }
      return;
    }
    const arrows: Record<string, Pos> = { ArrowUp: { r: -1, c: 0 }, ArrowDown: { r: 1, c: 0 }, ArrowLeft: { r: 0, c: -1 }, ArrowRight: { r: 0, c: 1 } };
    const d = arrows[e.key];
    if (d && e.altKey) {
      // ⌥ + arrow adds a row or column on that side, like the reference app.
      e.preventDefault();
      const t = current.current;
      if (d.r) save(insertRow(t, d.r > 0 ? active.r + 1 : active.r));
      else save(insertCol(t, d.c > 0 ? active.c + 1 : active.c));
      // Not clamped: the table has just grown, `rows`/`cols` are still the old size.
      const next = { r: active.r + Math.max(0, d.r), c: active.c + Math.max(0, d.c) };
      setActive(next);
      setAnchor(next);
    } else if (d && mod) {
      e.preventDefault();
      move({ r: d.r ? (d.r > 0 ? rows - 1 : 0) : active.r, c: d.c ? (d.c > 0 ? cols - 1 : 0) : active.c }, e.shiftKey);
    } else if (d) {
      e.preventDefault();
      tabFrom.current = null;
      move({ r: active.r + d.r, c: active.c + d.c }, e.shiftKey);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setDraft(current.current.cells[active.r][active.c]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      tab(e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      actions.setEditing(null);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const cells = current.current.cells.map((row) => row.slice());
      each((r, c) => (cells[r][c] = ''));
      save({ cells });
    } else if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      formatRange({ bold: !current.current.formats[key(active.r, active.c)]?.bold });
    } else if (mod && e.key.toLowerCase() === 'z') {
      // Leave table editing first so the session is recorded, then undo it.
      e.preventDefault();
      actions.setEditing(null);
      setTimeout(() => (e.shiftKey ? actions.redo() : actions.undo()), 0);
    } else if (e.key === ' ' && (current.current.formats[key(active.r, active.c)]?.kind === 'checkbox' || typeof values[active.r]?.[active.c] === 'boolean')) {
      e.preventDefault();
      const v = values[active.r][active.c];
      setCell(active.r, active.c, v ? 'FALSE' : 'TRUE');
    }
    // Printable characters reach the hidden field and start editing through onInput.
  };

  const onCaptureInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const text = e.currentTarget.value;
    if ((e.nativeEvent as InputEvent).isComposing) return;
    e.currentTarget.value = '';
    if (text) setDraft(text);
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (draft !== null) return;
    e.preventDefault();
    e.stopPropagation();
    const lines: string[] = [];
    for (let r = range.r1; r <= range.r2; r++) lines.push(current.current.cells[r].slice(range.c1, range.c2 + 1).join('\t'));
    e.clipboardData.setData('text/plain', lines.join('\n'));
  };
  const onPaste = (e: React.ClipboardEvent) => {
    if (draft !== null) return;
    e.preventDefault();
    e.stopPropagation();
    const grid = e.clipboardData.getData('text/plain').replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    let t: Pick<TableElement, 'cells' | 'formats' | 'colWidths'> = current.current;
    while (t.cells.length < active.r + grid.length) t = { ...t, ...insertRow(t, t.cells.length) };
    while ((t.cells[0]?.length ?? 0) < active.c + Math.max(...grid.map((g) => g.length))) t = { ...t, ...insertCol(t, t.cells[0].length) };
    const cells = t.cells.map((row) => row.slice());
    grid.forEach((line, i) => line.forEach((v, j) => (cells[active.r + i][active.c + j] = v)));
    save({ cells, colWidths: t.colWidths, formats: t.formats });
  };

  const headerMenu = (e: React.MouseEvent, kind: 'row' | 'col', index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const t = current.current;
    const items: MenuEntry[] =
      kind === 'row'
        ? [
            { label: 'Строка выше', run: () => save(insertRow(t, index)) },
            { label: 'Строка ниже', hint: '⌥↓', run: () => save(insertRow(t, index + 1)) },
            'sep',
            { label: 'Удалить строку', danger: true, disabled: rows <= 1, run: () => save(deleteRow(t, index)) },
          ]
        : [
            { label: 'Колонка слева', run: () => save(insertCol(t, index)) },
            { label: 'Колонка справа', hint: '⌥→', run: () => save(insertCol(t, index + 1)) },
            'sep',
            { label: 'Удалить колонку', danger: true, disabled: cols <= 1, run: () => save(deleteCol(t, index)) },
          ];
    openMenu(e.clientX, e.clientY, items);
  };

  const resizeCol = (e: React.PointerEvent, c: number) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = current.current.colWidths[c];
    const zoom = useStore.getState().cameras[useStore.getState().boardId]?.zoom ?? 1;
    const onMove = (ev: PointerEvent) => {
      const colWidths = current.current.colWidths.slice();
      colWidths[c] = Math.max(48, Math.round(startW + (ev.clientX - startX) / zoom));
      save({ colWidths });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const fmt = element.formats[key(active.r, active.c)] ?? {};
  const suggestions = draft?.startsWith('=') && /[A-Za-z.]+$/.test(draft) ? FUNCTION_NAMES.filter((n) => n.startsWith(draft.match(/[A-Za-z.]+$/)![0].toUpperCase())).slice(0, 6) : [];

  return (
    <div
      ref={box}
      className={`table-box${editing ? ' editing' : ''}`}
      onCopy={editing ? onCopy : undefined}
      onPaste={editing ? onPaste : undefined}
      onPointerDown={(e) => editing && e.stopPropagation()}
    >
      {editing && (
        <textarea
          ref={capture}
          className="zt-capture"
          aria-label="Таблица: начните печатать, чтобы заполнить ячейку"
          onKeyDown={onKeyDown}
          onInput={onCaptureInput}
          onCompositionEnd={(e) => {
            const text = e.currentTarget.value;
            e.currentTarget.value = '';
            if (text) setDraft(text);
          }}
        />
      )}
      {editing && (
        <div className="table-bar panel" onPointerDown={(e) => e.stopPropagation()}>
          <select aria-label="Тип ячейки" value={fmt.kind ?? 'auto'} onChange={(e) => formatRange({ kind: e.target.value as CellKind })}>
            {KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>{k.label}</option>
            ))}
          </select>
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a} type="button" className={`fmt${fmt.align === a ? ' on' : ''}`} aria-label={{ left: 'Влево', center: 'По центру', right: 'Вправо' }[a]} onClick={() => formatRange({ align: a })}>
              {{ left: '⇤', center: '↔', right: '⇥' }[a]}
            </button>
          ))}
          <button type="button" className={`fmt${fmt.bold ? ' on' : ''}`} aria-label="Жирный (⌘B)" onClick={() => formatRange({ bold: !fmt.bold })} style={{ fontWeight: 800 }}>Ж</button>
          {FILLS.map((f) => (
            <button key={f} type="button" className={`swatch small${(fmt.fill ?? 'default') === f ? ' on' : ''}`} aria-label={`Заливка ${f}`} style={{ background: `var(--card-${f})` }} onClick={() => formatRange({ fill: f })} />
          ))}
          <span className="fmt-sep" aria-hidden="true" />
          <button type="button" className="fmt" onClick={() => save(insertRow(current.current, rows))}>+ строка</button>
          <button type="button" className="fmt" onClick={() => save(insertCol(current.current, cols))}>+ колонка</button>
          <label className="table-header-toggle">
            <input type="checkbox" checked={element.header} onChange={() => actions.setLive(element.id, { header: !element.header })} /> Заголовок
          </label>
        </div>
      )}
      <table className={`zt${element.header ? ' with-header' : ''}`} style={{ width: element.colWidths.reduce((a, b) => a + b, 0) }}>
        <colgroup>
          {element.colWidths.map((w, c) => (
            <col key={c} style={{ width: w }} />
          ))}
        </colgroup>
        {editing && (
          <thead>
            <tr>
              {element.colWidths.map((_, c) => (
                <th key={c} className="zt-colhead" onContextMenu={(e) => headerMenu(e, 'col', c)} onPointerDown={() => { setAnchor({ r: 0, c }); setActive({ r: rows - 1, c }); }}>
                  {colName(c)}
                  <span className="zt-resize" onPointerDown={(e) => resizeCol(e, c)} />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {element.cells.map((row, r) => (
            <tr key={r}>
              {row.map((raw, c) => {
                const f = element.formats[key(r, c)];
                const shown = display(values[r][c], raw, f);
                const isActive = editing && active.r === r && active.c === c;
                return (
                  <td
                    key={c}
                    className={`zt-cell${isActive ? ' active' : ''}${editing && inRange(r, c) ? ' in-range' : ''}${shown.error ? ' error' : ''}`}
                    style={{ textAlign: f?.align ?? (shown.numeric ? 'right' : 'left'), fontWeight: f?.bold ? 700 : undefined, background: f?.fill && f.fill !== 'default' ? `var(--card-${f.fill})` : undefined }}
                    onPointerDown={(e) => {
                      if (!editing) return;
                      e.stopPropagation();
                      if (draft !== null && !(r === active.r && c === active.c)) commitDraft();
                      move({ r, c }, e.shiftKey);
                      tabFrom.current = null;
                      e.preventDefault();
                      focusGrid();
                    }}
                    onDoubleClick={(e) => {
                      if (!editing) return;
                      e.stopPropagation();
                      setDraft(raw);
                    }}
                  >
                    {editing && c === 0 && <span className="zt-rowhead" onContextMenu={(e) => headerMenu(e, 'row', r)}>{r + 1}</span>}
                    {isActive && draft !== null ? (
                      <>
                        <input className="zt-input" aria-label={`Ячейка ${colName(c)}${r + 1}`} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} onBlur={commitDraft} />
                        {suggestions.length > 0 && (
                          <ul className="zt-suggest panel">
                            {suggestions.map((name) => (
                              <li key={name}>
                                <button type="button" onMouseDown={(e) => { e.preventDefault(); setDraft(draft.replace(/[A-Za-z.]+$/, `${name}(`)); }}>{name}</button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    ) : shown.check !== undefined ? (
                      <input
                        type="checkbox"
                        className="zt-check"
                        checked={shown.check}
                        aria-label={`Ячейка ${colName(c)}${r + 1}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onChange={() => {
                          const cells = current.current.cells.map((x) => x.slice());
                          cells[r][c] = shown.check ? 'FALSE' : 'TRUE';
                          actions.update(element.id, { cells });
                        }}
                      />
                    ) : (
                      shown.text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <div className="table-hint">= — формула · ⌥+стрелка — добавить строку/колонку · Shift+стрелки — выделить · Esc — готово</div>}
    </div>
  );
}

export function TableCard({ element, selected, editing }: { element: TableElement; selected: boolean; editing: boolean }) {
  return (
    <div className={`note table-card${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}>
      <TableGrid element={element} editing={editing} />
    </div>
  );
}

export function newTableFields() {
  const colWidths = [120, 120, 120];
  return {
    type: 'TABLE' as const,
    cells: [
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ],
    colWidths,
    formats: {},
    header: true,
  };
}
