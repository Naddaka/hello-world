import { useState } from 'react';
import { actions } from '../model/store';
import type { BoardElement } from '../model/types';
import { IconBoard } from '../ui/icons';

function plural(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'карточка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'карточки';
  return 'карточек';
}

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

export function BoardTile({ element, selected, editing, dropActive, count }: { element: BoardElement; selected: boolean; editing: boolean; dropActive: boolean; count: number }) {
  const c = element.color;
  return (
    <div className={`tile${selected ? ' selected' : ''}${dropActive ? ' drop' : ''}`} data-drop-board={element.id}>
      <div className="tile-icon" style={{ background: `var(--board-${c}-bg)`, color: `var(--board-${c}-fg)`, boxShadow: `inset 0 0 0 1px var(--board-${c}-ring)` }}>
        <IconBoard size={38} strokeWidth={1.6} />
      </div>
      {editing ? <TitleInput element={element} /> : <div className="tile-title">{element.title}</div>}
      <div className="tile-meta">{count} {plural(count)}</div>
    </div>
  );
}
