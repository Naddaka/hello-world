import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { actions, useStore } from '../model/store';
import type { TaskItem, TaskListElement } from '../model/types';
import { IconTrash } from '../ui/icons';

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

function dueLabel(due: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due - today.getTime()) / 86_400_000);
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return dateFmt.format(due).replace('.', '');
}

function dueClass(item: TaskItem) {
  if (!item.due || item.done) return 'due';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return item.due < today.getTime() ? 'due overdue' : 'due';
}

function toInputDate(due: number | null) {
  if (!due) return '';
  const d = new Date(due);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function StaticTasks({ element }: { element: TaskListElement }) {
  const done = element.items.filter((i) => i.done).length;
  const setItems = (items: TaskItem[]) => actions.update(element.id, { items });
  return (
    <>
      {element.showTitle && (
        <div className="tasks-head">
          <h3 className="tasks-title">{element.title}</h3>
          <span className="tasks-count">{done} из {element.items.length}</span>
        </div>
      )}
      {element.showTitle && element.items.length > 0 && (
        <div className="tasks-progress" aria-hidden="true">
          <div style={{ width: `${(done / element.items.length) * 100}%` }} />
        </div>
      )}
      <ul className="tasks">
        {element.items.map((item) => (
          <li key={item.id} className={`task${item.done ? ' done' : ''}`} style={{ paddingLeft: item.indent * 24 }}>
            <input
              type="checkbox"
              checked={item.done}
              aria-label={item.done ? 'Выполнено' : 'Не выполнено'}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={() => setItems(element.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))}
            />
            <span className="task-text">{item.text || ' '}</span>
            {item.due && <span className={dueClass(item)}>{dueLabel(item.due)}</span>}
            {item.done && (
              <button
                type="button"
                className="task-del"
                aria-label="Удалить выполненную задачу"
                title="Удалить выполненную задачу"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setItems(element.items.filter((i) => i.id !== item.id))}
              >
                <IconTrash size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function EditTasks({ element }: { element: TaskListElement }) {
  const start = useRef({ title: element.title, items: element.items, showTitle: element.showTitle });
  const [title, setTitle] = useState(element.title);
  const [items, setItems] = useState(element.items);
  const [focusId, setFocusId] = useState<string | null>(element.items[element.items.length - 1]?.id ?? null);
  const latest = useRef({ title, items });
  latest.current = { title, items };
  const refs = useRef(new Map<string, HTMLInputElement>());

  useLayoutEffect(() => {
    if (focusId) refs.current.get(focusId)?.focus();
  }, [focusId, items.length]);

  useEffect(() => {
    const id = element.id;
    return () => {
      if (!useStore.getState().elements[id]) return;
      const after = { title: latest.current.title, items: latest.current.items.filter((i) => i.text.trim() || i.due), showTitle: start.current.showTitle };
      if (after.items.length === 0) after.items = [{ id: nanoid(), text: '', done: false, due: null, indent: 0 }];
      actions.setLive(id, after);
      actions.recordEdit(id, start.current, after);
    };
  }, [element.id]);

  const save = (next: TaskItem[], nextTitle = title) => {
    setItems(next);
    actions.setLive(element.id, { items: next, title: nextTitle });
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    const item = items[index];
    if (e.key === 'Escape') {
      e.preventDefault();
      actions.setEditing(null);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const fresh: TaskItem = { id: nanoid(), text: '', done: false, due: null, indent: item.indent };
      save([...items.slice(0, index + 1), fresh, ...items.slice(index + 1)]);
      setFocusId(fresh.id);
    } else if (e.key === 'Backspace' && item.text === '' && items.length > 1) {
      e.preventDefault();
      save(items.filter((i) => i.id !== item.id));
      setFocusId((index > 0 ? items[index - 1] : items[1]).id);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      save(items.map((i) => (i.id === item.id ? { ...i, indent: e.shiftKey ? 0 : 1 } : i)));
    } else if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      setFocusId(items[index - 1].id);
    } else if (e.key === 'ArrowDown' && index < items.length - 1) {
      e.preventDefault();
      setFocusId(items[index + 1].id);
    }
    e.stopPropagation();
  };

  return (
    <div onPointerDown={(e) => e.stopPropagation()}>
      {element.showTitle && (
        <>
          <label className="sr-only" htmlFor={`tl-${element.id}`}>Название списка</label>
          <input
            id={`tl-${element.id}`}
            className="tasks-title-input"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              actions.setLive(element.id, { title: e.target.value, items });
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === 'ArrowDown') {
                e.preventDefault();
                setFocusId(items[0]?.id ?? null);
              }
              if (e.key === 'Escape') actions.setEditing(null);
            }}
          />
        </>
      )}
      <ul className="tasks">
        {items.map((item, index) => (
          <li key={item.id} className={`task editing${item.done ? ' done' : ''}`} style={{ paddingLeft: item.indent * 24 }}>
            <input type="checkbox" checked={item.done} aria-label="Выполнено" onChange={() => save(items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))} />
            <label className="sr-only" htmlFor={`task-${item.id}`}>Задача</label>
            <input
              id={`task-${item.id}`}
              ref={(node) => {
                if (node) refs.current.set(item.id, node);
                else refs.current.delete(item.id);
              }}
              className="task-input"
              value={item.text}
              placeholder="Новая задача"
              onFocus={() => setFocusId(item.id)}
              onChange={(e) => save(items.map((i) => (i.id === item.id ? { ...i, text: e.target.value } : i)))}
              onKeyDown={(e) => onKey(e, index)}
            />
            <label className="due-picker" title="Срок">
              <span className="sr-only">Срок задачи</span>
              <input
                type="date"
                value={toInputDate(item.due)}
                onChange={(e) => {
                  const [y, m, d] = e.target.value.split('-').map(Number);
                  save(items.map((i) => (i.id === item.id ? { ...i, due: e.target.value ? new Date(y, m - 1, d).getTime() : null } : i)));
                }}
              />
              {item.due ? <span className={dueClass(item)}>{dueLabel(item.due)}</span> : <span className="due add">срок</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="tasks-hint">Enter — новая задача · Tab — подзадача · Esc — готово</div>
    </div>
  );
}

export function TaskListCard({ element, selected, editing }: { element: TaskListElement; selected: boolean; editing: boolean }) {
  return (
    <div className={`note tasklist${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}>
      {editing ? <EditTasks element={element} /> : <StaticTasks element={element} />}
    </div>
  );
}
