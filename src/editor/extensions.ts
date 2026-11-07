import { Extension, Mark, mergeAttributes, wrappingInputRule, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';

/** Small text style (⌘⇧9), rendered as <small>. */
export const Small = Mark.create({
  name: 'small',
  parseHTML: () => [{ tag: 'small' }],
  renderHTML: ({ HTMLAttributes }) => ['small', mergeAttributes(HTMLAttributes), 0],
});

/**
 * Keyboard shortcuts and markdown rules matching the reference app:
 * ⌘⇧1/2 headings, ⌘⇧0 normal, ⌘⇧9 small, ⌘J highlight, ⌘⇧X strike,
 * ⌘⇧U / ⌘⇧O lists, ⌘⇧> code block, ⌘⇧' quote, ⌘\ centre, ". " bullet list.
 */
export const ZadumKeymap = Extension.create({
  name: 'zadumKeymap',
  addKeyboardShortcuts() {
    const c = () => this.editor.chain().focus();
    return {
      'Mod-Shift-1': () => c().toggleHeading({ level: 1 }).run(),
      'Mod-Shift-2': () => c().toggleHeading({ level: 2 }).run(),
      'Mod-Shift-0': () => c().setParagraph().unsetMark('small').run(),
      'Mod-Shift-9': () => c().setParagraph().toggleMark('small').run(),
      'Mod-j': () => c().toggleHighlight().run(),
      'Mod-Shift-x': () => c().toggleStrike().run(),
      'Mod-Shift-u': () => c().toggleBulletList().run(),
      'Mod-Shift-o': () => c().toggleOrderedList().run(),
      'Mod-Shift-.': () => c().toggleCodeBlock().run(),
      "Mod-Shift-'": () => c().toggleBlockquote().run(),
      'Mod-\\': () => {
        const centered = this.editor.isActive({ textAlign: 'center' });
        return c().setTextAlign(centered ? 'left' : 'center').run();
      },
    };
  },
  addInputRules() {
    const bullet = this.editor.schema.nodes.bulletList;
    return bullet ? [wrappingInputRule({ find: /^\s*\.\s$/, type: bullet })] : [];
  },
});

/** Extensions used both for editing and for rendering stored notes to HTML. */
export function noteExtensions(placeholder?: string): Extensions {
  const list: Extensions = [
    StarterKit.configure({
      heading: { levels: [1, 2] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      undoRedo: { depth: 200 },
    }),
    Highlight,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Small,
    ZadumKeymap,
  ];
  if (placeholder) list.push(Placeholder.configure({ placeholder }));
  return list;
}
