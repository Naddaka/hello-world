import { useState, type ReactNode } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { actions } from '../model/store';
import type { CardColor } from '../model/types';
import {
  IconBullets,
  IconCenter,
  IconCheckbox,
  IconChevronDown,
  IconCode,
  IconLink,
  IconNumbers,
  IconQuote,
} from '../ui/icons';

const COLORS: { key: CardColor; label: string }[] = [
  { key: 'default', label: 'Обычный' },
  { key: 'yellow', label: 'Жёлтый' },
  { key: 'green', label: 'Зелёный' },
  { key: 'blue', label: 'Голубой' },
  { key: 'purple', label: 'Сиреневый' },
  { key: 'pink', label: 'Розовый' },
  { key: 'orange', label: 'Персиковый' },
  { key: 'transparent', label: 'Прозрачный' },
];

type Popup = null | 'style' | 'link' | 'color';

/** Prevents toolbar clicks from stealing focus from the editor. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

function Btn({ label, on, onClick, children, style }: { label: string; on?: boolean; onClick: () => void; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <button type="button" className={`fmt${on ? ' on' : ''}`} aria-label={label} title={label} aria-pressed={on} onMouseDown={keepFocus} onClick={onClick} style={style}>
      {children}
    </button>
  );
}

export function FormatBar({ editor, cardId, color, zoom }: { editor: Editor; cardId: string; color: CardColor; zoom: number }) {
  const [popup, setPopup] = useState<Popup>(null);
  const [href, setHref] = useState('');
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      highlight: e.isActive('highlight'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      link: e.isActive('link'),
      center: e.isActive({ textAlign: 'center' }),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      small: e.isActive('small'),
      quote: e.isActive('blockquote'),
      code: e.isActive('codeBlock'),
    }),
  });
  const chain = () => editor.chain().focus();
  const styleLabel = state.h1 ? 'Крупный заголовок' : state.h2 ? 'Заголовок' : state.small ? 'Мелкий' : state.quote ? 'Цитата' : state.code ? 'Код' : 'Текст';
  const toggle = (p: Popup) => setPopup((cur) => (cur === p ? null : p));

  const applyLink = () => {
    const url = href.trim();
    if (url) chain().extendMarkRange('link').setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` }).run();
    else chain().extendMarkRange('link').unsetLink().run();
    setPopup(null);
  };

  return (
    <div className="formatbar panel" style={{ transform: `scale(${1 / zoom})` }} onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ position: 'relative' }}>
        <Btn label="Стиль текста" onClick={() => toggle('style')} style={{ fontWeight: 500, padding: '0 8px' }}>
          {styleLabel}
          <IconChevronDown size={12} />
        </Btn>
        {popup === 'style' && (
          <div className="popover panel" role="menu">
            {[
              { label: 'Крупный заголовок', hint: '⌘⇧1', on: state.h1, run: () => chain().toggleHeading({ level: 1 }).run() },
              { label: 'Заголовок', hint: '⌘⇧2', on: state.h2, run: () => chain().toggleHeading({ level: 2 }).run() },
              { label: 'Текст', hint: '⌘⇧0', on: styleLabel === 'Текст', run: () => chain().setParagraph().unsetMark('small').run() },
              { label: 'Мелкий', hint: '⌘⇧9', on: state.small, run: () => chain().setParagraph().toggleMark('small').run() },
              { label: 'Цитата', hint: "⌘⇧'", on: state.quote, run: () => chain().toggleBlockquote().run() },
              { label: 'Код', hint: '⌘⇧>', on: state.code, run: () => chain().toggleCodeBlock().run() },
            ].map((item) => (
              <button key={item.label} type="button" role="menuitem" className={`menu-item${item.on ? ' on' : ''}`} onMouseDown={keepFocus} onClick={() => { item.run(); setPopup(null); }}>
                {item.label}
                <span className="hint">{item.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="fmt-sep" aria-hidden="true" />
      <Btn label="Жирный (⌘B)" on={state.bold} onClick={() => chain().toggleBold().run()} style={{ fontWeight: 800 }}>Ж</Btn>
      <Btn label="Курсив (⌘I)" on={state.italic} onClick={() => chain().toggleItalic().run()} style={{ fontStyle: 'italic', fontWeight: 500 }}>К</Btn>
      <Btn label="Подчёркнутый (⌘U)" on={state.underline} onClick={() => chain().toggleUnderline().run()} style={{ textDecoration: 'underline', fontWeight: 500 }}>Ч</Btn>
      <Btn label="Зачёркнутый (⌘⇧X)" on={state.strike} onClick={() => chain().toggleStrike().run()} style={{ textDecoration: 'line-through', fontWeight: 500 }}>З</Btn>
      <Btn label="Выделение (⌘J)" on={state.highlight} onClick={() => chain().toggleHighlight().run()}>
        <span style={{ padding: '1px 4px', borderRadius: 3, background: 'var(--mark)' }}>А</span>
      </Btn>
      <span className="fmt-sep" aria-hidden="true" />
      <Btn label="Маркированный список (⌘⇧U)" on={state.bullet} onClick={() => chain().toggleBulletList().run()}><IconBullets size={16} /></Btn>
      <Btn label="Нумерованный список (⌘⇧O)" on={state.ordered} onClick={() => chain().toggleOrderedList().run()}><IconNumbers size={16} /></Btn>
      <Btn label="Чекбоксы ([ ] и пробел)" on={state.task} onClick={() => chain().toggleTaskList().run()}><IconCheckbox size={16} /></Btn>
      <Btn label="Цитата" on={state.quote} onClick={() => chain().toggleBlockquote().run()}><IconQuote size={16} /></Btn>
      <Btn label="Блок кода" on={state.code} onClick={() => chain().toggleCodeBlock().run()}><IconCode size={16} /></Btn>
      <Btn label="По центру (⌘\)" on={state.center} onClick={() => chain().setTextAlign(state.center ? 'left' : 'center').run()}><IconCenter size={16} /></Btn>
      <div style={{ position: 'relative' }}>
        <Btn label="Ссылка (⌘K)" on={state.link} onClick={() => { setHref(editor.getAttributes('link').href ?? ''); toggle('link'); }}><IconLink size={16} /></Btn>
        {popup === 'link' && (
          <div className="popover panel">
            <form className="link-input" onSubmit={(e) => { e.preventDefault(); applyLink(); }}>
              <label className="sr-only" htmlFor="link-url">Адрес ссылки</label>
              <input id="link-url" autoFocus value={href} placeholder="Вставьте ссылку и нажмите Enter" onChange={(e) => setHref(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setPopup(null); editor.commands.focus(); } }} />
            </form>
          </div>
        )}
      </div>
      <span className="fmt-sep" aria-hidden="true" />
      <div style={{ position: 'relative' }}>
        <Btn label="Цвет карточки" onClick={() => toggle('color')}>
          <span style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--line)', background: color === 'transparent' ? 'transparent' : `var(--card-${color})` }} />
        </Btn>
        {popup === 'color' && (
          <div className="popover panel" style={{ left: 'auto', right: 0 }}>
            <div className="swatches">
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-label={c.label}
                  title={c.label}
                  className={`swatch${c.key === color ? ' on' : ''}${c.key === 'transparent' ? ' transparent' : ''}`}
                  style={c.key === 'transparent' ? undefined : { background: `var(--card-${c.key})` }}
                  onMouseDown={keepFocus}
                  onClick={() => { actions.update(cardId, { color: c.key }); setPopup(null); }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
