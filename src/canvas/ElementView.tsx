import { useLayoutEffect, useRef, useState } from 'react';
import { actions, countChildren, useStore } from '../model/store';
import { GRID, type ZElement } from '../model/types';
import { BoardTile } from './BoardTile';
import { NoteCard } from './NoteCard';
import { ColumnView } from './ColumnView';
import { TaskListCard } from './TaskListCard';
import { FileCard, ImageCard, LinkCard } from './MediaCards';
import { media } from '../storage/media';
import { loadLinkPreview } from '../model/importing';
import { currentCamera, setSize, sizes } from './runtime';
import { startElementDrag, useDrag } from './dnd';
import { openMenu, type MenuEntry } from '../ui/ContextMenu';
import { copySelection } from '../ui/clipboard';
import { startLineFrom } from './LinesLayer';
import { SwatchCard } from './SwatchCard';
import { TableCard } from '../table/TableCard';
import { convertNoteToDocument, DocumentTile, exportDocument, openDocument } from '../doc/DocumentView';
import { LabelChips, openLabelPicker } from '../ui/Labels';
import { DrawingView } from '../draw/BoardDraw';
import { ASPECTS, openSketchEditor, SketchCard } from '../draw/SketchEditor';
import { focusOn, usePresent } from '../ui/Presentation';
import { CommentCard, CommentMarkers } from './Comments';
import { ScriptTile, openScript, scenesToBoard } from '../script/ScriptEditor';
import { exportScript } from '../script/print';
import { descendants } from '../model/store';

/**
 * Where an element is drawn: absolutely positioned on the canvas, or in the
 * flow of a list (a column, the Unsorted panel, the trash).
 */
export type ViewMode = 'canvas' | 'list';

function elementMenu(element: ZElement, ids: string[], mode: ViewMode, at: { x: number; y: number }): MenuEntry[] {
  const { elements, boardId } = useStore.getState();
  const many = ids.length > 1;
  const items: MenuEntry[] = [];
  if (!many && element.type === 'BOARD') {
    items.push({ label: 'Открыть', hint: '↵', run: () => actions.openBoard(element.id) });
    items.push({ label: 'Переименовать', run: () => actions.setEditing(element.id) });
    items.push({ label: 'Создать ярлык на доску', run: () => actions.createAlias(element.id, element.parentId ?? boardId, element.x + 16, element.y) });
    items.push(element.isTemplate ? { label: 'Вернуть шаблон в доску', run: () => actions.setTemplate(element.id, false) } : { label: 'Сделать шаблоном', run: () => actions.setTemplate(element.id, true) });
  }
  if (!many && element.type === 'ALIAS') {
    const target = elements[element.targetId];
    items.push({ label: 'Открыть доску', hint: '↵', disabled: target?.type !== 'BOARD', run: () => actions.openBoard(element.targetId) });
    if (target?.type === 'BOARD') {
      items.push({
        label: 'Дублировать доску, на которую ведёт ярлык',
        run: () => actions.paste([target], [target, ...descendants(elements, target.id).map((id) => elements[id])], { x: element.x + 16, y: element.y }),
      });
    }
  }
  if (!many && element.type === 'CARD') {
    items.push({ label: 'Создать синхронную копию', run: () => actions.createSyncedCopy(element.id) });
    if (element.syncGroup) items.push({ label: 'Отвязать от копий', run: () => actions.unsync(element.id) });
  }
  if (!many && ['CARD', 'COLUMN', 'TASK_LIST', 'LINK'].includes(element.type)) {
    items.push({ label: element.type === 'COLUMN' ? 'Переименовать' : element.type === 'LINK' ? 'Изменить ссылку' : 'Редактировать', hint: '↵', run: () => actions.setEditing(element.id) });
  }
  if (!many && element.type === 'CARD') items.push({ label: 'Преобразовать в документ', run: () => convertNoteToDocument(element) });
  if (!many && element.type === 'DOCUMENT') {
    items.push(
      { label: 'Открыть', hint: '↵', run: () => openDocument(element.id) },
      { label: element.preview ? 'Показывать значком' : 'Показывать начало текста', run: () => actions.update(element.id, { preview: !element.preview }) },
      { label: 'Экспорт в PDF', run: () => void exportDocument(element, 'pdf') },
      { label: 'Экспорт в Word', run: () => void exportDocument(element, 'doc') },
      { label: 'Экспорт в Markdown', run: () => void exportDocument(element, 'md') },
    );
  }
  if (!many && element.type === 'SCRIPT') {
    items.push(
      { label: 'Открыть', hint: '↵', run: () => openScript(element.id) },
      { label: 'Сцены на доску', run: () => (scenesToBoard(element) ? undefined : actions.showToast('В сценарии пока нет сцен')) },
      { label: 'Экспорт в PDF', run: () => void exportScript(element, 'pdf') },
      { label: 'Экспорт в Final Draft (.fdx)', run: () => void exportScript(element, 'fdx') },
      { label: 'Экспорт в Fountain', run: () => void exportScript(element, 'fountain') },
    );
  }
  if (!many && element.type === 'TABLE') items.push({ label: 'Редактировать таблицу', hint: '↵', run: () => actions.setEditing(element.id) });
  if (!many && element.type === 'COLOR_SWATCH') {
    items.push({ label: 'Изменить цвет', hint: 'двойной клик', run: () => document.querySelector<HTMLInputElement>(`[data-element-id="${element.id}"] input[type="color"]`)?.click() });
    for (const [display, label] of [['hex', 'HEX'], ['rgb', 'RGB'], ['hsl', 'HSL'], ['none', 'Без подписи']] as const) {
      items.push({ label: `${element.display === display ? '● ' : ''}Показывать: ${label}`, run: () => actions.update(element.id, { display }) });
    }
  }
  if (!many && element.type === 'SKETCH') {
    items.push({ label: 'Рисовать', hint: 'двойной клик', run: () => openSketchEditor(element.id) });
    for (const a of ASPECTS) items.push({ label: `${Math.abs(element.aspect - a.value) < 0.01 ? '● ' : ''}Формат ${a.label}`, run: () => actions.update(element.id, { aspect: a.value }) });
  }
  if (!many && element.type === 'IMAGE') {
    items.push({ label: 'Рисовать на изображении', run: () => openSketchEditor(element.id) });
    if (element.annotations?.length) items.push({ label: 'Убрать рисунок', run: () => actions.update(element.id, { annotations: [] }) });
    items.push({ label: element.showCaption ? 'Скрыть подпись' : 'Подпись', run: () => (element.showCaption ? actions.update(element.id, { showCaption: false }) : actions.setEditing(element.id)) });
    items.push({ label: 'Открыть файл', run: async () => (await media()).openMedia(element.media) });
    items.push({ label: 'Показать в Finder', run: async () => (await media()).revealMedia(element.media) });
  }
  if (!many && element.type === 'FILE' && /^(video|audio)\//.test(element.mime)) {
    items.push({ label: element.autoplay ? 'Выключить автозапуск' : 'Автозапуск', run: () => actions.update(element.id, { autoplay: !element.autoplay }) });
    items.push({ label: element.loop ? 'Выключить повтор' : 'Повтор', run: () => actions.update(element.id, { loop: !element.loop }) });
  }
  if (!many && element.type === 'LINK' && element.url) {
    items.push(
      { label: 'Открыть в браузере', run: async () => (await media()).openUrl(element.url) },
      { label: element.showImage ? 'Скрыть картинку' : 'Показать картинку', run: () => actions.update(element.id, { showImage: !element.showImage }) },
      { label: element.showDescription ? 'Скрыть описание' : 'Показать описание', run: () => actions.update(element.id, { showDescription: !element.showDescription }) },
      { label: 'Обновить превью', run: () => void loadLinkPreview(element.id, element.url) },
    );
  }
  items.push({ label: 'Метки…', run: () => openLabelPicker(at.x, at.y, ids) });
  items.push(
    { label: 'Копировать', hint: '⌘C', run: () => copySelection(false) },
    { label: 'Вырезать', hint: '⌘X', run: () => copySelection(true) },
    { label: 'Дублировать', hint: '⌥ + перетащить', run: () => actions.duplicate(ids) },
  );
  const groupable = ids.filter((id) => elements[id] && elements[id].type !== 'COLUMN' && elements[id].parentId === boardId);
  if (groupable.length > 0 && mode === 'canvas') items.push({ label: 'Сгруппировать в колонку', run: () => actions.groupIntoColumn(groupable) });
  items.push({ label: 'В «Неразобранное»', run: () => actions.moveToInbox(ids, boardId) });
  if (mode === 'canvas') {
    items.push(
      'sep',
      { label: 'На передний план', hint: '⌘⇧↑', run: () => actions.bringToFront() },
      { label: 'На задний план', hint: '⌘⇧↓', run: () => actions.sendToBack() },
      element.locked ? { label: 'Открепить', run: () => actions.setLocked(ids, false) } : { label: 'Закрепить на месте', run: () => actions.setLocked(ids, true) },
    );
  }
  items.push('sep', { label: 'Удалить', danger: true, disabled: Boolean(element.locked), run: () => actions.trash(ids) });
  return items;
}

export function ElementView({
  element,
  count = 0,
  mode = 'canvas',
  readOnly = false,
  inLayer = mode === 'canvas',
}: {
  element: ZElement;
  count?: number;
  mode?: ViewMode;
  readOnly?: boolean;
  /** True when drawn inside the zoomed canvas layer (also for items in a column). */
  inLayer?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const selected = useStore((s) => s.selection.includes(element.id));
  const editing = useStore((s) => s.editingId === element.id) && !readOnly;
  const zoom = useStore((s) => (s.cameras[s.boardId] ?? currentCamera()).zoom);
  const drag = useDrag((s) => (s.ids.includes(element.id) ? s : null));
  const dropActive = useDrag((s) => s.drop?.kind === 'board' && s.drop.id === (element.type === 'ALIAS' ? element.targetId : element.id));
  const attachTarget = useDrag((s) => s.drop?.kind === 'attach' && s.drop.id === element.id);
  const aliasTarget = useStore((s) => (element.type === 'ALIAS' ? s.elements[element.targetId] : undefined));
  const aliasCount = useStore((s) => (element.type === 'ALIAS' && aliasTarget ? countChildren(s.elements, element.targetId) : 0));
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  // Elements inside the canvas layer are scaled by the zoom; panels are not.
  const scale = inLayer ? zoom : 1;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || mode !== 'canvas') return;
    const measure = () => setSize(element.id, node.offsetWidth, node.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => {
      ro.disconnect();
      sizes.delete(element.id);
    };
  }, [element.id, mode]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const present = usePresent.getState();
    if (present.active) {
      // Presenting: a click can enlarge the card; editing is optional.
      if (present.focusOnClick) focusOn(element.id);
      if (present.preventEdit) {
        e.stopPropagation();
        return;
      }
    }
    const state = useStore.getState();
    if (state.editingId === element.id && !readOnly) {
      // The editor handles its own pointer; the canvas must not end editing on this click.
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    if (e.shiftKey || e.metaKey) {
      actions.toggleSelect(element.id);
      return;
    }
    const wasSoleSelection = state.selection.length === 1 && state.selection[0] === element.id;
    let ids = state.selection;
    if (!ids.includes(element.id)) {
      ids = [element.id];
      actions.select(ids);
    } else if (state.editingId) {
      actions.setEditing(null);
    }
    startElementDrag(e, ids, () => {
      // A second click on a selected note or task list starts editing it.
      if (!readOnly && wasSoleSelection && (element.type === 'CARD' || element.type === 'TASK_LIST' || element.type === 'TABLE') && !element.locked) actions.setEditing(element.id);
    });
  };

  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = element.width;
    let w = startW;
    const onMove = (ev: PointerEvent) => {
      w = Math.max(12, Math.round(startW + (ev.clientX - startX) / scale / GRID));
      setLiveWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLiveWidth(null);
      actions.resize(element.id, w);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (readOnly || (usePresent.getState().active && usePresent.getState().preventEdit)) return;
    const { selection } = useStore.getState();
    const ids = selection.includes(element.id) ? selection : [element.id];
    if (!selection.includes(element.id)) actions.select(ids);
    openMenu(e.clientX, e.clientY, elementMenu(element, ids, mode, { x: e.clientX, y: e.clientY }));
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (readOnly) return;
    if (element.type === 'BOARD') actions.openBoard(element.id);
    else if (element.type === 'ALIAS') actions.openBoard(element.targetId);
    else if (usePresent.getState().active && usePresent.getState().preventEdit) return;
    else if (element.type === 'SKETCH') openSketchEditor(element.id);
    else if (element.type === 'DOCUMENT') openDocument(element.id);
    else if (element.type === 'SCRIPT') openScript(element.id);
    else if (element.type === 'LINK' && element.url && !e.altKey) void media().then((m) => m.openUrl(element.url));
    else if (!element.locked && !['COLUMN', 'FILE', 'COLOR_SWATCH'].includes(element.type)) actions.setEditing(element.id);
  };

  const offset = drag ? `translate(${drag.dx / scale}px, ${drag.dy / scale}px)` : '';
  const style: React.CSSProperties =
    mode === 'canvas'
      ? { transform: `translate(${element.x * GRID}px, ${element.y * GRID}px) ${offset}`, width: (liveWidth ?? element.width) * GRID, zIndex: editing ? 99999 : element.z }
      : { position: 'relative', transform: offset || undefined, zIndex: drag || editing ? 10 : undefined };
  const resizable = mode === 'canvas' && !['BOARD', 'TABLE', 'DOCUMENT', 'DRAWING', 'SCRIPT'].includes(element.type) && selected && !element.locked && !drag && !readOnly;
  const soleSelected = useStore((s) => s.selection.length === 1 && s.selection[0] === element.id);
  const lineHandle = mode === 'canvas' && soleSelected && !drag && !readOnly && !editing;

  return (
    <div
      ref={ref}
      className={`el${drag ? ' dragging' : ''}${mode === 'list' ? ' in-list' : ''}${attachTarget ? ' attach-target' : ''}`}
      data-element-id={element.id}
      data-col-item={mode === 'list' ? element.id : undefined}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {element.type === 'CARD' && <NoteCard element={element} selected={selected} editing={editing} zoom={scale} />}
      {element.type === 'BOARD' && <BoardTile element={element} selected={selected} editing={editing} dropActive={dropActive} count={count} compact={mode === 'list'} />}
      {element.type === 'COLUMN' && <ColumnView element={element} selected={selected} editing={editing} />}
      {element.type === 'TASK_LIST' && <TaskListCard element={element} selected={selected} editing={editing} />}
      {element.type === 'IMAGE' && <ImageCard element={element} selected={selected} editing={editing} />}
      {element.type === 'FILE' && <FileCard element={element} selected={selected} />}
      {element.type === 'LINK' && <LinkCard element={element} selected={selected} editing={editing} />}
      {element.type === 'COLOR_SWATCH' && <SwatchCard element={element} selected={selected} />}
      {element.type === 'TABLE' && <TableCard element={element} selected={selected} editing={editing} />}
      {element.type === 'DOCUMENT' && <DocumentTile element={element} selected={selected} />}
      {element.type === 'SCRIPT' && <ScriptTile element={element} selected={selected} />}
      {element.type === 'DRAWING' && <DrawingView element={element} selected={selected} />}
      {element.type === 'SKETCH' && <SketchCard element={element} selected={selected} />}
      {element.type === 'COMMENT' && <CommentCard element={element} selected={selected} />}
      {element.type === 'ALIAS' &&
        (aliasTarget?.type === 'BOARD' && aliasTarget.section !== 'TRASH' ? (
          <BoardTile element={aliasTarget} selected={selected} editing={false} dropActive={dropActive} count={aliasCount} compact={mode === 'list'} shortcut />
        ) : (
          <div className="tile broken"><div className="tile-icon" /><div className="tile-title">Доска удалена</div></div>
        ))}
      {element.type !== 'COMMENT' && <CommentMarkers elementId={element.id} />}
      {element.labels && element.labels.length > 0 && <LabelChips ids={element.labels} />}
      {resizable && <span className="resize" role="presentation" onPointerDown={onResizeDown} />}
      {lineHandle && <span className="line-from" title="Потяните, чтобы провести линию" role="presentation" onPointerDown={(e) => startLineFrom(element.id, e)} />}
    </div>
  );
}
