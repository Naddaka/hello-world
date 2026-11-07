import { useState, type ComponentType } from 'react';
import { actions, useStore } from '../model/store';
import { DEFAULT_WIDTH, GRID } from '../model/types';
import { isOverViewport, screenToCanvas, viewportCentreGrid } from '../canvas/runtime';
import {
  IconBoard,
  IconColumn,
  IconDraw,
  IconLine,
  IconLink,
  IconMedia,
  IconNote,
  IconScript,
  IconTable,
  IconTasks,
  IconTrash,
} from './icons';

type Kind = 'CARD' | 'BOARD';

interface Tool {
  label: string;
  Icon: ComponentType<{ size?: number }>;
  kind?: Kind;
  /** Delivery stage for tools that are not built yet. */
  soon?: string;
}

const TOOLS: Tool[] = [
  { label: 'Заметка', Icon: IconNote, kind: 'CARD' },
  { label: 'Доска', Icon: IconBoard, kind: 'BOARD' },
  { label: 'Колонка', Icon: IconColumn, soon: 'этап 1' },
  { label: 'Задачи', Icon: IconTasks, soon: 'этап 1' },
  { label: 'Ссылка', Icon: IconLink, soon: 'этап 1' },
  { label: 'Медиа', Icon: IconMedia, soon: 'этап 1' },
  { label: 'Таблица', Icon: IconTable, soon: 'этап 2' },
  { label: 'Сценарий', Icon: IconScript, soon: 'этап 4' },
  { label: 'Линия', Icon: IconLine, soon: 'этап 1' },
  { label: 'Рисовать', Icon: IconDraw, soon: 'этап 2' },
];

function create(kind: Kind, gx: number, gy: number) {
  const boardId = useStore.getState().boardId;
  if (kind === 'CARD') actions.createCard(boardId, gx, gy);
  else actions.createBoard(boardId, gx, gy);
}

/** Drag a tool onto the canvas to place it, or click to add it in the middle of the view. */
export function Toolbar() {
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);

  const onPointerDown = (e: React.PointerEvent, tool: Tool) => {
    if (!tool.kind || e.button !== 0) return;
    e.preventDefault();
    const kind = tool.kind;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      moved = true;
      setGhost({ x: ev.clientX, y: ev.clientY, label: tool.label });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setGhost(null);
      const halfWidth = DEFAULT_WIDTH[kind] / 2;
      if (!moved) {
        const c = viewportCentreGrid();
        create(kind, c.x - halfWidth, c.y - 6);
      } else if (isOverViewport(ev.clientX, ev.clientY) && !(document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('.toolbar')) {
        const p = screenToCanvas(ev.clientX, ev.clientY);
        create(kind, p.x / GRID - halfWidth, p.y / GRID - 3);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      <nav className="toolbar panel" aria-label="Добавить на доску" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {TOOLS.map((tool) => (
          <button
            key={tool.label}
            type="button"
            className="tool"
            disabled={!tool.kind}
            title={tool.soon ? `${tool.label} — появится, ${tool.soon}` : `${tool.label}: перетащите на доску или нажмите`}
            onPointerDown={(e) => onPointerDown(e, tool)}
          >
            <tool.Icon size={20} />
            {tool.label}
          </button>
        ))}
        <div className="tool-sep" aria-hidden="true" />
        <button type="button" className="tool" disabled title="Корзина — появится, этап 1">
          <IconTrash size={20} />
          Корзина
        </button>
      </nav>
      {ghost && <div className="ghost" style={{ left: ghost.x, top: ghost.y }}>{ghost.label}</div>}
    </>
  );
}
