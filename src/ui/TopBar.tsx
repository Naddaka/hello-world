import { actions, boardPath, useStore } from '../model/store';
import { HOME_ID } from '../model/types';
import { useDrag } from '../canvas/runtime';
import { isTauri } from '../storage/repo';
import { IconBoard, IconHome, IconMoon, IconPresent, IconRedo, IconSearch, IconSun, IconUndo } from './icons';

const macOverlay = isTauri() && /Macintosh/.test(navigator.userAgent);

export function TopBar() {
  const elements = useStore((s) => s.elements);
  const boardId = useStore((s) => s.boardId);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const theme = useStore((s) => s.theme);
  const dropTarget = useDrag((s) => s.dropTarget);
  const path = boardPath(elements, boardId);

  return (
    <header className={`topbar${macOverlay ? ' mac-overlay' : ''}`} data-tauri-drag-region>
      <nav className="crumbs" aria-label="Путь к доске" data-tauri-drag-region>
        {path.map((board, i) => {
          const current = i === path.length - 1;
          return (
            <span key={board.id} style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
              {i > 0 && <span className="crumb-sep" aria-hidden="true">/</span>}
              <button
                type="button"
                className={`crumb${current ? ' current' : ''}${dropTarget === board.id ? ' drop' : ''}`}
                data-crumb-board={board.id}
                aria-current={current ? 'page' : undefined}
                onClick={() => !current && actions.openBoard(board.id)}
              >
                {board.id === HOME_ID ? (
                  <IconHome size={14} />
                ) : current ? (
                  <span className="crumb-badge" style={{ background: `var(--board-${board.color}-fg)`, color: 'var(--app)' }}>
                    <IconBoard size={11} strokeWidth={2.4} />
                  </span>
                ) : null}
                {board.title}
              </button>
            </span>
          );
        })}
      </nav>
      <div className="spacer" data-tauri-drag-region />
      <label className="search" title="Поиск появится на этапе 1">
        <IconSearch size={15} />
        <span className="sr-only">Поиск по доскам</span>
        <input type="search" placeholder="Поиск по всем доскам" disabled />
        <span className="kbd">⌘F</span>
      </label>
      <div style={{ display: 'flex', gap: 2 }}>
        <button type="button" className="ibtn" aria-label="Отменить (⌘Z)" title="Отменить (⌘Z)" disabled={!canUndo} onClick={() => actions.undo()}>
          <IconUndo size={17} />
        </button>
        <button type="button" className="ibtn" aria-label="Повторить (⌘⇧Z)" title="Повторить (⌘⇧Z)" disabled={!canRedo} onClick={() => actions.redo()}>
          <IconRedo size={17} />
        </button>
        <button type="button" className="ibtn" aria-label="Тёмная тема (⌘⇧D)" title={theme === 'dark' ? 'Светлая тема (⌘⇧D)' : 'Тёмная тема (⌘⇧D)'} onClick={() => actions.toggleTheme()}>
          {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
        </button>
        <button type="button" className="ibtn" aria-label="Режим презентации" title="Режим презентации — появится, этап 2" disabled>
          <IconPresent size={17} />
        </button>
      </div>
      <button type="button" className="btn-accent" disabled title="Экспорт — появится, этап 2">
        Экспорт
      </button>
    </header>
  );
}
