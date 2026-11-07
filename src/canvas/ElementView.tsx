import { useLayoutEffect, useRef, useState } from 'react';
import { actions, useStore } from '../model/store';
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
import { LabelChips, openLabelPicker } from '../ui/Labels';

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
  }
  if (!many && ['CARD', 'COLUMN', 'TASK_LIST', 'LINK'].includes(element.type)) {
    items.push({ label: element.type === 'COLUMN' ? 'Переименовать' : element.type === 'LINK' ? 'Изменить ссылку' : 'Редактировать', hint: '↵', run: () => actions.setEditing(element.id) });
  }
  if (!many && element.type === 'COLOR_SWATCH') {
    items.push({ label: 'Изменить цвет', hint: 'двойной клик', run: () => document.querySelector<HTMLInputElement>(`[data-element-id="${element.id}"] input[type="color"]`)?.click() });
    for (const [display, label] of [['hex', 'HEX'], ['rgb', 'RGB'], ['hsl', 'HSL'], ['none', 'Без подписи']] as const) {
      items.push({ label: `${element.display === display ? '● ' : ''}Показывать: ${label}`, run: () => actions.update(element.id, { display }) });
    }
  }
  if (!many && element.type === 'IMAGE') {
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
  const dropActive = useDrag((s) => s.drop?.kind === 'board' && s.drop.id === element.id);
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
    const state = useStore.getState();
    if (state.editingId === element.id && !readOnly) return; // the editor handles its own pointer
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
      if (!readOnly && wasSoleSelection && (element.type === 'CARD' || element.type === 'TASK_LIST') && !element.locked) actions.setEditing(element.id);
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
    if (readOnly) return;
    const { selection } = useStore.getState();
    const ids = selection.includes(element.id) ? selection : [element.id];
    if (!selection.includes(element.id)) actions.select(ids);
    openMenu(e.clientX, e.clientY, elementMenu(element, ids, mode, { x: e.clientX, y: e.clientY }));
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (readOnly) return;
    if (element.type === 'BOARD') actions.openBoard(element.id);
    else if (element.type === 'LINK' && element.url && !e.altKey) void media().then((m) => m.openUrl(element.url));
    else if (!element.locked && !['COLUMN', 'FILE', 'COLOR_SWATCH'].includes(element.type)) actions.setEditing(element.id);
  };

  const offset = drag ? `translate(${drag.dx / scale}px, ${drag.dy / scale}px)` : '';
  const style: React.CSSProperties =
    mode === 'canvas'
      ? { transform: `translate(${element.x * GRID}px, ${element.y * GRID}px) ${offset}`, width: (liveWidth ?? element.width) * GRID, zIndex: editing ? 99999 : element.z }
      : { position: 'relative', transform: offset || undefined, zIndex: drag || editing ? 10 : undefined };
  const resizable = mode === 'canvas' && element.type !== 'BOARD' && selected && !element.locked && !drag && !readOnly;
  const soleSelected = useStore((s) => s.selection.length === 1 && s.selection[0] === element.id);
  const lineHandle = mode === 'canvas' && soleSelected && !drag && !readOnly && !editing;

  return (
    <div
      ref={ref}
      className={`el${drag ? ' dragging' : ''}${mode === 'list' ? ' in-list' : ''}`}
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
      {element.labels && element.labels.length > 0 && <LabelChips ids={element.labels} />}
      {resizable && <span className="resize" role="presentation" onPointerDown={onResizeDown} />}
      {lineHandle && <span className="line-from" title="Потяните, чтобы провести линию" role="presentation" onPointerDown={(e) => startLineFrom(element.id, e)} />}
    </div>
  );
}
