import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { EditorContent, useEditor, type UseEditorOptions } from '@tiptap/react';
import { generateHTML, type JSONContent } from '@tiptap/core';
import { actions, useStore } from '../model/store';
import { EMPTY_DOC, type CardElement, type DocumentElement } from '../model/types';
import { docText } from '../model/text';
import { noteExtensions } from '../editor/extensions';
import { FormatBar } from '../editor/FormatBar';
import { toMarkdown } from './markdown';
import { fileName, printHtml, saveFile } from '../storage/files';
import { IconScript } from '../ui/icons';

const staticExtensions = noteExtensions();
const words = (doc: JSONContent) => (docText(doc).match(/\S+/g) ?? []).length;

function wordsLabel(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? 'слово' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'слова' : 'слов'}`;
}

function htmlOf(doc: JSONContent) {
  try {
    return generateHTML(doc, staticExtensions);
  } catch {
    return '';
  }
}

/** Board tile of a document: an icon, or the beginning of the text in preview mode. */
export function DocumentTile({ element, selected }: { element: DocumentElement; selected: boolean }) {
  const html = useMemo(() => (element.preview ? htmlOf(element.content) : ''), [element.preview, element.content]);
  if (element.preview) {
    return (
      <div className={`note doc-preview${selected ? ' selected' : ''}`}>
        <div className="doc-preview-title"><IconScript size={14} /> {element.title}</div>
        <div className="rt doc-preview-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }
  return (
    <div className={`tile${selected ? ' selected' : ''}`}>
      <div className="tile-icon doc-icon">
        <IconScript size={38} strokeWidth={1.5} />
      </div>
      <div className="tile-title">{element.title}</div>
      <div className="tile-meta">{wordsLabel(words(element.content))}</div>
    </div>
  );
}

/** Which document is open full screen. */
export const useOpenDocument = create<{ id: string | null }>(() => ({ id: null }));
export const openDocument = (id: string) => useOpenDocument.setState({ id });

/** Exports a document in one of the supported formats. */
export async function exportDocument(element: DocumentElement, format: 'md' | 'txt' | 'doc' | 'pdf') {
  const title = element.title || 'Документ';
  if (format === 'md') return saveFile(fileName(title, 'md'), `# ${title}\n\n${toMarkdown(element.content)}`, 'text/markdown', { name: 'Markdown', extensions: ['md'] });
  if (format === 'txt') return saveFile(fileName(title, 'txt'), `${title}\n\n${docText(element.content)}\n`, 'text/plain', { name: 'Текст', extensions: ['txt'] });
  const body = `<h1>${title.replace(/</g, '&lt;')}</h1>${htmlOf(element.content)}`;
  if (format === 'doc') {
    // Word and Pages open HTML saved with the Word namespaces as a regular document.
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:12pt;line-height:1.5}h1{font-size:20pt}h2{font-size:15pt}mark{background:#ffe58a}</style></head><body>${body}</body></html>`;
    return saveFile(fileName(title, 'doc'), html, 'application/msword', { name: 'Word', extensions: ['doc'] });
  }
  await printHtml(`<article class="print-doc">${body}</article>`, title);
  return true;
}

function DocumentEditor({ element }: { element: DocumentElement }) {
  const [title, setTitle] = useState(element.title);
  const [menu, setMenu] = useState(false);
  const start = useRef({ title: element.title, content: element.content });
  const latest = useRef({ title: element.title, content: element.content });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [count, setCount] = useState(() => words(element.content));

  const options = useMemo<UseEditorOptions>(
    () => ({
      extensions: noteExtensions('Начните писать…'),
      content: element.content,
      immediatelyRender: true,
      editorProps: { attributes: { class: 'rt doc-rt', 'aria-label': 'Текст документа' } },
      onUpdate: ({ editor }) => {
        latest.current = { ...latest.current, content: editor.getJSON() };
        setCount(words(latest.current.content));
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => actions.setLive(element.id, latest.current), 400);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [element.id],
  );
  const editor = useEditor(options);

  useEffect(() => {
    editor?.commands.setTextSelection(editor.state.doc.content.size);
    editor?.view.focus();
    const id = element.id;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (!useStore.getState().elements[id]) return;
      actions.setLive(id, latest.current);
      actions.recordEdit(id, start.current, latest.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const close = () => useOpenDocument.setState({ id: null });
  const current = () => ({ ...element, ...latest.current }) as DocumentElement;

  // Escape closes the document wherever focus is (e.g. after a menu has closed).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (menu) setMenu(false);
        else close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  return (
    <div className="doc-overlay" role="dialog" aria-label={`Документ ${title}`} onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
      <header className="doc-head" data-tauri-drag-region>
        <button type="button" className="link-btn" onClick={close}>← К доске</button>
        <span className="doc-count">{wordsLabel(count)}</span>
        <div style={{ position: 'relative' }}>
          <button type="button" className="btn-accent" aria-expanded={menu} onClick={() => setMenu(!menu)}>Экспорт</button>
          {menu && (
            <div className="popover panel" style={{ left: 'auto', right: 0 }} role="menu">
              {([['pdf', 'PDF (печать)'], ['doc', 'Word'], ['md', 'Markdown'], ['txt', 'Обычный текст']] as const).map(([f, label]) => (
                <button key={f} type="button" role="menuitem" className="menu-item" onClick={() => { setMenu(false); void exportDocument(current(), f); }}>{label}</button>
              ))}
            </div>
          )}
        </div>
      </header>
      <div className="doc-page">
        <label className="sr-only" htmlFor="doc-title">Название документа</label>
        <input
          id="doc-title"
          className="doc-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            latest.current = { ...latest.current, title: e.target.value };
            actions.setLive(element.id, latest.current);
          }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === 'ArrowDown') && editor) {
              e.preventDefault();
              // Synchronous focus: TipTap's focus command waits a frame and would drop keys.
              editor.commands.setTextSelection(1);
              editor.view.focus();
            }
          }}
        />
        {editor && <FormatBar editor={editor} zoom={1} inline />}
        {editor && <EditorContent editor={editor} />}
      </div>
    </div>
  );
}

/** Full-screen editor of the open document, if any. */
export function DocumentOverlay() {
  const id = useOpenDocument((s) => s.id);
  const element = useStore((s) => (id ? s.elements[id] : undefined));
  if (!element || element.type !== 'DOCUMENT') return null;
  return <DocumentEditor key={element.id} element={element} />;
}

/** Turns a long note into a document in place (same position, same content). */
export function convertNoteToDocument(note: CardElement) {
  const first = docText(note.content).split('\n')[0]?.slice(0, 60) || 'Документ';
  const doc: DocumentElement = {
    id: note.id,
    type: 'DOCUMENT',
    parentId: note.parentId,
    section: note.section,
    x: note.x,
    y: note.y,
    width: 14,
    z: note.z,
    labels: note.labels,
    createdAt: note.createdAt,
    updatedAt: Date.now(),
    title: first,
    content: note.content,
    preview: false,
  };
  actions.replace(note, doc);
}

export function newDocumentFields() {
  return { type: 'DOCUMENT' as const, title: 'Новый документ', content: EMPTY_DOC, preview: false };
}
