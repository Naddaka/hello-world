import { BoardIcon } from '../icons/boardIcons';
import { TileTitle } from './TileTitle';
import { useState } from 'react';
import { actions } from '../model/store';
import type { BoardElement } from '../model/types';
import { IconBoard, IconShortcut } from '../ui/icons';
import { plural } from '../ui/plural';

function TitleInput({ element }: { element: BoardElement }) {
  const [value, setValue] = useState(element.title);
  const finish = (save: boolean) => {
    if (save) actions.update(element.id, { title: value.trim() || 'Без названия' });
    actions.setEditing(null);
  };
  return (
    <>
      <label className="sr-only" htmlFor={`title-${element.id}`}>Название доски</label>
      <input
        id={`title-${element.id}`}
        className="tile-input"
        autoFocus
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
      />
    </>
  );
}

export function BoardTile({ element, selected, editing, dropActive, count, compact = false, shortcut = false }: { element: BoardElement; selected: boolean; editing: boolean; dropActive: boolean; count: number; compact?: boolean; shortcut?: boolean }) {
  const c = element.color;
  const badge = shortcut && (
    <span className="shortcut-badge" title="Ярлык: ведёт на доску в другом месте" aria-label="Ярлык">
      <IconShortcut size={12} />
    </span>
  );
  if (compact) {
    // Inside a column or panel: a horizontal row instead of a large tile.
    return (
      <div className={`tile-row${selected ? ' selected' : ''}${dropActive ? ' drop' : ''}`} data-drop-board={element.id}>
        <span className="tile-row-icon" style={{ position: 'relative', background: `var(--board-${c}-bg)`, color: `var(--board-${c}-fg)` }}>
          {element.icon ? <BoardIcon icon={element.icon} size={20} /> : <IconBoard size={20} strokeWidth={1.8} />}
          {badge}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          {editing ? <TitleInput element={element} /> : <span className="tile-row-title">{element.title}</span>}
          <span className="tile-meta" style={{ marginTop: 0 }}>{count} {plural(count)}</span>
        </span>
      </div>
    );
  }
  return (
    <div className={`tile${selected ? ' selected' : ''}${dropActive ? ' drop' : ''}`} data-drop-board={element.id}>
      <div className="tile-icon" style={{ background: `var(--board-${c}-bg)`, color: `var(--board-${c}-fg)`, boxShadow: `inset 0 0 0 1px var(--board-${c}-ring)` }}>
        {element.icon ? <BoardIcon icon={element.icon} size={40} /> : <IconBoard size={38} strokeWidth={1.6} />}
        {badge}
      </div>
      {editing && !shortcut ? <TitleInput element={element} /> : <TileTitle text={element.title} />}
      <div className="tile-meta">{element.isTemplate ? 'Шаблон · ' : ''}{count} {plural(count)}</div>
    </div>
  );
}
