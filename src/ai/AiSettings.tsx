import { useEffect, useState } from 'react';
import { isTauri } from '../storage/repo';
import { IconSparkle } from '../ui/icons';
import { claude } from './client';
import { toAiError } from './run';
import { EFFORTS, MODELS, money, refreshKeys, setAiSettings, useAiSettings } from './settings';
import { saveKey } from './transport';

type Check = { state: 'idle' } | { state: 'busy' } | { state: 'ok'; text: string } | { state: 'bad'; text: string };

function KeyRow({ provider, label, placeholder, saved, hint }: { provider: 'anthropic' | 'openai'; label: string; placeholder: string; saved: boolean; hint: React.ReactNode }) {
  const [value, setValue] = useState('');
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const desktop = isTauri();

  const save = async (key: string) => {
    setCheck({ state: 'busy' });
    try {
      await saveKey(provider, key);
      setValue('');
      await refreshKeys();
      if (!key) return setCheck({ state: 'ok', text: 'Ключ удалён' });
      if (provider === 'openai') return setCheck({ state: 'ok', text: 'Ключ сохранён в связке ключей' });
      // A free request that only succeeds with a working key.
      await claude.models.list({ limit: 1 });
      setCheck({ state: 'ok', text: 'Ключ работает и сохранён в связке ключей' });
    } catch (error) {
      const e = toAiError(error);
      setCheck({ state: 'bad', text: e.kind === 'auth' ? 'Ключ сохранён, но Anthropic его не принял. Проверьте, что он скопирован целиком.' : e.message });
    }
  };
  const test = async () => {
    setCheck({ state: 'busy' });
    try {
      await claude.models.list({ limit: 1 });
      setCheck({ state: 'ok', text: 'Ключ работает' });
    } catch (error) {
      setCheck({ state: 'bad', text: toAiError(error).message });
    }
  };

  return (
    <section className="ai-key">
      <div className="ai-key-head">
        <b>{label}</b>
        <span className={`ai-key-state${saved ? ' on' : ''}`}>{saved ? 'ключ сохранён' : 'ключа нет'}</span>
      </div>
      <p className="side-hint" style={{ padding: 0 }}>{hint}</p>
      {desktop ? (
        <form
          className="ai-key-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void save(value.trim());
          }}
        >
          <input type="password" autoComplete="off" spellCheck={false} aria-label={`Ключ API ${label}`} placeholder={saved ? 'Вставьте новый ключ, чтобы заменить' : placeholder} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <button type="submit" className="btn-accent" disabled={!value.trim() || check.state === 'busy'}>Сохранить</button>
          {saved && provider === 'anthropic' && <button type="button" className="ibtn wide" disabled={check.state === 'busy'} onClick={() => void test()}>Проверить</button>}
          {saved && <button type="button" className="link-btn" disabled={check.state === 'busy'} onClick={() => void save('')}>Удалить</button>}
        </form>
      ) : (
        <p className="mn-warn">Ключи хранятся в связке ключей macOS, поэтому ИИ работает только в приложении Zadum, не в браузере.</p>
      )}
      {check.state === 'busy' && <p className="ai-wait">Проверяю…</p>}
      {check.state === 'ok' && <p className="ai-ok" role="status">{check.text}</p>}
      {check.state === 'bad' && <p className="mn-warn" role="alert">{check.text}</p>}
    </section>
  );
}

/** Keys, the model and how thorough it is; what is sent where. */
export function AiSettingsDialog() {
  const { settingsOpen, keys, model, effort, imageModel, imageQuality, spent } = useAiSettings();
  useEffect(() => {
    if (settingsOpen) void refreshKeys();
  }, [settingsOpen]);
  if (!settingsOpen) return null;
  const close = () => useAiSettings.setState({ settingsOpen: false });
  return (
    <div className="modal-backdrop ai-settings-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal panel ai-settings" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <header className="modal-head">
          <h2 id="ai-settings-title"><IconSparkle size={17} /> Настройки ИИ</h2>
          <button type="button" className="ibtn" aria-label="Закрыть" onClick={close}>✕</button>
        </header>
        <div className="modal-body">
          <p>
            ИИ работает через ваш собственный ключ API: вы платите провайдеру по факту, обычно центы за запрос. Zadum отправляет только то, что вы сами
            выбрали в действии ИИ, и только этому провайдеру. Всё остальное остаётся на компьютере.
          </p>
          <KeyRow
            provider="anthropic"
            label="Anthropic (Claude)"
            placeholder="sk-ant-…"
            saved={!!keys?.anthropic}
            hint={<>Текст и разбор картинок: сценарии, доски, заметки. Ключ создаётся на console.anthropic.com → API Keys (это не подписка Claude Pro, а отдельный счёт).</>}
          />
          <KeyRow
            provider="openai"
            label="OpenAI (картинки)"
            placeholder="sk-…"
            saved={!!keys?.openai}
            hint={<>Нужен только для генерации кадров раскадровки по описанию. Ключ создаётся на platform.openai.com → API keys.</>}
          />

          <section className="ai-key">
            <div className="ai-key-head"><b>Модель Claude</b></div>
            <div className="ai-models" role="radiogroup" aria-label="Модель Claude">
              {MODELS.map((m) => (
                <label key={m.id} className={`ai-model${model === m.id ? ' on' : ''}`}>
                  <input type="radio" name="ai-model" checked={model === m.id} onChange={() => setAiSettings({ model: m.id })} />
                  <span>
                    <b>{m.label}</b>
                    <small>{m.hint}. ${m.input} / ${m.output} за млн токенов (чтение / ответ)</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="ai-row">
              <span>Тщательность</span>
              <span className="sp-tabs" style={{ padding: 0, position: 'static', background: 'transparent' }} role="radiogroup" aria-label="Тщательность">
                {EFFORTS.map((e) => (
                  <button key={e.id} type="button" role="radio" aria-checked={effort === e.id} className={effort === e.id ? 'on' : ''} title={e.hint} onClick={() => setAiSettings({ effort: e.id })}>
                    {e.label}
                  </button>
                ))}
              </span>
            </div>
          </section>

          <section className="ai-key">
            <div className="ai-key-head"><b>Генерация кадров</b></div>
            <div className="ai-row">
              <label htmlFor="ai-image-model">Модель OpenAI</label>
              <input id="ai-image-model" value={imageModel} spellCheck={false} onChange={(e) => setAiSettings({ imageModel: e.target.value.trim() })} onKeyDown={(e) => e.stopPropagation()} />
            </div>
            <div className="ai-row">
              <label htmlFor="ai-image-quality">Качество</label>
              <select id="ai-image-quality" value={imageQuality} onChange={(e) => setAiSettings({ imageQuality: e.target.value })}>
                <option value="low">Черновое (дешевле)</option>
                <option value="medium">Среднее</option>
                <option value="high">Высокое (дороже)</option>
              </select>
            </div>
            <p className="side-hint" style={{ padding: 0 }}>Название модели можно поменять, если OpenAI выпустит новую: оно берётся из их документации.</p>
          </section>

          <p className="ai-meta">
            Потрачено через Zadum на Claude: {spent < 0.005 ? '$0' : money(spent).replace('≈ ', '≈ ')}. Это оценка по ответам модели; точные цифры — в консоли провайдера.{' '}
            {spent >= 0.005 && <button type="button" className="link-btn" style={{ display: 'inline' }} onClick={() => setAiSettings({ spent: 0 })}>Сбросить счётчик</button>}
          </p>
          <footer className="modal-foot">
            <button type="button" className="btn-accent" onClick={close}>Готово</button>
          </footer>
        </div>
      </div>
    </div>
  );
}
