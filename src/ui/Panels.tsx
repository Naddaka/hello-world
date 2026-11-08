import { confirmDialog } from './Confirm';
import { useMemo } from 'react';
import { actions, countChildren, inboxChildren, trashChildren, useStore } from '../model/store';
import { ElementView } from '../canvas/ElementView';
import { useDrag } from '../canvas/dnd';
import { IconTrash } from './icons';

/** Unsorted: a per-board holding area for things not yet placed on the canvas. */
export function InboxPanel() {
  const elements = useStore((s) => s.elements);
  const boardId = useStore((s) => s.boardId);
  const items = useMemo(() => inboxChildren(elements, boardId), [elements, boardId]);
  const over = useDrag((s) => s.drop?.kind === 'inbox');
  return (
    <aside className={`side-panel right panel${over ? ' drop' : ''}`} aria-label="Неразобранное" data-drop-inbox onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <header className="side-head">
        <h2>Неразобранное</h2>
        <button type="button" className="ibtn" aria-label="Закрыть" onClick={() => actions.setPanel('inbox')}>✕</button>
      </header>
      <p className="side-hint">Сюда попадает всё, что вы бросаете на плитку доски. Перетащите карточку на холст, когда решите, где ей место.</p>
      <div className="side-list">
        {items.map((item) => (
          <ElementView key={item.id} element={item} mode="list" inLayer={false} count={item.type === 'BOARD' ? countChildren(elements, item.id) : 0} />
        ))}
        {items.length === 0 && <div className="col-empty">Пока пусто — перетащите сюда карточки</div>}
      </div>
    </aside>
  );
}

/** Trash of the current board: restore by button or by dragging back, or empty it. */
export function TrashPanel() {
  const elements = useStore((s) => s.elements);
  const boardId = useStore((s) => s.boardId);
  const items = useMemo(() => trashChildren(elements, boardId), [elements, boardId]);
  return (
    <aside className="side-panel left panel" aria-label="Корзина" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <header className="side-head">
        <h2>Корзина</h2>
        <button type="button" className="ibtn" aria-label="Закрыть" onClick={() => actions.setPanel('trash')}>✕</button>
      </header>
      <p className="side-hint">Удалённое хранится 90 дней. Перетащите карточку на холст или нажмите «Восстановить».</p>
      <div className="side-list">
        {items.map((item) => (
          <div key={item.id} className="trash-item">
            <ElementView element={item} mode="list" inLayer={false} readOnly count={item.type === 'BOARD' ? countChildren(elements, item.id) : 0} />
            <button type="button" className="link-btn" onClick={() => actions.restore([item.id])}>Восстановить</button>
          </div>
        ))}
        {items.length === 0 && <div className="col-empty">Корзина пуста</div>}
      </div>
      {items.length > 0 && (
        <footer className="side-foot">
          <button
            type="button"
            className="danger-btn"
            onClick={() => {
              void confirmDialog({
                title: 'Очистить корзину?',
                message: `${items.length} эл. будут удалены навсегда. Отменить это можно только до закрытия приложения.`,
                confirm: 'Удалить навсегда',
                danger: true,
              }).then((ok) => ok && actions.emptyTrash(boardId));
            }}
          >
            <IconTrash size={15} /> Очистить корзину
          </button>
        </footer>
      )}
    </aside>
  );
}
