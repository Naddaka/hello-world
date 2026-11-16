import { useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { nanoid } from 'nanoid';
import { actions, asOneStep, useStore } from '../model/store';
import type { BreakdownItem, ScriptBlockType, ScriptElement } from '../model/types';
import { DEFAULT_WIDTH } from '../model/types';
import { CATEGORIES, addItem } from '../script/breakdown';
import { FORMATS, scriptLanguage, type SceneInfo, type ScriptStats } from '../script/layout';
import { placeShots, sizeShort } from '../script/storyboard';
import { freeSpot } from '../canvas/placement';
import { newDocumentFields } from '../doc/DocumentView';
import { IconSparkle } from '../ui/icons';
import { openAiJob } from './AiDialog';
import { Markdown } from './MarkdownView';
import { markdownToDoc } from './markdown';
import { ask, type AiAnswer } from './run';
import { costOf, openAiSettings } from './settings';
import {
  TRANSLATE_CHUNK,
  TRANSLATE_SCHEMA,
  applyTranslation,
  breakdownRequest,
  checkItems,
  checkShots,
  notesRequest,
  rewriteRequest,
  shotsRequest,
  translateLines,
  translateSystem,
  type ProposedItem,
  type ProposedShot,
  type Variant,
} from './scriptPrompts';

interface Props {
  editor: Editor | null;
  /** The script as it is right now (unsaved typing included). */
  script: () => ScriptElement;
  stats: ScriptStats;
  getBreakdown: () => BreakdownItem[];
  setBreakdown: (next: BreakdownItem[]) => void;
  /** Writes pending edits to the store. */
  flush: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** The scene the cursor is in. */
function sceneAtCursor(editor: Editor | null, stats: ScriptStats): SceneInfo | null {
  if (!editor || !stats.scenes.length) return null;
  const index = editor.state.selection.$from.index(0);
  return [...stats.scenes].reverse().find((s) => s.block <= index) ?? stats.scenes[0];
}

/** The text to rewrite: the selection inside one line, or the whole line under the cursor. */
function fragmentAtCursor(editor: Editor | null): { from: number; to: number; text: string; kind: ScriptBlockType } | null {
  if (!editor) return null;
  const { $from, $to, empty } = editor.state.selection;
  if ($from.index(0) !== $to.index(0)) return null;
  const kind = $from.parent.attrs.kind as ScriptBlockType;
  const from = empty ? $from.start() : $from.pos;
  const to = empty ? $from.end() : $to.pos;
  const text = editor.state.doc.textBetween(from, to, ' ').trim();
  return text ? { from, to, text, kind } : null;
}

const copy = (text: string) => navigator.clipboard.writeText(text).then(() => actions.showToast('Скопировано'), () => actions.showToast('Не удалось скопировать'));

/** Saves the model's text as a document on the board, next to the script. */
function saveAsDocument(script: ScriptElement, title: string, markdown: string): string {
  const parentId = script.parentId ?? useStore.getState().boardId;
  const spot = freeSpot(parentId, script.x + script.width + 4, script.y, DEFAULT_WIDTH.DOCUMENT, 12);
  const id = actions.insert({ ...newDocumentFields(), title, content: markdownToDoc(markdown) }, parentId, spot.x, spot.y);
  return id;
}

export function ScriptAiMenu({ editor, script, stats, getBreakdown, setBreakdown, flush, open, setOpen }: Props) {
  const scene = open ? sceneAtCursor(editor, stats) : null;
  const fragment = open ? fragmentAtCursor(editor) : null;
  const hasText = stats.scenes.length > 0 || script().blocks.some((b) => b.text.trim());
  const from = scriptLanguage(script().blocks, FORMATS[script().format]);
  const to = from === 'en' ? 'ru' : 'en';

  const start = (run: () => void) => {
    setOpen(false);
    if (!hasText) return actions.showToast('В сценарии пока нет текста');
    flush();
    run();
  };

  const breakdown = () =>
    start(() => {
      const snapshot = script();
      openAiJob<{ items: ProposedItem[] }>({
        title: 'Разбор сценария',
        sends: `сценарий «${snapshot.title}» целиком`,
        request: breakdownRequest(snapshot),
        wide: true,
        Result: ({ answer, close }) => <BreakdownResult answer={answer} script={snapshot} getBreakdown={getBreakdown} setBreakdown={setBreakdown} close={close} />,
      });
    });

  const shots = () =>
    start(() => {
      const snapshot = script();
      const target = sceneAtCursor(editor, stats);
      if (!target) return actions.showToast('Поставьте курсор в сцену');
      openAiJob<{ shots: ProposedShot[] }>({
        title: `Кадры для сцены ${target.number}`,
        sends: `сценарий «${snapshot.title}» целиком (план нужен для сцены ${target.number})`,
        request: shotsRequest(snapshot, target),
        wide: true,
        Result: ({ answer, close }) => <ShotsResult answer={answer} script={snapshot} scene={target} close={close} />,
      });
    });

  const notes = (whole: boolean) =>
    start(() => {
      const snapshot = script();
      const target = whole ? null : sceneAtCursor(editor, stats);
      if (!whole && !target) return actions.showToast('Поставьте курсор в сцену');
      const title = target ? `Заметки редактора: сцена ${target.number}` : 'Заметки редактора';
      openAiJob<null>({
        title,
        sends: `сценарий «${snapshot.title}» целиком`,
        request: notesRequest(snapshot, target),
        wide: true,
        Result: ({ answer, close }) => (
          <>
            <Markdown text={answer.text} className="ai-answer" />
            <footer className="modal-foot">
              <button type="button" className="ibtn wide" onClick={() => void copy(answer.text)}>Копировать</button>
              <button
                type="button"
                className="btn-accent"
                onClick={() => {
                  saveAsDocument(snapshot, `${title} · ${snapshot.title}`, answer.text);
                  actions.showToast('Заметки сохранены документом рядом со сценарием');
                  close();
                }}
              >
                Сохранить документом на доске
              </button>
            </footer>
          </>
        ),
      });
    });

  const rewrite = () =>
    start(() => {
      const snapshot = script();
      const target = fragmentAtCursor(editor);
      if (!target || !editor) return actions.showToast('Выделите текст внутри одной реплики или абзаца — или поставьте курсор в строку');
      openAiJob<{ variants: Variant[] }>({
        title: 'Варианты текста',
        sends: `сценарий «${snapshot.title}» целиком (варианты нужны для выбранного фрагмента)`,
        request: rewriteRequest(snapshot, target.text, target.kind, sceneAtCursor(editor, stats)),
        Result: ({ answer, close }) => (
          <>
            <p className="side-hint" style={{ padding: 0 }}>Было: «{target.text}»</p>
            <ul className="ai-variants">
              {(answer.data?.variants ?? []).filter((v) => v?.text?.trim()).slice(0, 5).map((v, i) => (
                <li key={i}>
                  <p>{v.text}</p>
                  {v.note && <small>{v.note}</small>}
                  <span className="ai-tools">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        // The text has not changed while the dialog was open (it is modal), so the range still holds.
                        const now = editor.state.doc.textBetween(target.from, Math.min(target.to, editor.state.doc.content.size), ' ').trim();
                        if (now !== target.text) return actions.showToast('Текст изменился — вставьте вариант вручную');
                        close();
                        // After the dialog is gone, so the cursor ends up in the script (⌘Z then undoes the replacement).
                        setTimeout(() => {
                          editor.chain().insertContentAt({ from: target.from, to: target.to }, v.text.trim()).run();
                          editor.view.focus();
                        }, 0);
                      }}
                    >
                      Заменить в сценарии
                    </button>
                    <button type="button" className="link-btn" onClick={() => void copy(v.text)}>Копировать</button>
                  </span>
                </li>
              ))}
            </ul>
            <footer className="modal-foot">
              <button type="button" className="ibtn wide" onClick={close}>Оставить как было</button>
            </footer>
          </>
        ),
      });
    });

  const translate = () =>
    start(() => {
      const snapshot = script();
      const system = translateSystem(to);
      const total = snapshot.blocks.length;
      const chunks = Math.ceil(total / TRANSLATE_CHUNK);
      type Translated = { blocks: ScriptElement['blocks']; translated: number; title: string };
      openAiJob<Translated>({
        title: to === 'en' ? 'Перевод на английский' : 'Перевод на русский',
        sends: `сценарий «${snapshot.title}» целиком`,
        // For the size and price estimate; the run below sends the same text in parts.
        request: { system, prompt: translateLines(snapshot.blocks, 0, total), schema: TRANSLATE_SCHEMA },
        wide: true,
        run: async (hooks) => {
          const lines: { i: number; text: string }[] = [];
          const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
          let model = '';
          let usedFallback = false;
          for (let c = 0; c < chunks; c++) {
            if (chunks > 1) hooks.onStatus(`Часть ${c + 1} из ${chunks}`);
            const part = await ask<{ lines: { i: number; text: string }[] }>(
              { system, prompt: `Переведи эти строки:\n${translateLines(snapshot.blocks, c * TRANSLATE_CHUNK, Math.min(total, (c + 1) * TRANSLATE_CHUNK))}`, schema: TRANSLATE_SCHEMA, effort: 'low', maxTokens: 64000 },
              { signal: hooks.signal, onText: hooks.onText, onThinking: hooks.onThinking },
            );
            lines.push(...(part.data?.lines ?? []));
            usage.input_tokens += part.usage.input_tokens;
            usage.output_tokens += part.usage.output_tokens;
            usage.cache_creation_input_tokens += part.usage.cache_creation_input_tokens ?? 0;
            usage.cache_read_input_tokens += part.usage.cache_read_input_tokens ?? 0;
            model = part.model;
            usedFallback ||= part.usedFallback;
          }
          const title = await ask<null>({ system: 'Переведи название фильма. Ответь только переводом, без кавычек и пояснений.', prompt: `Название: ${snapshot.title}\nЯзык перевода: ${to === 'en' ? 'английский' : 'русский'}`, effort: 'low', maxTokens: 200 }, { signal: hooks.signal }).then(
            (a) => a.text.trim().replace(/^["«]|["»]$/g, '').slice(0, 120),
            () => '',
          );
          const applied = applyTranslation(snapshot.blocks, lines, () => nanoid(10));
          return { text: '', data: { ...applied, title: title || `${snapshot.title} (${to.toUpperCase()})` }, model, usage, cost: costOf(model, usage), usedFallback, truncated: false };
        },
        Result: ({ answer, close }) => {
          const data = answer.data;
          const missing = snapshot.blocks.filter((b) => b.text.trim()).length - data.translated;
          return (
            <>
              <p>
                Переведено строк: {data.translated}
                {missing > 0 ? `. Без перевода осталось: ${missing} — они будут на языке оригинала.` : '.'}
              </p>
              <div className="ai-answer ai-script-preview">
                {data.blocks.slice(0, 60).map((b) => (
                  <p key={b.id} data-kind={b.type}>{b.type === 'parenthetical' ? `(${b.text})` : b.text}</p>
                ))}
                {data.blocks.length > 60 && <p className="sub">… и ещё {data.blocks.length - 60} строк</p>}
              </div>
              <footer className="modal-foot">
                <button type="button" className="ibtn wide" onClick={close}>Не сохранять</button>
                <button
                  type="button"
                  className="btn-accent"
                  onClick={() => {
                    const parentId = snapshot.parentId ?? useStore.getState().boardId;
                    const spot = freeSpot(parentId, snapshot.x + snapshot.width + 4, snapshot.y, DEFAULT_WIDTH.SCRIPT, 14);
                    actions.insert(
                      { type: 'SCRIPT', title: data.title, blocks: data.blocks, format: to === 'en' ? 'hollywood' : 'russian', titlePage: { ...snapshot.titlePage, title: data.title }, sceneNumbers: snapshot.sceneNumbers },
                      parentId,
                      spot.x,
                      spot.y,
                    );
                    actions.showToast(`Перевод сохранён отдельным сценарием «${data.title}» рядом с оригиналом`);
                    close();
                  }}
                >
                  Сохранить отдельным сценарием
                </button>
              </footer>
            </>
          );
        },
      });
    });

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="ibtn wide ai-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconSparkle size={15} /> ИИ ▾
      </button>
      {open && (
        <div className="popover panel" style={{ left: 'auto', right: 0, width: 310 }} role="menu">
          <button type="button" role="menuitem" className="menu-item menu-item-2" onClick={breakdown}>
            <span>Разбор сценария</span>
            <small>Предложит реквизит, костюм, транспорт и другое — вы отметите, что взять</small>
          </button>
          <button type="button" role="menuitem" className="menu-item menu-item-2" disabled={!scene} onClick={shots}>
            <span>Кадры для сцены{scene ? ` ${scene.number}` : ''}</span>
            <small>План съёмки: крупность, ракурс, движение. Кадры появятся в раскадровке и shot list</small>
          </button>
          <button type="button" role="menuitem" className="menu-item menu-item-2" disabled={!scene} onClick={() => notes(false)}>
            <span>Заметки редактора: сцена{scene ? ` ${scene.number}` : ''}</span>
            <small>Структура, диалоги, темп — по сцене, где стоит курсор</small>
          </button>
          <button type="button" role="menuitem" className="menu-item menu-item-2" onClick={() => notes(true)}>
            <span>Заметки редактора: весь сценарий</span>
            <small>Что работает и что править в первую очередь</small>
          </button>
          <button type="button" role="menuitem" className="menu-item menu-item-2" disabled={!fragment} onClick={rewrite}>
            <span>Варианты текста</span>
            <small>{fragment ? `Три варианта для: «${fragment.text.length > 46 ? `${fragment.text.slice(0, 45)}…` : fragment.text}»` : 'Выделите текст внутри одной строки или поставьте в неё курсор'}</small>
          </button>
          <button type="button" role="menuitem" className="menu-item menu-item-2" onClick={translate}>
            <span>{to === 'en' ? 'Перевести на английский' : 'Перевести на русский'}</span>
            <small>Отдельным сценарием в формате языка перевода; оригинал не меняется</small>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              openAiSettings();
            }}
          >
            Настройки ИИ…
          </button>
        </div>
      )}
    </div>
  );
}

function BreakdownResult({ answer, script, getBreakdown, setBreakdown, close }: { answer: AiAnswer<{ items: ProposedItem[] }>; script: ScriptElement; getBreakdown: () => BreakdownItem[]; setBreakdown: (next: BreakdownItem[]) => void; close: () => void }) {
  const items = useMemo(() => checkItems(answer.data?.items, script, getBreakdown()).filter((i) => !i.known), [answer, script, getBreakdown]);
  // Names the app cannot find in the text would never show up in a scene: off by default.
  const [picked, setPicked] = useState(() => new Set(items.filter((i) => i.found > 0).map((i) => `${i.category}|${i.name}`)));
  const key = (i: { category: string; name: string }) => `${i.category}|${i.name}`;
  const toggle = (k: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return next;
  });
  if (!items.length) {
    return (
      <>
        <p>Новых элементов не нашлось: всё, что предложила модель, уже есть в разборе.</p>
        <footer className="modal-foot"><button type="button" className="btn-accent" onClick={close}>Закрыть</button></footer>
      </>
    );
  }
  const groups = CATEGORIES.map((c) => ({ ...c, items: items.filter((i) => i.category === c.id) })).filter((g) => g.items.length);
  return (
    <>
      <p>Найдено элементов: {items.length}. Отметьте, что добавить в разбор. Элемент подсветится в тексте и попадёт во все сцены, где он упоминается.</p>
      <div className="ai-tools">
        <button type="button" className="link-btn" onClick={() => setPicked(new Set(items.map(key)))}>Отметить все</button>
        <button type="button" className="link-btn" onClick={() => setPicked(new Set())}>Снять все</button>
      </div>
      <ul className="ai-check-list" aria-label="Предложенные элементы разбора">
        {groups.map((g) => (
          <li key={g.id} className="group-wrap" style={{ display: 'block', padding: 0, border: 0 }}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              <li className="group"><span className="bd-dot" style={{ background: g.color, width: 9, height: 9, borderRadius: '50%', marginTop: 4 }} />{g.label} · {g.items.length}</li>
              {g.items.map((i) => (
                <li key={key(i)}>
                  <input type="checkbox" id={`ai-bd-${key(i)}`} checked={picked.has(key(i))} onChange={() => toggle(key(i))} />
                  <label htmlFor={`ai-bd-${key(i)}`} className="grow">
                    {i.name}{' '}
                    <span className="sub">
                      {i.found > 0 ? `· сцен: ${i.found}` : `· в тексте не найдено${i.scenes.length ? ` (модель: сц. ${i.scenes.slice(0, 6).join(', ')})` : ''}`}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <footer className="modal-foot">
        <button type="button" className="ibtn wide" onClick={close}>Ничего не добавлять</button>
        <button
          type="button"
          className="btn-accent"
          disabled={!picked.size}
          onClick={() => {
            let next = getBreakdown();
            for (const i of items) if (picked.has(key(i))) next = addItem(next, { id: nanoid(8), category: i.category, name: i.name });
            setBreakdown(next);
            actions.showToast(`В разбор добавлено: ${picked.size}. Смотрите вкладку «Разбор»`);
            close();
          }}
        >
          Добавить в разбор ({picked.size})
        </button>
      </footer>
    </>
  );
}

function ShotsResult({ answer, script, scene, close }: { answer: AiAnswer<{ shots: ProposedShot[] }>; script: ScriptElement; scene: SceneInfo; close: () => void }) {
  const shots = useMemo(() => checkShots(answer.data?.shots), [answer]);
  const [picked, setPicked] = useState(() => new Set(shots.map((_, i) => i)));
  const total = shots.filter((_, i) => picked.has(i)).reduce((sum, s) => sum + s.duration, 0);
  if (!shots.length) {
    return (
      <>
        <p>Модель не предложила кадров для этой сцены. Попробуйте ещё раз.</p>
        <footer className="modal-foot"><button type="button" className="btn-accent" onClick={close}>Закрыть</button></footer>
      </>
    );
  }
  return (
    <>
      <p>
        Сцена {scene.number}. {scene.heading}. Кадров: {picked.size}, примерно {total} с.
      </p>
      <ul className="ai-check-list" aria-label="Предложенные кадры">
        {shots.map((s, i) => (
          <li key={i}>
            <input
              type="checkbox"
              id={`ai-shot-${i}`}
              checked={picked.has(i)}
              onChange={() => setPicked((prev) => {
                const next = new Set(prev);
                if (next.has(i)) next.delete(i);
                else next.add(i);
                return next;
              })}
            />
            <label htmlFor={`ai-shot-${i}`} className="grow">
              <b>{[sizeShort(s.size), s.angle !== 'Нейтральный' ? s.angle : '', s.movement !== 'Статика' ? s.movement : '', s.lens].filter(Boolean).join(' · ') || 'Кадр'}</b>
              {s.duration ? <span className="sub"> · {s.duration} с</span> : null}
              <br />
              {s.description}
            </label>
          </li>
        ))}
      </ul>
      <p className="side-hint" style={{ padding: 0 }}>Кадры появятся на доске «Раскадровка · {script.title}» в ряду этой сцены, shot list на ней обновится. Всё отменяется одним ⌘Z.</p>
      <footer className="modal-foot">
        <button type="button" className="ibtn wide" onClick={close}>Не создавать</button>
        <button
          type="button"
          className="btn-accent"
          disabled={!picked.size}
          onClick={() => {
            const live = useStore.getState().elements[script.id];
            const target = (live?.type === 'SCRIPT' ? live : script) as ScriptElement;
            const boardId = asOneStep(() => placeShots(target, scene.number, shots.filter((_, i) => picked.has(i))));
            actions.showToast(boardId ? `Кадры сцены ${scene.number} добавлены в раскадровку — доска рядом со сценарием` : 'Не удалось создать кадры');
            close();
          }}
        >
          Создать кадры ({picked.size})
        </button>
      </footer>
    </>
  );
}
