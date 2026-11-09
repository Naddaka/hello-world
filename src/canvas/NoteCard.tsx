import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor, type UseEditorOptions } from '@tiptap/react';
import { generateHTML, type JSONContent } from '@tiptap/core';
import { noteExtensions } from '../editor/extensions';
import { FormatBar } from '../editor/FormatBar';
import { actions, boardPath, containingBoard, onFlushEditors, syncPeers, useStore } from '../model/store';
import { openMenu } from '../ui/ContextMenu';
import { reveal } from '../ui/SearchPanel';
import { GRID, type CardElement } from '../model/types';
import { sizes } from './runtime';

const staticExtensions = noteExtensions();

function isEmptyDoc(doc: JSONContent): boolean {
  const walk = (node: JSONContent): boolean => {
    if (node.type === 'text') return !(node.text ?? '').trim();
    if (node.type && !['doc', 'paragraph'].includes(node.type)) return false;
    return (node.content ?? []).every(walk);
  };
  return walk(doc);
}

/** Flips the n-th task checkbox in a document (used to tick tasks without entering edit mode). */
function toggleTask(doc: JSONContent, index: number): JSONContent {
  let i = 0;
  const visit = (node: JSONContent): JSONContent => {
    if (node.type === 'taskItem') {
      const mine = i++ === index;
      const content = node.content?.map(visit);
      return { ...node, attrs: { ...node.attrs, checked: mine ? !node.attrs?.checked : node.attrs?.checked }, ...(content ? { content } : {}) };
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node;
  };
  return visit(doc);
}

const StaticNote = memo(function StaticNote({ element }: { element: CardElement }) {
  const html = useMemo(() => {
    try {
      return generateHTML(element.content, staticExtensions);
    } catch {
      return '';
    }
  }, [element.content]);
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      e.preventDefault();
      const boxes = [...e.currentTarget.querySelectorAll('input[type="checkbox"]')];
      actions.update(element.id, { content: toggleTask(element.content, boxes.indexOf(target)) });
    } else if (target.closest('a')) {
      e.preventDefault();
    }
  };
  return <div className="rt" onClick={onClick} onPointerDown={(e) => { if ((e.target as HTMLElement).matches('input[type="checkbox"]')) e.stopPropagation(); }} dangerouslySetInnerHTML={{ __html: html || '<p></p>' }} />;
});

function NoteEditor({ element, zoom }: { element: CardElement; zoom: number }) {
  const startContent = useRef(element.content);
  const latest = useRef(element.content);
  const empty = useRef(isEmptyDoc(element.content));
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef(element);
  current.current = element;

  // The options object must stay the same across renders: TipTap compares it by
  // reference and otherwise calls setOptions → updateState on every render, which
  // can overwrite characters the browser has inserted but ProseMirror not yet read.
  const options = useMemo<UseEditorOptions>(
    () => ({
      extensions: noteExtensions('Начните писать…'),
      content: current.current.content,
      immediatelyRender: true,
      editorProps: {
        attributes: { class: 'rt', 'aria-label': 'Текст заметки' },
        handleKeyDown: (_view, event) => {
          if (event.key === 'Escape') {
            actions.setEditing(null);
            return true;
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            // ⌘Enter: next note right below this one, like in the reference app.
            const el = current.current;
            const h = sizes.get(el.id)?.h ?? 120;
            actions.createCard(el.parentId!, el.x, el.y + Math.ceil(h / GRID) + 2, { width: el.width });
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: e }) => {
        latest.current = e.getJSON();
        empty.current = e.isEmpty;
        if (liveTimer.current) clearTimeout(liveTimer.current);
        liveTimer.current = setTimeout(() => actions.setContentLive(current.current.id, latest.current), 400);
      },
    }),
    [],
  );
  const editor = useEditor(options);

  // Focus synchronously on mount. TipTap's focus command waits for the next
  // animation frame, and keys typed right after a double-click would be lost.
  useLayoutEffect(() => {
    if (!editor) return;
    editor.commands.setTextSelection(editor.state.doc.content.size);
    editor.view.focus();
  }, [editor]);

  // Hand over the latest text at once when the app is closing.
  useEffect(
    () =>
      onFlushEditors(() => {
        if (!liveTimer.current) return;
        clearTimeout(liveTimer.current);
        liveTimer.current = null;
        actions.setContentLive(current.current.id, latest.current);
      }),
    [],
  );

  useEffect(() => {
    const id = element.id;
    return () => {
      if (liveTimer.current) clearTimeout(liveTimer.current);
      if (!useStore.getState().elements[id]) return;
      if (empty.current) {
        actions.discardEmptyCard(id);
        return;
      }
      actions.setContentLive(id, latest.current);
      actions.recordContentEdit(id, startContent.current, latest.current);
    };
  }, [element.id]);

  if (!editor) return null;
  return (
    <>
      <FormatBar editor={editor} cardId={element.id} color={element.color} zoom={zoom} />
      <EditorContent editor={editor} />
    </>
  );
}

function SyncFooter({ element }: { element: CardElement }) {
  // Select a string, not a fresh array: a new array every time would re-render forever.
  const key = useStore((s) => (element.syncGroup ? syncPeers(s.elements, element.id).join(',') : ''));
  const peers = key ? key.split(',') : [];
  if (peers.length < 2) return null;
  const showWhere = (e: React.MouseEvent) => {
    e.stopPropagation();
    const elements = useStore.getState().elements;
    openMenu(
      e.clientX,
      e.clientY,
      peers
        .filter((id) => id !== element.id)
        .map((id) => {
          const board = containingBoard(elements, id);
          const path = board ? boardPath(elements, board).map((b) => b.title).join(' / ') : '';
          return { label: `Копия: ${path}`, run: () => reveal(elements[id]) };
        }),
    );
  };
  return (
    <button type="button" className="sync-footer" onPointerDown={(e) => e.stopPropagation()} onClick={showWhere} title="Правка меняет все копии. Где они?">
      ⟳ Синхронизировано · {peers.length} {peers.length < 5 ? 'копии' : 'копий'}
    </button>
  );
}

export function NoteCard({ element, selected, editing, zoom }: { element: CardElement; selected: boolean; editing: boolean; zoom: number }) {
  const cls = ['note', selected && 'selected', editing && 'editing', element.color === 'transparent' && 'transparent', element.locked && 'locked']
    .filter(Boolean)
    .join(' ');
  const background = element.color === 'transparent' ? undefined : `var(--card-${element.color})`;
  return (
    <div className={cls} style={{ background }}>
      {editing ? <NoteEditor element={element} zoom={zoom} /> : <StaticNote element={element} />}
      {element.syncGroup && <SyncFooter element={element} />}
    </div>
  );
}
