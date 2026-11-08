import { useEffect, useMemo, useRef, useState } from 'react';
import { actions, boardPath, containingBoard, useStore } from '../model/store';
import { HOME_ID, type ZElement } from '../model/types';
import { elementText } from '../model/text';
import { centreOn } from '../canvas/runtime';
import { IconBoard, IconColumn, IconComment, IconFile, IconLine, IconLink, IconMedia, IconNote, IconSearch, IconDraw, IconScript, IconSwatch, IconTable, IconTag, IconTasks } from './icons';

type Sort = 'viewed' | 'modified';

const ICONS = { CARD: IconNote, BOARD: IconBoard, COLUMN: IconColumn, TASK_LIST: IconTasks, IMAGE: IconMedia, FILE: IconFile, LINK: IconLink, LINE: IconLine, COLOR_SWATCH: IconSwatch, LABEL: IconTag, TABLE: IconTable, DOCUMENT: IconScript, DRAWING: IconDraw, SKETCH: IconDraw, ALIAS: IconBoard, COMMENT: IconComment, SCRIPT: IconScript } as const;

/** Opens the board holding an element, selects it and scrolls it into view. */
export function reveal(element: ZElement) {
  const { elements } = useStore.getState();
  if (element.type === 'BOARD' && element.id !== HOME_ID) {
    actions.openBoard(element.id);
    return;
  }
  const board = containingBoard(elements, element.id);
  if (!board) return;
  if (useStore.getState().boardId !== board) actions.openBoard(board);
  if (element.section === 'INBOX') {
    if (useStore.getState().panel !== 'inbox') actions.setPanel('inbox');
  } else {
    const anchor = elements[element.parentId ?? '']?.type === 'COLUMN' ? elements[element.parentId!] : element;
    centreOn(anchor.x + anchor.width / 2, anchor.y);
  }
  actions.select([element.id]);
}

function snippet(text: string, query: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!query) return flat.slice(0, 90);
  const i = flat.toLowerCase().indexOf(query.toLowerCase());
  const from = Math.max(0, i - 30);
  const part = flat.slice(from, from + 100);
  const j = part.toLowerCase().indexOf(query.toLowerCase());
  if (j < 0) return part;
  return (
    <>
      {from > 0 && '…'}
      {part.slice(0, j)}
      <mark>{part.slice(j, j + query.length)}</mark>
      {part.slice(j + query.length)}
    </>
  );
}

export function SearchPanel() {
  const elements = useStore((s) => s.elements);
  const viewedAt = useStore((s) => s.viewedAt);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('viewed');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const live = Object.values(elements).filter((e) => e.section !== 'TRASH' && e.id !== HOME_ID && e.type !== 'LABEL' && !isInTrash(elements, e));
    // Items match by their text or by the names of their labels.
    const labelText = (e: ZElement) => (e.labels ?? []).map((id) => (elements[id]?.type === 'LABEL' ? (elements[id] as { name: string }).name : '')).join(' ');
    const found = q ? live.filter((e) => `${elementText(e)} ${labelText(e)}`.toLowerCase().includes(q)) : live.filter((e) => e.type === 'BOARD');
    const key = (e: ZElement) => (sort === 'viewed' ? (viewedAt[e.type === 'BOARD' ? e.id : (containingBoard(elements, e.id) ?? '')] ?? 0) : e.updatedAt);
    return found.sort((a, b) => key(b) - key(a) || b.updatedAt - a.updatedAt).slice(0, 60);
  }, [elements, query, sort, viewedAt]);

  const open = (e: ZElement) => {
    actions.setPanel('search');
    reveal(e);
  };

  return (
    <div className="search-backdrop" onPointerDown={() => actions.setPanel('search')}>
      <div className="search-panel panel" role="dialog" aria-label="Поиск" onPointerDown={(e) => e.stopPropagation()}>
        <div className="search-field">
          <IconSearch size={18} />
          <label className="sr-only" htmlFor="search-input">Поиск по всем доскам</label>
          <input
            id="search-input"
            ref={input}
            value={query}
            placeholder="Поиск по всем доскам"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') actions.setPanel('search');
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === 'Enter' && results[active]) open(results[active]);
            }}
          />
        </div>
        <div className="search-sort">
          {query.trim() ? `Найдено: ${results.length}` : 'Недавние доски'}
          <button type="button" className="link-btn" onClick={() => setSort(sort === 'viewed' ? 'modified' : 'viewed')}>
            {sort === 'viewed' ? 'по просмотру' : 'по изменению'}
          </button>
        </div>
        <ul className="search-results" role="listbox" aria-label="Результаты">
          {results.map((e, i) => {
            const Icon = ICONS[e.type];
            const board = e.type === 'BOARD' ? e.parentId : containingBoard(elements, e.id);
            const path = board ? boardPath(elements, board).map((b) => b.title).join(' / ') : '';
            return (
              <li key={e.id} role="option" aria-selected={i === active}>
                <button type="button" className={`search-item${i === active ? ' on' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => open(e)}>
                  <Icon size={18} />
                  <span className="search-text">
                    <span className="search-main">{snippet(elementText(e) || e.type, query.trim())}</span>
                    <span className="search-path">{path}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {results.length === 0 && <li className="col-empty">Ничего не найдено</li>}
        </ul>
      </div>
    </div>
  );
}

function isInTrash(elements: Record<string, ZElement>, e: ZElement): boolean {
  let parent = e.parentId ? elements[e.parentId] : undefined;
  while (parent) {
    if (parent.section === 'TRASH') return true;
    parent = parent.parentId ? elements[parent.parentId] : undefined;
  }
  return false;
}

