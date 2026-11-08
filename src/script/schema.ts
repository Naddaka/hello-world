import { Extension, Node, mergeAttributes, type Editor, type JSONContent } from '@tiptap/core';
import Text from '@tiptap/extension-text';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { nanoid } from 'nanoid';
import type { ScriptBlock, ScriptBlockType } from '../model/types';
import { looksLikeScene, looksLikeTransition } from './layout';

/**
 * The screenplay editor: a document of lines, each one a paragraph kind
 * (scene heading, action, character…). Keys follow professional screenwriting
 * software: Enter starts the paragraph that usually comes next, Tab changes
 * the kind, ⌘1…⌘8 pick one directly.
 */

export const KIND_LABELS: Record<ScriptBlockType, string> = {
  scene: 'Заголовок сцены',
  action: 'Действие',
  character: 'Персонаж',
  parenthetical: 'Ремарка',
  dialogue: 'Реплика',
  transition: 'Переход',
  shot: 'План',
  centered: 'По центру',
};

export const KIND_ORDER: ScriptBlockType[] = ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'centered'];

const PLACEHOLDERS: Record<ScriptBlockType, string> = {
  scene: 'ИНТ. МЕСТО — ДЕНЬ',
  action: 'Действие…',
  character: 'ИМЯ',
  parenthetical: 'ремарка',
  dialogue: 'Реплика…',
  transition: 'СМЕНА ПЛАНА:',
  shot: 'КРУПНО',
  centered: 'Текст по центру',
};

/** What Enter starts after each kind. */
export const NEXT_ON_ENTER: Record<ScriptBlockType, ScriptBlockType> = {
  scene: 'action',
  action: 'action',
  character: 'dialogue',
  parenthetical: 'dialogue',
  dialogue: 'action',
  transition: 'scene',
  shot: 'action',
  centered: 'action',
};

export const TAB_NEXT: Record<ScriptBlockType, ScriptBlockType> = {
  action: 'character',
  character: 'transition',
  transition: 'action',
  scene: 'action',
  dialogue: 'parenthetical',
  parenthetical: 'dialogue',
  shot: 'action',
  centered: 'action',
};

const TAB_PREV: Record<ScriptBlockType, ScriptBlockType> = {
  action: 'scene',
  character: 'action',
  transition: 'character',
  scene: 'action',
  dialogue: 'character',
  parenthetical: 'dialogue',
  shot: 'action',
  centered: 'action',
};

const ScriptDoc = Node.create({ name: 'doc', topNode: true, content: 'sline+' });

const ScriptLine = Node.create({
  name: 'sline',
  content: 'text*',
  marks: '',
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: 'action',
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute('data-kind') ?? 'action',
        renderHTML: (a) => ({ 'data-kind': a.kind }),
      },
      dual: {
        default: false,
        keepOnSplit: false,
        parseHTML: (el) => el.hasAttribute('data-dual'),
        renderHTML: (a) => (a.dual ? { 'data-dual': '' } : {}),
      },
      bid: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute('data-bid'),
        renderHTML: (a) => (a.bid ? { 'data-bid': a.bid } : {}),
      },
    };
  },
  parseHTML: () => [{ tag: 'p' }],
  renderHTML: ({ HTMLAttributes }) => ['p', mergeAttributes(HTMLAttributes, { class: 'sl' }), 0],
});

// ---------- conversion ----------

export function blocksToDoc(blocks: ScriptBlock[]): JSONContent {
  const list = blocks.length ? blocks : [{ id: nanoid(10), type: 'scene' as const, text: '' }];
  return {
    type: 'doc',
    content: list.map((b) => ({ type: 'sline', attrs: { kind: b.type, dual: !!b.dual, bid: b.id }, ...(b.text ? { content: [{ type: 'text', text: b.text }] } : {}) })),
  };
}

export function docToBlocks(doc: JSONContent): ScriptBlock[] {
  const seen = new Set<string>();
  return (doc.content ?? []).map((n) => {
    let id = (n.attrs?.bid as string | null) ?? '';
    if (!id || seen.has(id)) id = nanoid(10);
    seen.add(id);
    const text = (n.content ?? []).map((c) => c.text ?? '').join('');
    const type = (n.attrs?.kind as ScriptBlockType) ?? 'action';
    return { id, type, text, ...(n.attrs?.dual && type === 'character' ? { dual: true } : {}) };
  });
}

// ---------- editing commands ----------

export function currentLine(editor: Editor) {
  const { $from } = editor.state.selection;
  const node = $from.parent;
  return { node, pos: $from.before(), kind: node.attrs.kind as ScriptBlockType, text: node.textContent, atEnd: $from.parentOffset === node.content.size, index: $from.index(0) };
}

export function setKind(editor: Editor, kind: ScriptBlockType) {
  const { node, pos } = currentLine(editor);
  if (node.attrs.kind === kind) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, kind, dual: kind === 'character' ? node.attrs.dual : false }));
}

export function toggleDual(editor: Editor) {
  const { node, pos, kind } = currentLine(editor);
  if (kind !== 'character') return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, dual: !node.attrs.dual }));
}

/** Splits the line at the cursor; the new line gets `kind`. */
function newLine(editor: Editor, kind: ScriptBlockType) {
  const { state } = editor;
  const tr = state.tr;
  if (!state.selection.empty) tr.deleteSelection();
  const pos = tr.selection.$from.pos;
  tr.split(pos, 1, [{ type: state.schema.nodes.sline, attrs: { kind, dual: false, bid: nanoid(10) } }]);
  tr.setSelection(TextSelection.create(tr.doc, pos + 2));
  editor.view.dispatch(tr.scrollIntoView());
}

function onEnter(editor: Editor): boolean {
  let { kind, text } = currentLine(editor);
  // Enter on an empty line that is not action turns it into action (as in Final Draft).
  if (!text.trim() && kind !== 'action') {
    setKind(editor, 'action');
    return true;
  }
  if (kind === 'action' && looksLikeScene(text)) setKind(editor, (kind = 'scene'));
  else if (kind === 'action' && looksLikeTransition(text)) setKind(editor, (kind = 'transition'));
  newLine(editor, NEXT_ON_ENTER[kind]);
  return true;
}

function onTab(editor: Editor, back: boolean): boolean {
  const { kind, text, atEnd } = currentLine(editor);
  if (!back && kind === 'dialogue' && text.trim() && atEnd) {
    newLine(editor, 'parenthetical');
    return true;
  }
  setKind(editor, (back ? TAB_PREV : TAB_NEXT)[kind]);
  return true;
}

const ScriptKeys = Extension.create({
  name: 'scriptKeys',
  addKeyboardShortcuts() {
    const e = () => this.editor;
    const keys: Record<string, () => boolean> = {
      Enter: () => onEnter(e()),
      'Shift-Enter': () => e().commands.insertContent('\n'),
      Tab: () => onTab(e(), false),
      'Shift-Tab': () => onTab(e(), true),
    };
    KIND_ORDER.forEach((kind, i) => {
      keys[`Mod-${i + 1}`] = () => (setKind(e(), kind), true);
    });
    return keys;
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          // "(" on an empty line in a speech starts a parenthetical; the brackets are drawn for you.
          handleTextInput: (_view, _from, _to, text) => {
            const { kind, text: line, index, atEnd } = currentLine(editor);
            const prev = index > 0 ? (editor.state.doc.child(index - 1).attrs.kind as ScriptBlockType) : null;
            if (text === '(' && !line && (kind === 'dialogue' || kind === 'action') && prev && ['character', 'dialogue', 'parenthetical'].includes(prev)) {
              setKind(editor, 'parenthetical');
              return true;
            }
            if (text === ')' && kind === 'parenthetical' && atEnd) return true;
            if (text === ' ' && kind === 'action' && looksLikeScene(`${line} x`) && !looksLikeScene(line)) {
              setKind(editor, 'scene');
              return false;
            }
            return false;
          },
        },
      }),
    ];
  },
});

// ---------- page breaks ----------

export const pagesKey = new PluginKey<DecorationSet>('scriptPages');

const PageBreaks = Extension.create({
  name: 'scriptPages',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: pagesKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => (tr.getMeta(pagesKey) as DecorationSet | undefined) ?? old.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => pagesKey.getState(state) },
      }),
    ];
  },
});

/** Shows a page gap before the first line of each page (from the paginator's result). */
export function showPageBreaks(editor: Editor, starts: { block: number; page: number }[]) {
  const doc = editor.state.doc;
  const positions: number[] = [];
  let pos = 0;
  doc.forEach((node) => {
    positions.push(pos);
    pos += node.nodeSize;
  });
  const decos = starts
    .filter((s) => s.block >= 0 && s.block < positions.length)
    .map((s) =>
      Decoration.widget(
        positions[s.block],
        () => {
          const el = document.createElement('div');
          el.className = 'sp-break';
          el.contentEditable = 'false';
          el.innerHTML = `<span>${s.page}.</span>`;
          return el;
        },
        { side: -1, key: `p${s.page}-${s.block}` },
      ),
    );
  editor.view.dispatch(editor.state.tr.setMeta(pagesKey, DecorationSet.create(doc, decos)).setMeta('addToHistory', false));
}

export function scriptExtensions() {
  return [
    ScriptDoc,
    ScriptLine,
    Text,
    UndoRedo.configure({ depth: 300 }),
    Placeholder.configure({ placeholder: ({ node }) => PLACEHOLDERS[(node.attrs.kind as ScriptBlockType) ?? 'action'], showOnlyCurrent: true }),
    ScriptKeys,
    PageBreaks,
  ];
}
