import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { EditorContent, useEditor, type Editor, type UseEditorOptions } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { nanoid } from 'nanoid';
import { actions, commit, useStore } from '../model/store';
import type { Op } from '../model/ops';
import { DEFAULT_WIDTH, type BreakdownCategory, type BreakdownItem, type ScriptBlock, type ScriptBlockType, type ScriptElement, type ScriptFormat, type ScriptTitlePage } from '../model/types';
import { IconScript } from '../ui/icons';
import { TileTitle } from '../canvas/TileTitle';
import { freeSpot } from '../canvas/placement';
import { FORMATS, characterName, eighthsLabel, paginate, parseHeading, scriptLanguage, scriptStats, type FormatSpec } from './layout';
import { EMPTY_TITLE_PAGE, parseFdx, parseFountain, type ParsedScript } from './formats';
import { exportScript, type ScriptExportFormat } from './print';
import { KIND_LABELS, KIND_ORDER, NEXT_ON_ENTER, TAB_NEXT, blocksToDoc, currentLine, docToBlocks, scriptExtensions, setKind, showBreakdown, showPageBreaks, toggleDual } from './schema';
import { CATEGORIES, addItem, itemSceneCounts, renameItem } from './breakdown';
import { makeBreakdownTable, makeStoryboard } from './storyboard';

export function newScriptFields(blocks?: ScriptBlock[], titlePage?: ScriptTitlePage, title = 'Новый сценарий') {
  return {
    type: 'SCRIPT' as const,
    title,
    blocks: blocks?.length ? blocks : [{ id: nanoid(10), type: 'scene' as const, text: '' }],
    format: 'russian' as ScriptFormat,
    titlePage: titlePage ?? { ...EMPTY_TITLE_PAGE },
    sceneNumbers: true,
  };
}

/** Reads a .fountain or .fdx file. */
export function parseScriptFile(name: string, text: string): ParsedScript {
  return /\.fdx$/i.test(name) || /^\s*<\?xml[\s\S]{0,200}<FinalDraft/.test(text) ? parseFdx(text) : parseFountain(text);
}

export const isScriptFileName = (name: string) => /\.(fountain|spmd|fdx)$/i.test(name);

const pagesLabel = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? 'страница' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'страницы' : 'страниц'}`;
};

/** Board tile of a screenplay. */
export function ScriptTile({ element, selected }: { element: ScriptElement; selected: boolean }) {
  const stats = useMemo(() => scriptStats(element.blocks, FORMATS[element.format]), [element.blocks, element.format]);
  return (
    <div className={`tile${selected ? ' selected' : ''}`}>
      <div className="tile-icon doc-icon script-icon">
        <IconScript size={38} strokeWidth={1.5} />
        <span className="script-badge">{stats.pages}</span>
      </div>
      <TileTitle text={element.title} />
      <div className="tile-meta">
        {pagesLabel(stats.pages)} · {stats.scenes.length} сц.
      </div>
    </div>
  );
}

export const useOpenScript = create<{ id: string | null }>(() => ({ id: null }));
export const openScript = (id: string) => useOpenScript.setState({ id });

/**
 * Lays the scenes of a script out on its board as a column of cards (heading,
 * first lines of action, length and cast) — the start of a storyboard or a
 * scene breakdown.
 */
export function scenesToBoard(script: ScriptElement): string | null {
  const f = FORMATS[script.format];
  const stats = scriptStats(script.blocks, f);
  if (!stats.scenes.length) return null;
  const now = Date.now();
  const parentId = script.parentId ?? useStore.getState().boardId;
  const columnId = nanoid();
  const spot = freeSpot(parentId, script.x + script.width + 4, script.y, DEFAULT_WIDTH.COLUMN, 12 + stats.scenes.length * 14);
  const ops: Op[] = [
    {
      kind: 'create',
      element: { id: columnId, type: 'COLUMN', parentId, section: 'CANVAS', x: spot.x, y: spot.y, z: script.z + 1, width: DEFAULT_WIDTH.COLUMN, title: `Сцены · ${script.title}`, collapsed: false, createdAt: now, updatedAt: now },
    },
  ];
  stats.scenes.forEach((scene, i) => {
    const next = stats.scenes[i + 1]?.block ?? script.blocks.length;
    const action = script.blocks.slice(scene.block + 1, next).find((b) => b.type === 'action' && b.text.trim())?.text ?? '';
    const summary = action.length > 220 ? `${action.slice(0, 217)}…` : action;
    const meta = [`${eighthsLabel(scene.eighths)} стр.`, ...(scene.characters.length ? [scene.characters.join(', ')] : [])].join(' · ');
    ops.push({
      kind: 'create',
      element: {
        id: nanoid(),
        type: 'CARD',
        parentId: columnId,
        section: 'CANVAS',
        x: 0,
        y: 0,
        z: i + 1,
        width: DEFAULT_WIDTH.CARD,
        color: 'default',
        createdAt: now,
        updatedAt: now,
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: `${scene.number}. ${scene.heading}`, marks: [{ type: 'bold' }] }] },
            ...(summary ? [{ type: 'paragraph', content: [{ type: 'text', text: summary }] }] : []),
            { type: 'paragraph', content: [{ type: 'text', text: meta, marks: [{ type: 'small' }] }] },
          ],
        },
      },
    });
  });
  commit(ops);
  return columnId;
}

// ---------- autocomplete ----------

interface Suggest {
  items: string[];
  index: number;
  from: number;
  to: number;
  /** Text added after the accepted item. */
  suffix: string;
  x: number;
  y: number;
}

const PREFIXES = { ru: ['ИНТ. ', 'НАТ. ', 'ИНТ./НАТ. '], en: ['INT. ', 'EXT. ', 'INT./EXT. '] };
const TIMES = { ru: ['ДЕНЬ', 'НОЧЬ', 'УТРО', 'ВЕЧЕР', 'РАССВЕТ', 'СУМЕРКИ', 'ПОЗЖЕ', 'НЕПРЕРЫВНО'], en: ['DAY', 'NIGHT', 'MORNING', 'EVENING', 'DAWN', 'DUSK', 'LATER', 'CONTINUOUS'] };
const TRANSITIONS = { ru: ['СМЕНА ПЛАНА:', 'ЗТМ.', 'ИЗ ЗТМ:', 'ПЕРЕХОД:', 'НАПЛЫВ:'], en: ['CUT TO:', 'FADE OUT.', 'FADE IN:', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:'] };

const upper = (s: string) => s.toLocaleUpperCase('ru-RU');

function computeSuggest(editor: Editor, blocks: ScriptBlock[], f: FormatSpec): Suggest | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const { kind, text, atEnd, pos, index } = currentLine(editor);
  if (!atEnd || !text) return null;
  const lang = scriptLanguage(blocks, f);
  const start = pos + 1;
  const end = selection.from;
  const pick = (pool: string[], typed: string) => {
    const t = upper(typed.trim());
    return [...new Set(pool)].filter((p) => upper(p).startsWith(t) && upper(p) !== t).slice(0, 8);
  };
  let items: string[] = [];
  let from = start;
  let suffix = '';
  if (kind === 'character') {
    const names = blocks.filter((b, i) => b.type === 'character' && i !== index).map((b) => characterName(b.text)).filter(Boolean);
    items = pick(names, text);
  } else if (kind === 'scene') {
    const h = parseHeading(text);
    if (!h.prefix) items = pick(PREFIXES[lang], text);
    else {
      const dash = text.search(/\s[-–—]\s[^-–—]*$/);
      if (dash >= 0) {
        const typed = text.slice(dash).replace(/^\s[-–—]\s/, '');
        from = start + text.length - typed.length;
        items = typed ? pick(TIMES[lang], typed) : TIMES[lang].slice(0, 8);
      } else {
        const locStart = text.length - h.location.length;
        from = start + locStart;
        const locations = blocks.filter((b, i) => b.type === 'scene' && i !== index).map((b) => parseHeading(b.text).location).filter(Boolean);
        items = h.location ? pick(locations, h.location) : [];
        suffix = ' — ';
      }
    }
  } else if (kind === 'transition') {
    items = pick(TRANSITIONS[lang], text);
  }
  if (!items.length) return null;
  const coords = editor.view.coordsAtPos(end);
  return { items, index: 0, from, to: end, suffix, x: coords.left, y: coords.bottom + 4 };
}

// ---------- editor ----------

function formatCss(): string {
  return Object.values(FORMATS)
    .map((f) => {
      const sel = `.sp-paper[data-format="${f.id}"]`;
      const rules = KIND_ORDER.map((k) => {
        const ind = f.indent[k];
        // A little slack: a line of exactly N characters must not wrap because of sub-pixel rounding.
        return `${sel} .sl[data-kind="${k}"] { margin-left: ${ind.left}in; width: calc(${ind.width}in + 3px); text-align: ${ind.align ?? 'left'}; margin-top: ${f.spaceBefore[k] / 6}in; ${k === 'scene' && f.sceneBold ? 'font-weight: 700;' : ''} }`;
      }).join('\n');
      return `${sel} { width: ${f.page.w}in; padding: ${f.margin.top}in ${f.margin.right}in ${f.margin.bottom}in ${f.margin.left}in; }\n${rules}`;
    })
    .join('\n');
}
const FORMAT_CSS = formatCss();

type Side = 'scenes' | 'characters' | 'breakdown';

function ScriptEditorView({ element }: { element: ScriptElement }) {
  const [title, setTitle] = useState(element.title);
  const [blocks, setBlocks] = useState(element.blocks);
  const [menu, setMenu] = useState<'export' | 'board' | null>(null);
  const [selText, setSelText] = useState('');
  const [category, setCategory] = useState<BreakdownCategory>('props');
  const [newItem, setNewItem] = useState('');
  const [titleOpen, setTitleOpen] = useState(false);
  const [side, setSide] = useState<Side>('scenes');
  const [kind, setKindState] = useState<ScriptBlockType>('scene');
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const suggestRef = useRef<Suggest | null>(null);
  suggestRef.current = suggest;
  const start = useRef({ title: element.title, blocks: element.blocks, titlePage: element.titlePage, format: element.format, sceneNumbers: element.sceneNumbers, breakdown: element.breakdown ?? [] });
  const latest = useRef({ ...start.current });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const live = useStore((s) => s.elements[element.id]) as ScriptElement | undefined;
  const format = live?.format ?? element.format;
  const f = FORMATS[format];

  const save = (patch: Partial<typeof latest.current>, immediate = false) => {
    latest.current = { ...latest.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    if (immediate) actions.setLive(element.id, latest.current);
    else timer.current = setTimeout(() => actions.setLive(element.id, latest.current), 300);
  };

  const options = useMemo<UseEditorOptions>(
    () => ({
      extensions: scriptExtensions(),
      content: blocksToDoc(element.blocks),
      immediatelyRender: true,
      editorProps: {
        attributes: { class: 'sp-rt', 'aria-label': 'Текст сценария', spellcheck: 'true' },
        handleKeyDown: (view, event) => {
          const s = suggestRef.current;
          if (!s) return false;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const d = event.key === 'ArrowDown' ? 1 : -1;
            setSuggest({ ...s, index: (s.index + d + s.items.length) % s.items.length });
            return true;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const item = s.items[s.index];
            const tr = view.state.tr.insertText(item + s.suffix, s.from, s.to);
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, s.from + item.length + s.suffix.length)));
            setSuggest(null);
            return true;
          }
          if (event.key === 'Escape') {
            setSuggest(null);
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => {
        const next = docToBlocks(editor.getJSON());
        setBlocks(next);
        save({ blocks: next });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [element.id],
  );
  const editor = useEditor(options);

  // Kind indicator and suggestions follow the cursor.
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      setKindState(currentLine(editor).kind);
      const { from, to } = editor.state.selection;
      setSelText(from === to ? '' : editor.state.doc.textBetween(from, to, ' ').trim().slice(0, 80));
      setSuggest(computeSuggest(editor, docToBlocks(editor.getJSON()), FORMATS[latest.current.format]));
    };
    editor.on('selectionUpdate', update);
    editor.on('update', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('update', update);
    };
  }, [editor]);

  // Focus at the end on open; on close, save and record one undo step.
  useEffect(() => {
    if (!editor) return;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.focus();
    const id = element.id;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (!useStore.getState().elements[id]) return;
      actions.setLive(id, latest.current);
      actions.recordEdit(id, start.current, latest.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Pagination (debounced) drives the page markers and the statistics.
  const [pages, setPages] = useState(() => paginate(element.blocks, f));
  useEffect(() => {
    const t = setTimeout(() => setPages(paginate(blocks, f)), 150);
    return () => clearTimeout(t);
  }, [blocks, f]);
  useEffect(() => {
    if (!editor) return;
    showPageBreaks(
      editor,
      pages.slice(1).map((p) => ({ block: p.firstBlock ?? -1, page: p.number })),
    );
  }, [editor, pages]);
  const stats = useMemo(() => scriptStats(blocks, f, pages), [blocks, f, pages]);
  const breakdown = live?.breakdown ?? latest.current.breakdown;
  useEffect(() => {
    if (editor) showBreakdown(editor, breakdown);
  }, [editor, breakdown]);
  const counts = useMemo(() => (side === 'breakdown' ? itemSceneCounts({ blocks, format, breakdown }) : new Map<string, number>()), [side, blocks, format, breakdown]);
  const setBreakdown = (next: BreakdownItem[]) => save({ breakdown: next }, true);
  const addToBreakdown = (name: string, cat: BreakdownCategory) => {
    const next = addItem(breakdown, { id: nanoid(8), category: cat, name });
    if (next !== breakdown) setBreakdown(next);
  };

  const close = useCallback(() => useOpenScript.setState({ id: null }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (suggestRef.current) return;
      e.preventDefault();
      if (menu) setMenu(null);
      else if (titleOpen) setTitleOpen(false);
      else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, titleOpen, close]);

  const current = (): ScriptElement => ({ ...element, ...(live ?? {}), ...latest.current }) as ScriptElement;

  const goToBlock = (index: number) => {
    if (!editor) return;
    let pos = 0;
    for (let i = 0; i < index && i < editor.state.doc.childCount; i++) pos += editor.state.doc.child(i).nodeSize;
    editor.chain().setTextSelection(pos + 1).scrollIntoView().run();
    editor.view.focus();
    editor.view.domAtPos(pos + 1).node.parentElement?.scrollIntoView({ block: 'center' });
  };

  const importFile = async (file: File | undefined) => {
    if (!file || !editor) return;
    try {
      const parsed = parseScriptFile(file.name, await file.text());
      const hasText = blocks.some((b) => b.text.trim());
      if (hasText && !window.confirm(`Заменить текст сценария содержимым «${file.name}»?`)) return;
      editor.commands.setContent(blocksToDoc(parsed.blocks), { emitUpdate: true });
      const titlePage = { ...latest.current.titlePage, ...Object.fromEntries(Object.entries(parsed.titlePage).filter(([, v]) => v)) } as ScriptTitlePage;
      const name = parsed.titlePage.title || title;
      setTitle(name);
      save({ titlePage, title: name, blocks: parsed.blocks }, true);
    } catch (error) {
      actions.showToast(error instanceof Error ? error.message : 'Не удалось прочитать файл');
    }
  };

  const runExport = async (fmt: ScriptExportFormat) => {
    setMenu(null);
    save({}, true);
    try {
      await exportScript(current(), fmt);
    } catch (error) {
      actions.showToast(error instanceof Error ? error.message : 'Не удалось экспортировать');
    }
  };

  /** Puts something built from the script on its board, after closing the editor (so undo removes just that). */
  const toBoard = (kind: 'scenes' | 'storyboard' | 'breakdown') => {
    setMenu(null);
    if (!stats.scenes.length) return actions.showToast('В сценарии пока нет сцен');
    save({}, true);
    const snapshot = current();
    close();
    setTimeout(() => {
      const id = kind === 'scenes' ? scenesToBoard(snapshot) : kind === 'storyboard' ? makeStoryboard(snapshot) : makeBreakdownTable(snapshot);
      if (id) actions.select([id]);
      actions.showToast(kind === 'scenes' ? `Сцены разложены на доске: ${stats.scenes.length}` : kind === 'storyboard' ? 'Раскадровка создана — откройте доску рядом со сценарием' : 'Таблица разбора добавлена на доску');
    }, 0);
  };

  return (
    <div className="doc-overlay sp-overlay" role="dialog" aria-label={`Сценарий ${title}`} onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
      <style>{FORMAT_CSS}</style>
      <header className="doc-head sp-head" data-tauri-drag-region>
        <button type="button" className="link-btn" onClick={close}>
          ← К доске
        </button>
        <label className="sr-only" htmlFor="sp-title">
          Название сценария
        </label>
        <input
          id="sp-title"
          className="sp-title-input"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            save({ title: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && editor) {
              e.preventDefault();
              editor.view.focus();
            }
          }}
        />
        <span className="doc-count" aria-live="polite">
          {pagesLabel(stats.pages)} · ≈{stats.minutes} мин · {stats.scenes.length} сц.
        </span>
        <select
          className="sp-select"
          aria-label="Формат страницы"
          value={format}
          onChange={(e) => {
            const fmt = e.target.value as ScriptFormat;
            save({ format: fmt }, true);
          }}
        >
          {Object.values(FORMATS).map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        <label className="sp-check">
          <input
            type="checkbox"
            checked={live?.sceneNumbers ?? element.sceneNumbers}
            onChange={(e) => save({ sceneNumbers: e.target.checked }, true)}
          />
          Номера сцен
        </label>
        <button type="button" className="ibtn wide" onClick={() => setTitleOpen(true)}>
          Титульный лист
        </button>
        <button type="button" className="ibtn wide" title="Открыть Fountain или Final Draft (.fdx)" onClick={() => fileInput.current?.click()}>
          Открыть…
        </button>
        <input ref={fileInput} type="file" accept=".fountain,.spmd,.fdx,.txt" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
        <div style={{ position: 'relative' }}>
          <button type="button" className="ibtn wide" aria-expanded={menu === 'board'} onClick={() => setMenu(menu ? null : 'board')}>
            На доску ▾
          </button>
          {menu === 'board' && (
            <div className="popover panel" style={{ left: 'auto', right: 0, width: 280 }} role="menu">
              {(
                [
                  ['scenes', 'Сцены карточками', 'Колонка: заголовок, начало действия, объём, персонажи'],
                  ['storyboard', 'Раскадровка', 'Доска с рядом кадров для каждой сцены'],
                  ['breakdown', 'Разбор по сценам (таблица)', 'Режим, объект, время, объём, персонажи и элементы разбора'],
                ] as const
              ).map(([kind, label, hint]) => (
                <button key={kind} type="button" role="menuitem" className="menu-item menu-item-2" onClick={() => toBoard(kind)}>
                  <span>{label}</span>
                  <small>{hint}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <button type="button" className="btn-accent" aria-expanded={menu === 'export'} onClick={() => setMenu(menu ? null : 'export')}>
            Экспорт
          </button>
          {menu === 'export' && (
            <div className="popover panel" style={{ left: 'auto', right: 0 }} role="menu">
              {(
                [
                  ['pdf', 'PDF (печать)'],
                  ['fdx', 'Final Draft (.fdx)'],
                  ['fountain', 'Fountain'],
                  ['doc', 'Word'],
                  ['txt', 'Обычный текст'],
                ] as const
              ).map(([fmt, label]) => (
                <button key={fmt} type="button" role="menuitem" className="menu-item" onClick={() => void runExport(fmt)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      <div className="sp-body">
        <aside className="sp-side" aria-label="Навигатор">
          <div className="sp-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={side === 'scenes'} className={side === 'scenes' ? 'on' : ''} onClick={() => setSide('scenes')}>
              Сцены
            </button>
            <button type="button" role="tab" aria-selected={side === 'characters'} className={side === 'characters' ? 'on' : ''} onClick={() => setSide('characters')}>
              Персонажи
            </button>
            <button type="button" role="tab" aria-selected={side === 'breakdown'} className={side === 'breakdown' ? 'on' : ''} onClick={() => setSide('breakdown')}>
              Разбор
            </button>
          </div>
          {side === 'breakdown' ? (
            <div className="sp-bd">
              <form
                className="sp-bd-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  addToBreakdown(newItem, category);
                  setNewItem('');
                }}
              >
                <select aria-label="Категория" value={category} onChange={(e) => setCategory(e.target.value as BreakdownCategory)}>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input aria-label="Новый элемент разбора" placeholder="Например, револьвер" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
              </form>
              <p className="side-hint" style={{ padding: '0 0 8px' }}>
                Или выделите слово в тексте и нажмите «В разбор» внизу. Элемент находится во всех сценах, в любой форме слова.
              </p>
              {CATEGORIES.filter((c) => breakdown.some((i) => i.category === c.id)).map((c) => (
                <section key={c.id} className="sp-bd-cat">
                  <h3>
                    <span className="bd-dot" style={{ background: c.color }} /> {c.label}
                  </h3>
                  <ul>
                    {breakdown
                      .filter((i) => i.category === c.id)
                      .map((i) => (
                        <li key={i.id}>
                          <input
                            key={`${i.id}:${i.name}`}
                            className="sp-bd-name"
                            aria-label={`Название «${i.name}»`}
                            title="Можно переименовать, например в начальную форму слова"
                            defaultValue={i.name}
                            onBlur={(e) => e.target.value.trim() !== i.name && setBreakdown(renameItem(breakdown, i.id, e.target.value))}
                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                          />
                          <span className="sp-bd-count">{counts.get(i.name) ?? 0} сц.</span>
                          <button type="button" className="ibtn sp-bd-del" aria-label={`Убрать «${i.name}» из разбора`} onClick={() => setBreakdown(breakdown.filter((x) => x.id !== i.id))}>
                            ✕
                          </button>
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
              {!breakdown.length && <p className="col-empty">Разбор пуст</p>}
            </div>
          ) : side === 'scenes' ? (
            <ol className="sp-scenes">
              {stats.scenes.map((s) => (
                <li key={s.block}>
                  <button type="button" onClick={() => goToBlock(s.block)}>
                    <span className="sp-scene-no">{s.number}</span>
                    <span className="sp-scene-h">{s.heading || 'Без заголовка'}</span>
                    <span className="sp-scene-meta">
                      стр. {s.page} · {eighthsLabel(s.eighths)}
                    </span>
                  </button>
                </li>
              ))}
              {!stats.scenes.length && <li className="col-empty">Сцен пока нет</li>}
            </ol>
          ) : (
            <div className="sp-chars">
              <table>
                <tbody>
                  {stats.characters.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td title="Реплик">{c.speeches}</td>
                      <td title="Сцен">{c.scenes} сц.</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!stats.characters.length && <p className="col-empty">Персонажей пока нет</p>}
              {stats.locations.length > 0 && (
                <>
                  <h3>Локации</h3>
                  <ul>
                    {stats.locations.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </aside>
        <div className="sp-scroll">
          <div className={`sp-paper${(live?.sceneNumbers ?? element.sceneNumbers) ? ` sp-numbers sp-numbers-${f.sceneNumbers}` : ''}`} data-format={format}>
            {editor && <EditorContent editor={editor} />}
          </div>
        </div>
      </div>
      <footer className="sp-foot">
        <label className="sp-kind">
          <span className="sr-only">Элемент</span>
          <select
            value={kind}
            onChange={(e) => {
              if (!editor) return;
              setKind(editor, e.target.value as ScriptBlockType);
              editor.view.focus();
            }}
          >
            {KIND_ORDER.map((k, i) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]} (⌘{i + 1})
              </option>
            ))}
          </select>
        </label>
        <span className="sp-hint">
          Enter → {KIND_LABELS[NEXT_ON_ENTER[kind]]} · Tab → {KIND_LABELS[kind === 'dialogue' ? 'parenthetical' : TAB_NEXT[kind]]}
        </span>
        {selText && (
          <span className="sp-bd-quick">
            <select aria-label="Категория разбора" value={category} onChange={(e) => setCategory(e.target.value as BreakdownCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn-accent" onMouseDown={(e) => e.preventDefault()} onClick={() => addToBreakdown(selText, category)}>
              В разбор: «{selText.length > 24 ? `${selText.slice(0, 24)}…` : selText}»
            </button>
          </span>
        )}
        {kind === 'character' && editor && (
          <button type="button" className="link-btn" onClick={() => (toggleDual(editor), editor.view.focus())}>
            {currentLine(editor).node.attrs.dual ? 'Убрать двойной диалог' : 'Двойной диалог (рядом с предыдущей репликой)'}
          </button>
        )}
      </footer>
      {suggest && (
        <ul className="sp-suggest panel" role="listbox" style={{ left: suggest.x, top: suggest.y }}>
          {suggest.items.map((item, i) => (
            <li
              key={item}
              role="option"
              aria-selected={i === suggest.index}
              className={i === suggest.index ? 'on' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                if (!editor) return;
                const tr = editor.state.tr.insertText(item + suggest.suffix, suggest.from, suggest.to);
                editor.view.dispatch(tr);
                setSuggest(null);
              }}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
      {titleOpen && (
        <TitlePageDialog
          value={latest.current.titlePage}
          fallbackTitle={title}
          onClose={() => setTitleOpen(false)}
          onSave={(tp) => {
            save({ titlePage: tp }, true);
            setTitleOpen(false);
          }}
        />
      )}
    </div>
  );
}

function TitlePageDialog({ value, fallbackTitle, onSave, onClose }: { value: ScriptTitlePage; fallbackTitle: string; onSave: (v: ScriptTitlePage) => void; onClose: () => void }) {
  const [tp, setTp] = useState({ ...value, title: value.title || fallbackTitle });
  const field = (key: keyof ScriptTitlePage, label: string, multiline = false) => (
    <label className="sp-field">
      <span>{label}</span>
      {multiline ? <textarea rows={3} value={tp[key]} onChange={(e) => setTp({ ...tp, [key]: e.target.value })} /> : <input value={tp[key]} onChange={(e) => setTp({ ...tp, [key]: e.target.value })} />}
    </label>
  );
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal panel" role="dialog" aria-modal="true" aria-label="Титульный лист">
        <header className="modal-head">
          <h2>Титульный лист</h2>
          <button type="button" className="ibtn" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="modal-body">
          {field('title', 'Название')}
          {field('credit', 'Строка авторства (например, «Автор сценария»)')}
          {field('authors', 'Авторы')}
          {field('source', 'Основано на')}
          {field('draftDate', 'Дата или версия черновика')}
          {field('contact', 'Контакты', true)}
          <footer className="modal-foot">
            <button type="button" className="ibtn wide" onClick={onClose}>
              Отмена
            </button>
            <button type="button" className="btn-accent" onClick={() => onSave(tp)}>
              Сохранить
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

/** Full-screen editor of the open screenplay, if any. */
export function ScriptOverlay() {
  const id = useOpenScript((s) => s.id);
  const element = useStore((s) => (id ? s.elements[id] : undefined));
  if (!element || element.type !== 'SCRIPT') return null;
  return <ScriptEditorView key={element.id} element={element} />;
}
