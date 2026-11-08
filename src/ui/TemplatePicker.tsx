import { useMemo, useState } from 'react';
import { actions, canvasChildren, useStore } from '../model/store';
import { HOME_ID, type BoardElement } from '../model/types';
import { BUILT_IN_TEMPLATES } from '../model/templates';
import { viewportCentreGrid } from '../canvas/runtime';

/** Offered on a new, empty board (not on the home board), like the reference app. */
export function TemplatePicker() {
  const elements = useStore((s) => s.elements);
  const boardId = useStore((s) => s.boardId);
  const panel = useStore((s) => s.panel);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const empty = useMemo(() => canvasChildren(elements, boardId).length === 0, [elements, boardId]);
  const custom = useMemo(
    () => Object.values(elements).filter((e): e is BoardElement => e.type === 'BOARD' && Boolean(e.isTemplate) && e.section !== 'TRASH' && e.id !== boardId),
    [elements, boardId],
  );
  if (boardId === HOME_ID || !empty || dismissed === boardId || panel) return null;

  const useBuiltIn = (id: string) => {
    const t = BUILT_IN_TEMPLATES.find((x) => x.id === id)!;
    const { roots, all } = t.build();
    const c = viewportCentreGrid();
    actions.paste(roots, all, { x: c.x - 40, y: c.y - 20 });
  };

  return (
    <aside className="template-picker panel" aria-label="Шаблоны" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <header className="side-head">
        <h2>Начать с шаблона</h2>
        <button type="button" className="ibtn" aria-label="Скрыть" onClick={() => setDismissed(boardId)}>✕</button>
      </header>
      <ul className="template-list">
        {(open ? BUILT_IN_TEMPLATES : BUILT_IN_TEMPLATES.slice(0, 2)).map((t) => (
          <li key={t.id}>
            <button type="button" className="template-item" onClick={() => useBuiltIn(t.id)}>
              <span className="template-name">{t.name}</span>
              <span className="template-desc">{t.description}</span>
            </button>
          </li>
        ))}
        {open && custom.length > 0 && <li className="template-group">Ваши шаблоны</li>}
        {open &&
          custom.map((t) => (
            <li key={t.id}>
              <button type="button" className="template-item" onClick={() => actions.applyTemplate(t.id, boardId)}>
                <span className="template-name">{t.title}</span>
                <span className="template-desc">свой шаблон</span>
              </button>
            </li>
          ))}
      </ul>
      {!open && (
        <button type="button" className="link-btn" style={{ margin: '0 12px 12px' }} onClick={() => setOpen(true)}>
          Ещё шаблоны{custom.length ? ` и ваши (${custom.length})` : ''}…
        </button>
      )}
    </aside>
  );
}
