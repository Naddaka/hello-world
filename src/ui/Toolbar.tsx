import { useState, type ComponentType } from 'react';
import { actions, useStore } from '../model/store';
import { DEFAULT_WIDTH, GRID } from '../model/types';
import { isOverViewport, screenToCanvas, viewportCentreGrid } from '../canvas/runtime';
import { useDrag } from '../canvas/dnd';
import { addFiles, addLink } from '../model/importing';
import { media } from '../storage/media';
import {
  IconBoard,
  IconColumn,
  IconDraw,
  IconFile,
  IconSketch,
  IconComment,
  IconLine,
  IconLink,
  IconMedia,
  IconNote,
  IconScript,
  IconTable,
  IconTasks,
  IconSwatch,
  IconTrash,
} from './icons';
import { newLine } from '../canvas/LinesLayer';
import { freeSpot } from '../canvas/placement';
import { addSwatch } from '../canvas/SwatchCard';
import { newTableFields, tableWidth } from '../table/TableCard';
import { newDocumentFields, openDocument } from '../doc/DocumentView';
import { startBoardDrawing } from '../draw/BoardDraw';
import { newCommentFields } from '../canvas/Comments';
import { newSketchFields, openSketchEditor } from '../draw/SketchEditor';
import { newScriptFields, openScript } from '../script/ScriptEditor';

type Kind = 'CARD' | 'BOARD' | 'COLUMN' | 'TASK_LIST' | 'LINK' | 'MEDIA' | 'LINE' | 'COLOR_SWATCH' | 'TABLE' | 'DOCUMENT' | 'SCRIPT' | 'SKETCH' | 'DRAW' | 'COMMENT';

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
  { label: 'Колонка', Icon: IconColumn, kind: 'COLUMN' },
  { label: 'Задачи', Icon: IconTasks, kind: 'TASK_LIST' },
  { label: 'Ссылка', Icon: IconLink, kind: 'LINK' },
  { label: 'Медиа', Icon: IconMedia, kind: 'MEDIA' },
  { label: 'Таблица', Icon: IconTable, kind: 'TABLE' },
  { label: 'Документ', Icon: IconFile, kind: 'DOCUMENT' },
  { label: 'Сценарий', Icon: IconScript, kind: 'SCRIPT' },
  { label: 'Линия', Icon: IconLine, kind: 'LINE' },
  { label: 'Цвет', Icon: IconSwatch, kind: 'COLOR_SWATCH' },
  { label: 'Скетч', Icon: IconSketch, kind: 'SKETCH' },
  { label: 'Коммент.', Icon: IconComment, kind: 'COMMENT' },
  { label: 'Рисовать', Icon: IconDraw, kind: 'DRAW' },
];

function create(kind: Kind, gx: number, gy: number, clientX?: number, clientY?: number) {
  const boardId = useStore.getState().boardId;
  // Dropped onto a column: add it there instead of on the canvas.
  const column = clientX !== undefined ? (document.elementFromPoint(clientX, clientY!) as HTMLElement | null)?.closest<HTMLElement>('[data-drop-column]')?.dataset.dropColumn : undefined;
  const parent = column && kind !== 'COLUMN' ? column : boardId;
  if (kind === 'LINK') addLink(null, { x: gx, y: gy }, parent);
  else if (kind === 'LINE') actions.select([actions.insert(newLine({ elementId: null, x: gx, y: gy }, { elementId: null, x: gx + 24, y: gy }), boardId, 0, 0, 0)]);
  else if (kind === 'COLOR_SWATCH') addSwatch({ x: gx, y: gy }, parent);
  else if (kind === 'DRAW') startBoardDrawing();
  else if (kind === 'COMMENT') {
    // A new comment stays open (for a follow-up or a reaction) until the user clicks away.
    const id = actions.insert(newCommentFields(), parent, gx, gy);
    actions.select([id]);
    actions.setEditing(id);
  }
  else if (kind === 'SKETCH') openSketchEditor(actions.insert(newSketchFields(), parent, gx, gy));
  else if (kind === 'TABLE') {
    const fields = newTableFields();
    const id = actions.insert(fields, parent, gx, gy, tableWidth(fields.colWidths));
    actions.setEditing(id);
  } else if (kind === 'DOCUMENT') openDocument(actions.insert(newDocumentFields(), parent, gx, gy));
  else if (kind === 'SCRIPT') openScript(actions.insert(newScriptFields(), parent, gx, gy));
  else if (kind === 'MEDIA') void media().then((m) => m.pickFiles()).then((files) => addFiles(files, { x: gx, y: gy }, parent));
  else actions.create({ type: kind }, parent, gx, gy);
}

function TrashButton() {
  const open = useStore((s) => s.panel === 'trash');
  const over = useDrag((s) => s.drop?.kind === 'trash');
  return (
    <button type="button" className={`tool${open ? ' on' : ''}${over ? ' drop' : ''}`} data-drop-trash title="Корзина: перетащите сюда, чтобы удалить; нажмите, чтобы открыть" aria-pressed={open} onClick={() => actions.setPanel('trash')}>
      <IconTrash size={20} />
      Корзина
    </button>
  );
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
      const halfWidth = (kind === 'MEDIA' ? DEFAULT_WIDTH.IMAGE : kind === 'LINE' || kind === 'DRAW' ? 12 : DEFAULT_WIDTH[kind]) / 2;
      if (!moved) {
        // A click puts it in the middle of the view, next to (not on top of) what is there.
        const c = viewportCentreGrid();
        const spot = kind === 'LINE' || kind === 'DRAW' ? { x: c.x - halfWidth, y: c.y - 6 } : freeSpot(useStore.getState().boardId, c.x - halfWidth, c.y - 6, halfWidth * 2, 14);
        create(kind, spot.x, spot.y);
      } else if (isOverViewport(ev.clientX, ev.clientY) && !(document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('.toolbar')) {
        const p = screenToCanvas(ev.clientX, ev.clientY);
        create(kind, p.x / GRID - halfWidth, p.y / GRID - 3, ev.clientX, ev.clientY);
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
        <TrashButton />
      </nav>
      {ghost && <div className="ghost" style={{ left: ghost.x, top: ghost.y }}>{ghost.label}</div>}
    </>
  );
}
