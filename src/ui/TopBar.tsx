import { actions, boardPath, useStore } from '../model/store';
import { HOME_ID } from '../model/types';
import { useDrag } from '../canvas/dnd';
import { isTauri } from '../storage/repo';
import { startPresenting } from './Presentation';
import { useState } from 'react';
import { exportBoard, type BoardExportFormat } from '../doc/boardExport';
import { openMilanoteImport } from '../import/MilanoteImport';
import { IconBoard, IconHome, IconMoon, IconPresent, IconRedo, IconSearch, IconSun, IconUndo } from './icons';

const macOverlay = isTauri() && /Macintosh/.test(navigator.userAgent);
// Full-window views (documents) also need room for the window buttons.
if (macOverlay) document.documentElement.classList.add('mac-overlay');

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const run = async (format: BoardExportFormat) => {
    setOpen(false);
    try {
      await exportBoard(format);
    } catch (error) {
      actions.showToast(error instanceof Error ? error.message : 'Не удалось экспортировать доску');
    }
  };
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="btn-accent" aria-expanded={open} onClick={() => setOpen(!open)}>
        Экспорт
      </button>
      {open && (
        <div className="popover panel" style={{ left: 'auto', right: 0, zIndex: 30 }} role="menu" onMouseLeave={() => setOpen(false)}>
          {(
            [
              ['pdf', 'PDF (печать)'],
              ['png', 'PNG-изображение'],
              ['doc', 'Word'],
              ['md', 'Markdown'],
              ['txt', 'Обычный текст'],
              ['zip', 'ZIP со всеми файлами'],
            ] as const
          ).map(([f, label]) => (
            <button key={f} type="button" role="menuitem" className="menu-item" onClick={() => void run(f)}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const elements = useStore((s) => s.elements);
  const boardId = useStore((s) => s.boardId);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const theme = useStore((s) => s.theme);
  const dropTarget = useDrag((s) => (s.drop?.kind === 'board' ? s.drop.id : null));
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
      <button type="button" className="search" onClick={() => actions.setPanel('search')}>
        <IconSearch size={15} />
        <span style={{ flex: '1 1 auto', textAlign: 'left' }}>Поиск по всем доскам</span>
        <span className="kbd">⌘F</span>
      </button>
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
        <button type="button" className="ibtn" aria-label="Режим презентации" title="Режим презентации" onClick={startPresenting}>
          <IconPresent size={17} />
        </button>
      </div>
      <button type="button" className="ibtn wide" title="Импорт из Milanote" onClick={openMilanoteImport}>
        Импорт
      </button>
      <ExportMenu />
    </header>
  );
}
