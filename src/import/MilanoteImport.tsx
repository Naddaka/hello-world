import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { actions } from '../model/store';
import { isTauri } from '../storage/repo';
import exporterSource from './milanoteExporter.js?raw';
import { isMilanoteExport, type ImportReport, type MilanoteExport } from './milanote';
import { existingImports, importMilanote, refreshMilanoteIcons, type ImportProgress } from './runImport';
import type { IconRefreshPlan } from './milanoteIcons';

export const useImportDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openMilanoteImport = () => useImportDialog.setState({ open: true });

/** The text to paste into the browser console on app.milanote.com. */
export const consoleScript = () => `(${exporterSource.trim()})({});`;

type Step =
  | { kind: 'start' }
  | { kind: 'exporting'; text: string }
  | { kind: 'confirm'; data: MilanoteExport }
  | { kind: 'importing'; progress: ImportProgress }
  | { kind: 'done'; report: ImportReport; rootId: string }
  | { kind: 'icons-done'; result: IconRefreshPlan & { updated: number } }
  | { kind: 'error'; message: string };

function parseExport(text: string): MilanoteExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Это не файл экспорта Milanote: не удалось прочитать JSON.');
  }
  if (!isMilanoteExport(data)) throw new Error('В файле нет данных экспорта Milanote. Нужен milanote-export.json, сохранённый скриптом.');
  return data;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`;
};

export function MilanoteImportDialog() {
  const open = useImportDialog((s) => s.open);
  const [step, setStep] = useState<Step>({ kind: 'start' });
  const [windowOpen, setWindowOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const iconsFile = useRef<HTMLInputElement>(null);
  const [replaceIcons, setReplaceIcons] = useState(false);
  const desktop = isTauri();

  // Messages from the export script running in the Milanote window.
  useEffect(() => {
    if (!open || !desktop) return;
    let unlisten: (() => void) | undefined;
    let alive = true;
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<{ kind: string; data: string }>('milanote-export', async ({ payload }) => {
        if (payload.kind === 'closed') {
          setWindowOpen(false);
          // Closed in the middle of an export: say so instead of waiting forever.
          setStep((s) => (s.kind === 'exporting' ? { kind: 'error', message: 'Окно Milanote закрыто до конца экспорта. Откройте его снова и запустите импорт.' } : s));
        } else if (payload.kind === 'progress') setStep({ kind: 'exporting', text: payload.data });
        else if (payload.kind === 'error') setStep({ kind: 'error', message: payload.data });
        else if (payload.kind === 'done') {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const data = parseExport(await invoke<string>('milanote_read_export'));
            void invoke('milanote_close');
            setStep({ kind: 'confirm', data });
          } catch (error) {
            setStep({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
          }
        }
      }).then((fn) => (alive ? (unlisten = fn) : fn())),
    );
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [open, desktop]);

  if (!open) return null;
  const busy = step.kind === 'exporting' || step.kind === 'importing';
  const close = () => {
    if (busy) return;
    useImportDialog.setState({ open: false });
    setStep({ kind: 'start' });
  };

  const openWindow = async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('milanote_open');
      setWindowOpen(true);
    } catch (error) {
      setStep({ kind: 'error', message: `Не удалось открыть окно Milanote: ${error}` });
    }
  };
  const runExport = async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    setStep({ kind: 'exporting', text: 'Запускаю…' });
    try {
      await invoke('milanote_run', { script: exporterSource });
    } catch (error) {
      setStep({ kind: 'error', message: String(error) });
    }
  };
  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(consoleScript());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setStep({ kind: 'error', message: 'Не удалось скопировать скрипт в буфер обмена.' });
    }
  };
  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setStep({ kind: 'confirm', data: parseExport(await file.text()) });
    } catch (error) {
      setStep({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
  /** Board icons only, from the export saved by the last import (or a chosen file). */
  const refreshIcons = async (file?: File) => {
    setStep({ kind: 'importing', progress: { phase: 'media', done: 0, total: 0 } });
    try {
      let text: string;
      if (file) text = await file.text();
      else {
        const { invoke } = await import('@tauri-apps/api/core');
        text = await invoke<string>('milanote_read_export');
      }
      const result = await refreshMilanoteIcons(parseExport(text), replaceIcons, (progress) => setStep({ kind: 'importing', progress }));
      setStep({ kind: 'icons-done', result });
    } catch (error) {
      setStep({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
  const runImport = async (data: MilanoteExport) => {
    setStep({ kind: 'importing', progress: { phase: 'media', done: 0, total: 0 } });
    try {
      const { report, rootId } = await importMilanote(data, (progress) => setStep({ kind: 'importing', progress }));
      setStep({ kind: 'done', report, rootId });
    } catch (error) {
      console.error(error);
      setStep({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal panel" role="dialog" aria-modal="true" aria-labelledby="mn-title" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <header className="modal-head">
          <h2 id="mn-title">Импорт из Milanote</h2>
          {!busy && (
            <button type="button" className="ibtn" aria-label="Закрыть" onClick={close}>
              ✕
            </button>
          )}
        </header>

        {step.kind === 'start' && (
          <div className="modal-body">
            <p>
              Перенесу все ваши доски с раскладкой: заметки с форматированием, колонки, задачи, изображения, файлы, ссылки, линии, таблицы,
              комментарии и метки. Файлы скачиваются к вам на компьютер. В Milanote ничего не меняется — импорт только читает.
            </p>
            {desktop && (
              <ol className="mn-steps">
                <li>
                  <button type="button" className="btn-accent" onClick={() => void openWindow()}>
                    Открыть Milanote
                  </button>
                  <span>и войдите в свой аккаунт в открывшемся окне.</span>
                </li>
                <li>
                  <button type="button" className="btn-accent" disabled={!windowOpen} onClick={() => void runExport()}>
                    Начать импорт
                  </button>
                  <span>когда увидите свои доски.</span>
                </li>
              </ol>
            )}
            <details className="mn-alt" open={!desktop}>
              <summary>{desktop ? 'Если окно не пускает (например, вход через Google)' : 'Как получить файл экспорта'}</summary>
              <ol>
                <li>
                  Откройте <b>app.milanote.com</b> в Chrome или Safari и войдите.
                </li>
                <li>Откройте консоль разработчика: ⌥⌘J в Chrome, ⌥⌘C в Safari (в Safari сначала включите меню «Разработка» в настройках).</li>
                <li>
                  <button type="button" className="link-btn" onClick={() => void copyScript()}>
                    {copied ? 'Скопировано ✓' : 'Скопировать скрипт'}
                  </button>
                  , вставьте его в консоль и нажмите Enter. Chrome может попросить сначала набрать <code>allow pasting</code>.
                </li>
                <li>Когда браузер сохранит milanote-export.json, выберите этот файл:</li>
              </ol>
              <button type="button" className="mn-file" onClick={() => fileInput.current?.click()}>
                Выбрать файл экспорта…
              </button>
              <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
            </details>
            <div className="mn-alt mn-icons">
              <p>
                <b>Уже импортировали?</b> Можно обновить только иконки досок — без входа в Milanote и без повторного импорта. Названия, цвета, содержимое и расположение
                не меняются.
              </p>
              <label className="mn-check">
                <input type="checkbox" checked={replaceIcons} onChange={(e) => setReplaceIcons(e.target.checked)} /> Заменить и иконки, которые уже стоят (в том числе
                выбранные вручную)
              </label>
              <div className="mn-icons-actions">
                {desktop && (
                  <button type="button" className="ibtn wide" onClick={() => void refreshIcons()}>
                    Обновить иконки досок
                  </button>
                )}
                <button type="button" className="link-btn" onClick={() => iconsFile.current?.click()}>
                  {desktop ? 'Из другого файла экспорта…' : 'Обновить иконки из файла экспорта…'}
                </button>
              </div>
              <input
                ref={iconsFile}
                type="file"
                accept=".json,application/json"
                hidden
                aria-label="Файл экспорта для иконок"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void refreshIcons(f);
                }}
              />
            </div>
          </div>
        )}

        {step.kind === 'exporting' && (
          <div className="modal-body">
            <p className="mn-progress-text">{step.text}</p>
            <div className="mn-bar indeterminate" />
            <p className="side-hint" style={{ padding: 0 }}>
              Читаю доски в окне Milanote. Не закрывайте его.
            </p>
          </div>
        )}

        {step.kind === 'confirm' && (
          <div className="modal-body">
            <p>
              Нашлось {plural(Object.keys(step.data.elements).length, 'элемент', 'элемента', 'элементов')} на{' '}
              {plural(step.data.boardCount ?? 0, 'доске', 'досках', 'досках')}.
              {step.data.errors?.length ? ` Не удалось получить досок: ${step.data.errors.length} — подробности будут в отчёте.` : ''}
            </p>
            <p>Всё появится на главной доске как доска «Milanote». Сначала скачаю файлы — это может занять время.</p>
            <ExistingImports data={step.data} />
            <footer className="modal-foot">
              <button type="button" className="ibtn wide" onClick={() => setStep({ kind: 'start' })}>
                Назад
              </button>
              <button type="button" className="btn-accent" onClick={() => void runImport(step.data)}>
                Импортировать
              </button>
            </footer>
          </div>
        )}

        {step.kind === 'importing' && (
          <div className="modal-body">
            <p className="mn-progress-text">
              {step.progress.phase === 'saving'
                ? 'Сохраняю доски…'
                : step.progress.total
                  ? `Скачиваю файлы: ${step.progress.done} из ${step.progress.total}`
                  : 'Готовлю…'}
            </p>
            <div className="mn-bar">
              <div style={{ width: `${step.progress.total ? Math.round((step.progress.done / step.progress.total) * 100) : 100}%` }} />
            </div>
            {step.progress.current && step.progress.phase === 'media' && <p className="side-hint mn-current">{step.progress.current}</p>}
          </div>
        )}

        {step.kind === 'done' && <ImportDone report={step.report} rootId={step.rootId} onClose={close} />}

        {step.kind === 'icons-done' && (
          <div className="modal-body">
            <p>
              {step.result.updated ? `Иконки обновлены у ${plural(step.result.updated, 'доски', 'досок', 'досок')}.` : 'Менять было нечего.'} Отменить можно одним ⌘Z.
            </p>
            <IconSummary icons={step.result} />
            {step.result.kept > 0 && <p className="side-hint mn-note">Оставил как есть — у доски уже была иконка: {step.result.kept}.</p>}
            {step.result.absent > 0 && <p className="side-hint mn-note">Нет в Zadum (не импортированы или удалены): {step.result.absent}.</p>}
            <footer className="modal-foot">
              <button type="button" className="btn-accent" onClick={close}>
                Готово
              </button>
            </footer>
          </div>
        )}

        {step.kind === 'error' && (
          <div className="modal-body">
            <p className="mn-warn">{step.message}</p>
            <footer className="modal-foot">
              <button type="button" className="btn-accent" onClick={() => setStep({ kind: 'start' })}>
                Назад
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}

function ExistingImports({ data }: { data: MilanoteExport }) {
  const { same, others } = existingImports(data);
  return (
    <>
      {same && (
        <p className="mn-warn">
          Предыдущий импорт этого аккаунта (доска «{same.type === 'BOARD' ? same.title : 'Milanote'}» со всем содержимым) будет заменён свежей копией. Всё, что вы перенесли с этой доски в другие места, останется как есть.
        </p>
      )}
      {others.length > 0 && <p className="side-hint mn-note">На главной уже есть импорт другого аккаунта Milanote — он останется, новая доска появится рядом.</p>}
    </>
  );
}

/** How the board icons came over: exactly, by meaning, or not at all (with the shapes we did not know). */
function IconSummary({ icons }: { icons: { exact: number; approx: number; missing: number; shapes: string[] } }) {
  if (icons.exact + icons.approx + icons.missing === 0) return null;
  const parts = [`точно — ${icons.exact}`, ...(icons.approx ? [`подобрано по смыслу — ${icons.approx}`] : []), ...(icons.missing ? [`без иконки — ${icons.missing}`] : [])];
  return (
    <p className="side-hint mn-note">
      Иконки досок: {parts.join(', ')}
      {icons.missing > 0 && icons.shapes.length > 0 && <> ({icons.shapes.join('; ')})</>}.
    </p>
  );
}

function ImportDone({ report, rootId, onClose }: { report: ImportReport; rootId: string; onClose: () => void }) {
  const rows: [string, number][] = [
    ['Доски', report.boards],
    ['Заметки', report.cards],
    ['Изображения и рисунки', report.images],
    ['Файлы', report.files],
    ['Ссылки', report.links],
    ['Другое (колонки, задачи, линии, таблицы…)', report.other],
  ];
  return (
    <div className="modal-body">
      <p>Готово. Вот что перенесено:</p>
      <table className="mn-report">
        <tbody>
          {rows.map(([label, n]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.trashed > 0 && <p className="side-hint mn-note">Из корзины Milanote не переносил: {report.trashed}.</p>}
      {report.orphans > 0 && <p className="side-hint mn-note">Без своей доски оказалось {report.orphans} — они в «Неразобранном» доски «Milanote».</p>}
      <IconSummary icons={report.icons} />
      {report.unknownTypes.length > 0 && <p className="side-hint mn-note">Незнакомые типы (вместо них — заметки с пометкой): {report.unknownTypes.join(', ')}.</p>}
      {report.exportErrors.length > 0 && <p className="mn-warn">Milanote не отдал досок: {report.exportErrors.length}. Попробуйте импорт ещё раз позже.</p>}
      {report.failedMedia.length > 0 && (
        <details className="mn-alt">
          <summary className="mn-warn">Не удалось скачать файлов: {report.failedMedia.length} (вместо них — ссылки на оригиналы)</summary>
          <ul className="mn-failed">
            {report.failedMedia.slice(0, 200).map((f, i) => (
              <li key={i} title={f.url}>
                {f.name}
              </li>
            ))}
          </ul>
        </details>
      )}
      <footer className="modal-foot">
        <button type="button" className="ibtn wide" onClick={onClose}>
          Закрыть
        </button>
        <button
          type="button"
          className="btn-accent"
          onClick={() => {
            onClose();
            actions.openBoard(rootId);
          }}
        >
          Открыть доску «Milanote»
        </button>
      </footer>
    </div>
  );
}
