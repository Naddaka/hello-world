import { Fragment, useMemo, useState } from 'react';
import { actions, columnChildren, countChildren, useStore } from '../model/store';
import type { ColumnElement } from '../model/types';
import { ElementView } from './ElementView';
import { useDrag } from './dnd';
import { IconChevronDown } from '../ui/icons';
import { plural } from '../ui/plural';

function TitleInput({ element }: { element: ColumnElement }) {
  const [value, setValue] = useState(element.title);
  const finish = (save: boolean) => {
    if (save) actions.update(element.id, { title: value.trim() || 'Без названия' });
    actions.setEditing(null);
  };
  return (
    <>
      <label className="sr-only" htmlFor={`col-${element.id}`}>Название колонки</label>
      <input
        id={`col-${element.id}`}
        className="col-title-input"
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

export function ColumnView({ element, selected, editing }: { element: ColumnElement; selected: boolean; editing: boolean }) {
  const elements = useStore((s) => s.elements);
  const items = useMemo(() => columnChildren(elements, element.id), [elements, element.id]);
  const indicator = useDrag((s) => (s.drop?.kind === 'column' && s.drop.id === element.id ? s.drop.index : null));

  return (
    <section className={`column${selected ? ' selected' : ''}${indicator !== null ? ' drop' : ''}`} aria-label={`Колонка ${element.title}`} data-drop-column={element.id}>
      <header className="col-head" onDoubleClick={(e) => { e.stopPropagation(); actions.setEditing(element.id); }}>
        {editing ? <TitleInput element={element} /> : <h3 className="col-title">{element.title}</h3>}
        <span className="col-count">{items.length} {plural(items.length)}</span>
        <button
          type="button"
          className="col-toggle"
          aria-label={element.collapsed ? 'Развернуть колонку' : 'Свернуть колонку'}
          aria-expanded={!element.collapsed}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => actions.update(element.id, { collapsed: !element.collapsed })}
        >
          <IconChevronDown size={14} style={{ transform: element.collapsed ? 'rotate(-90deg)' : undefined }} />
        </button>
      </header>
      {!element.collapsed && (
        <div className="col-body">
          {items.map((item, i) => (
            <Fragment key={item.id}>
              {indicator === i && <div className="col-indicator" aria-hidden="true" />}
              <ElementView element={item} mode="list" inLayer count={item.type === 'BOARD' ? countChildren(elements, item.id) : 0} />
            </Fragment>
          ))}
          {indicator !== null && indicator >= items.length && <div className="col-indicator" aria-hidden="true" />}
          {items.length === 0 && indicator === null && <div className="col-empty">Перетащите сюда карточки</div>}
        </div>
      )}
    </section>
  );
}
