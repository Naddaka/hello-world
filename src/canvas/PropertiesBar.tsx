import { useLayoutEffect, useRef, useState } from 'react';
import { actions, useStore, DEFAULT_CAMERA } from '../model/store';
import type { BoardColor, BoardElement, CardColor, CardElement, LineElement, LineStyle, ZElement } from '../model/types';
import { useDrag } from './dnd';
import { useSizeVersion } from './runtime';
import { LINE_COLORS, LINE_STYLES, dashFor } from './LinesLayer';
import { usePresent } from '../ui/Presentation';
import { BoardIcon } from '../icons/boardIcons';
import { IconPicker } from '../icons/IconPicker';
import { IconBoard } from '../ui/icons';

/**
 * A bar over the selection with the properties of what is selected: colour,
 * thickness, style and arrows of lines; icon and colour of boards; colour of
 * notes. Several selected things of one kind change together, as one undo step.
 */

const BOARD_COLORS: BoardColor[] = ['blue', 'orange', 'green', 'purple', 'pink', 'yellow', 'gray'];
const CARD_COLORS: CardColor[] = ['default', 'yellow', 'green', 'blue', 'purple', 'pink', 'orange', 'transparent'];
const COLOR_NAMES: Record<string, string> = {
  default: 'Обычный',
  blue: 'Синий',
  orange: 'Оранжевый',
  green: 'Зелёный',
  purple: 'Фиолетовый',
  pink: 'Розовый',
  yellow: 'Жёлтый',
  gray: 'Серый',
  red: 'Красный',
  transparent: 'Без фона',
};

type Kind = 'LINE' | 'BOARD' | 'CARD';

function selectedOfOneKind(elements: Record<string, ZElement>, selection: string[]): { kind: Kind; items: ZElement[] } | null {
  const items = selection.map((id) => elements[id]).filter((e): e is ZElement => !!e && e.section !== 'TRASH');
  if (!items.length) return null;
  const kind = items[0].type;
  if (!['LINE', 'BOARD', 'CARD'].includes(kind) || items.some((e) => e.type !== kind)) return null;
  return { kind: kind as Kind, items };
}

/** Screen box around the selected elements, from their rendered nodes. */
function selectionRect(ids: string[]): DOMRect | null {
  let r: { l: number; t: number; r: number; b: number } | null = null;
  for (const id of ids) {
    const node = document.querySelector(`[data-element-id="${id}"]`) ?? document.querySelector(`[data-line-id="${id}"] .line-path`);
    if (!node) continue;
    const b = node.getBoundingClientRect();
    r = r ? { l: Math.min(r.l, b.left), t: Math.min(r.t, b.top), r: Math.max(r.r, b.right), b: Math.max(r.b, b.bottom) } : { l: b.left, t: b.top, r: b.right, b: b.bottom };
  }
  return r ? new DOMRect(r.l, r.t, r.r - r.l, r.b - r.t) : null;
}

export function PropertiesBar() {
  const selection = useStore((s) => s.selection);
  const elements = useStore((s) => s.elements);
  const editingId = useStore((s) => s.editingId);
  const camera = useStore((s) => s.cameras[s.boardId] ?? DEFAULT_CAMERA);
  const dragging = useDrag((s) => s.ids.length > 0);
  const presenting = usePresent((s) => s.active);
  const sizeVersion = useSizeVersion((s) => s.v);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const iconButton = useRef<HTMLButtonElement>(null);

  const chosen = selectedOfOneKind(elements, selection);
  const visible = !!chosen && !editingId && !dragging && !presenting;

  useLayoutEffect(() => {
    if (!visible || !chosen) return setPos(null);
    const rect = selectionRect(chosen.items.map((e) => e.id));
    const viewport = document.querySelector('.canvas')?.getBoundingClientRect();
    if (!rect || !viewport) return setPos(null);
    const w = bar.current?.offsetWidth ?? 300;
    const h = bar.current?.offsetHeight ?? 40;
    const left = Math.max(viewport.left + 8, Math.min(rect.left + rect.width / 2 - w / 2, viewport.right - w - 8));
    // Above the selection, or below it when there is no room (near the top bar).
    const above = rect.top - h - 12;
    const top = above > viewport.top + 8 ? above : Math.min(rect.bottom + 12, viewport.bottom - h - 8);
    setPos({ left, top });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selection, elements, camera, sizeVersion]);

  if (!visible || !chosen) return null;
  const ids = chosen.items.map((e) => e.id);
  const set = (patch: Parameters<typeof actions.updateMany>[1]) => actions.updateMany(ids, patch);

  let content: React.ReactNode = null;
  if (chosen.kind === 'LINE') {
    const lines = chosen.items as LineElement[];
    const first = lines[0];
    const all = <K extends keyof LineElement>(key: K, value: LineElement[K]) => lines.every((l) => (l[key] ?? (key === 'style' ? 'solid' : undefined)) === value);
    content = (
      <>
        <span className="pb-group" role="group" aria-label="Цвет линии">
          {LINE_COLORS.map((c) => (
            <button key={c.key} type="button" className={`pb-swatch${all('color', c.key) ? ' on' : ''}`} style={{ background: `var(--line-${c.key})` }} aria-label={c.label} aria-pressed={all('color', c.key)} title={c.label} onClick={() => set({ color: c.key })} />
          ))}
        </span>
        <span className="pb-sep" />
        <span className="pb-group" role="group" aria-label="Толщина">
          {([1, 2, 3] as const).map((w) => (
            <button key={w} type="button" className={`pb-btn${all('weight', w) ? ' on' : ''}`} aria-label={['Тонкая', 'Средняя', 'Толстая'][w - 1]} aria-pressed={all('weight', w)} title={['Тонкая', 'Средняя', 'Толстая'][w - 1]} onClick={() => set({ weight: w })}>
              <svg width="22" height="14" aria-hidden="true">
                <line x1="2" y1="7" x2="20" y2="7" stroke="currentColor" strokeWidth={[1.5, 2.5, 4][w - 1]} strokeLinecap="round" />
              </svg>
            </button>
          ))}
        </span>
        <span className="pb-sep" />
        <span className="pb-group" role="group" aria-label="Тип линии">
          {LINE_STYLES.map((s) => (
            <button key={s.key} type="button" className={`pb-btn${all('style', s.key as LineStyle) ? ' on' : ''}`} aria-label={s.label} aria-pressed={all('style', s.key as LineStyle)} title={s.label} onClick={() => set({ style: s.key })}>
              <svg width="26" height="14" aria-hidden="true">
                <line x1="3" y1="7" x2="23" y2="7" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeDasharray={dashFor(s.key, 2.2)} />
              </svg>
            </button>
          ))}
        </span>
        <span className="pb-sep" />
        <span className="pb-group" role="group" aria-label="Стрелки">
          <button type="button" className={`pb-btn${lines.every((l) => l.arrowStart) ? ' on' : ''}`} aria-label="Стрелка в начале" aria-pressed={lines.every((l) => l.arrowStart)} title="Стрелка в начале" onClick={() => set({ arrowStart: !first.arrowStart })}>
            <svg width="22" height="14" aria-hidden="true">
              <line x1="6" y1="7" x2="20" y2="7" stroke="currentColor" strokeWidth={2} />
              <polygon points="2,7 8,3 8,11" fill="currentColor" />
            </svg>
          </button>
          <button type="button" className={`pb-btn${lines.every((l) => l.arrowEnd) ? ' on' : ''}`} aria-label="Стрелка в конце" aria-pressed={lines.every((l) => l.arrowEnd)} title="Стрелка в конце" onClick={() => set({ arrowEnd: !first.arrowEnd })}>
            <svg width="22" height="14" aria-hidden="true">
              <line x1="2" y1="7" x2="16" y2="7" stroke="currentColor" strokeWidth={2} />
              <polygon points="20,7 14,3 14,11" fill="currentColor" />
            </svg>
          </button>
        </span>
      </>
    );
  } else if (chosen.kind === 'BOARD') {
    const boards = chosen.items as BoardElement[];
    const first = boards[0];
    content = (
      <>
        <button ref={iconButton} type="button" className="pb-btn pb-icon" aria-label="Иконка доски" aria-expanded={!!picker} title="Иконка доски" onClick={() => setPicker(picker ? null : iconButton.current!.getBoundingClientRect())}>
          <span style={{ color: `var(--board-${first.color}-fg)`, display: 'flex' }}>{first.icon ? <BoardIcon icon={first.icon} size={18} /> : <IconBoard size={18} />}</span>
          Иконка
        </button>
        <span className="pb-sep" />
        <span className="pb-group" role="group" aria-label="Цвет доски">
          {BOARD_COLORS.map((c) => (
            <button key={c} type="button" className={`pb-swatch${boards.every((b) => b.color === c) ? ' on' : ''}`} style={{ background: `var(--board-${c}-fg)` }} aria-label={COLOR_NAMES[c]} aria-pressed={boards.every((b) => b.color === c)} title={COLOR_NAMES[c]} onClick={() => set({ color: c })} />
          ))}
        </span>
      </>
    );
  } else {
    const cards = chosen.items as CardElement[];
    content = (
      <span className="pb-group" role="group" aria-label="Цвет заметки">
        {CARD_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`pb-swatch card${c === 'transparent' ? ' clear' : ''}${cards.every((n) => n.color === c) ? ' on' : ''}`}
            style={c === 'transparent' ? undefined : { background: `var(--card-${c})` }}
            aria-label={COLOR_NAMES[c]}
            aria-pressed={cards.every((n) => n.color === c)}
            title={COLOR_NAMES[c]}
            onClick={() => set({ color: c })}
          />
        ))}
      </span>
    );
  }

  return (
    <>
      <div
        ref={bar}
        className="props-bar panel"
        role="toolbar"
        aria-label="Свойства"
        style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {content}
      </div>
      {picker && chosen.kind === 'BOARD' && (
        <IconPicker
          value={(chosen.items[0] as BoardElement).icon}
          color={(chosen.items[0] as BoardElement).color}
          anchor={picker}
          onClose={() => setPicker(null)}
          onPick={(icon) => {
            set({ icon });
            setPicker(null);
          }}
        />
      )}
    </>
  );
}
