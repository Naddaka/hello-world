import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { IconSparkle } from '../ui/icons';
import { Markdown } from './MarkdownView';
import { AiError, ask, estimate, roughTokens, toAiError, type AiAnswer, type AiHooks, type AiRequest } from './run';
import { modelInfo, money, openAiSettings, refreshKeys, setAiSettings, useAiSettings } from './settings';

/**
 * One AI action from start to finish: say what will be sent (and roughly what
 * it costs), run it with a live view of the answer, then show the proposal.
 * Nothing in the app changes until the user accepts it in the result view.
 */

export interface AiJob<T> {
  title: string;
  /** What leaves the computer, in plain words: «сценарий „Маяк“ целиком». */
  sends: string;
  request: AiRequest;
  /** For jobs made of many requests (a batch of pictures): the rough total input, shown instead of counting `request`. */
  approxTokens?: number;
  /** A custom runner (an agent with tools); by default one question with `request`. */
  run?: (hooks: AiHooks & { onStatus: (status: string) => void }) => Promise<AiAnswer<T>>;
  /** The proposal with its own accept buttons. */
  Result: React.ComponentType<{ answer: AiAnswer<T>; close: () => void; retry: () => void }>;
  wide?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const useAiJob = create<{ job: AiJob<any> | null; run: number }>(() => ({ job: null, run: 0 }));

export function openAiJob<T>(job: AiJob<T>) {
  useAiJob.setState((s) => ({ job, run: s.run + 1 }));
}

/** Inputs larger than this are confirmed with their exact size and price first. */
const CONFIRM_TOKENS = 20_000;

type Phase =
  | { kind: 'checking' }
  | { kind: 'no-key' }
  | { kind: 'confirm'; tokens: number | null; cost: number | null }
  | { kind: 'running' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: 'result'; answer: AiAnswer<any> }
  | { kind: 'error'; error: AiError };

export function AiDialog() {
  const { job, run } = useAiJob();
  if (!job) return null;
  return <Job key={run} job={job} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Job({ job }: { job: AiJob<any> }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState('');
  const [status, setStatus] = useState('');
  const abort = useRef<AbortController | null>(null);
  const model = useAiSettings((s) => s.model);
  const settingsOpen = useAiSettings((s) => s.settingsOpen);

  const close = useCallback(() => {
    abort.current?.abort();
    useAiJob.setState({ job: null });
  }, []);

  const start = useCallback(async () => {
    setAiSettings({ consent: true });
    setText('');
    setThinking('');
    setStatus('');
    setPhase({ kind: 'running' });
    const controller = new AbortController();
    abort.current = controller;
    try {
      const hooks = { signal: controller.signal, onText: setText, onThinking: setThinking, onStatus: setStatus };
      const answer = job.run ? await job.run(hooks) : await ask(job.request, hooks);
      if (!controller.signal.aborted) setPhase({ kind: 'result', answer });
    } catch (e) {
      const error = toAiError(e);
      if (error.kind === 'cancelled') return useAiJob.setState({ job: null });
      setPhase(error.kind === 'no-key' ? { kind: 'no-key' } : { kind: 'error', error });
    }
  }, [job]);

  const prepare = useCallback(async () => {
    setPhase({ kind: 'checking' });
    const keys = await refreshKeys();
    if (!keys.anthropic) return setPhase({ kind: 'no-key' });
    const size = job.approxTokens ?? roughTokens(`${job.request.system}${job.request.context ?? ''}${job.request.prompt}`) + (job.request.images?.length ?? 0) * 1500;
    const first = !useAiSettings.getState().consent;
    if (!first && size < CONFIRM_TOKENS) return void start();
    if (size < CONFIRM_TOKENS) return setPhase({ kind: 'confirm', tokens: null, cost: null });
    if (job.approxTokens) return setPhase({ kind: 'confirm', tokens: job.approxTokens, cost: (job.approxTokens * modelInfo(useAiSettings.getState().model).input) / 1_000_000 });
    try {
      const counted = await estimate(job.request);
      setPhase({ kind: 'confirm', tokens: counted.tokens, cost: counted.cost });
    } catch (e) {
      const error = toAiError(e);
      setPhase(error.kind === 'no-key' ? { kind: 'no-key' } : { kind: 'error', error });
    }
  }, [job, start]);

  useEffect(() => {
    void prepare();
    return () => abort.current?.abort();
    // Once per opened job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from the settings with a key saved: carry on.
  const wasInSettings = useRef(false);
  useEffect(() => {
    if (settingsOpen) wasInSettings.current = true;
    else if (wasInSettings.current) {
      wasInSettings.current = false;
      if (phase.kind === 'no-key' || (phase.kind === 'error' && phase.error.kind === 'auth')) void prepare();
    }
  }, [settingsOpen, phase, prepare]);

  const busy = phase.kind === 'running';
  const Result = job.Result;
  return (
    <div className="modal-backdrop ai-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && phase.kind !== 'result' && close()}>
      <div className={`modal panel ai-dialog${job.wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="ai-title" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' && !busy) close(); }}>
        <header className="modal-head">
          <h2 id="ai-title"><IconSparkle size={17} /> {job.title}</h2>
          <button type="button" className="ibtn" aria-label="Закрыть" onClick={close}>✕</button>
        </header>

        {phase.kind === 'checking' && <div className="modal-body"><p className="ai-wait">Готовлю запрос…</p></div>}

        {phase.kind === 'no-key' && (
          <div className="modal-body">
            <p>Чтобы пользоваться ИИ, нужен ключ API Anthropic (Claude). Он хранится в связке ключей macOS и никуда, кроме Anthropic, не отправляется.</p>
            <footer className="modal-foot">
              <button type="button" className="ibtn wide" onClick={close}>Не сейчас</button>
              <button type="button" className="btn-accent" autoFocus onClick={openAiSettings}>Настройки ИИ…</button>
            </footer>
          </div>
        )}

        {phase.kind === 'confirm' && (
          <div className="modal-body">
            <p>В Anthropic (Claude) будет отправлено: <b>{job.sends}</b>. Больше ничего из приложения не уходит.</p>
            {phase.tokens !== null && phase.cost !== null && (
              <p className="ai-price">
                Объём: {job.approxTokens ? 'около ' : ''}{phase.tokens.toLocaleString('ru-RU')} токенов. Чтение обойдётся {money(phase.cost)}, плюс ответ. Модель: {modelInfo(model).label}.
              </p>
            )}
            <p className="side-hint" style={{ padding: 0 }}>Ответ появится как предложение — в приложении ничего не изменится, пока вы его не примете.</p>
            <footer className="modal-foot">
              <button type="button" className="ibtn wide" onClick={close}>Отмена</button>
              <button type="button" className="btn-accent" autoFocus onClick={() => void start()}>Отправить</button>
            </footer>
          </div>
        )}

        {phase.kind === 'running' && (
          <div className="modal-body">
            <p className="ai-sends">Отправлено: {job.sends}</p>
            {status && <p className="ai-status">{status}</p>}
            {!text && <p className="ai-wait">{thinking ? 'Думает…' : 'Жду ответа…'}</p>}
            {!text && thinking && <p className="ai-thinking">{thinking.slice(-320)}</p>}
            {text && (job.request.schema ? <p className="ai-wait">Пишет ответ… {text.length.toLocaleString('ru-RU')} знаков</p> : <Markdown text={text} className="ai-stream" />)}
            <footer className="modal-foot">
              <button type="button" className="ibtn wide" onClick={close}>Остановить</button>
            </footer>
          </div>
        )}

        {phase.kind === 'result' && (
          <div className="modal-body">
            <Result answer={phase.answer} close={close} retry={() => void start()} />
            <p className="ai-meta">
              {modelInfo(phase.answer.model).id === phase.answer.model ? modelInfo(phase.answer.model).label : phase.answer.model}
              {phase.answer.usedFallback ? ' (запасная модель: основная отказалась)' : ''} · {money(phase.answer.cost)}
              {phase.answer.truncated ? ' · ответ обрезан по длине' : ''}
            </p>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="modal-body">
            <p className="mn-warn" role="alert">{phase.error.message}</p>
            <footer className="modal-foot">
              <button type="button" className="ibtn wide" onClick={close}>Закрыть</button>
              {phase.error.kind === 'auth' && <button type="button" className="ibtn wide" onClick={openAiSettings}>Настройки ИИ…</button>}
              <button type="button" className="btn-accent" onClick={() => void prepare()}>Повторить</button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
