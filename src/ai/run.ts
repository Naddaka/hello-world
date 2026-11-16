import { Anthropic, claude } from './client';
import { costOf, modelInfo, setAiSettings, useAiSettings, type Effort, type Usage } from './settings';
import { NoKeyError } from './transport';

/**
 * One question to Claude: instructions, optional large material (cached, so
 * several actions on the same script or board cost less), the ask itself, and
 * optionally a JSON schema the answer must follow. Streams while it runs.
 */

export type AiErrorKind = 'no-key' | 'auth' | 'refusal' | 'rate' | 'overloaded' | 'network' | 'cancelled' | 'too-long' | 'bad-answer' | 'other';

export class AiError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface AiImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  /** Base64 without a data: prefix. */
  data: string;
}

export interface AiRequest {
  /** Who the model is here and how to answer; the same for every run of a feature. */
  system: string;
  /** Large stable material: the script, the text of a board. */
  context?: string;
  prompt: string;
  images?: AiImage[];
  /** JSON schema of the answer (objects need additionalProperties: false and every property required). */
  schema?: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
}

export interface AiHooks {
  signal?: AbortSignal;
  /** The answer so far (for a schema answer: the JSON so far). */
  onText?: (snapshot: string) => void;
  /** A summary of the model's reasoning so far. */
  onThinking?: (snapshot: string) => void;
}

export interface AiAnswer<T> {
  text: string;
  /** The parsed answer when a schema was given, otherwise null. */
  data: T;
  /** The model that answered (another one if the first declined and a fallback ran). */
  model: string;
  usage: Usage;
  /** US dollars. */
  cost: number;
  usedFallback: boolean;
  /** The answer hit the length limit and stops mid-way. */
  truncated: boolean;
}

const REFUSALS: Record<string, string> = {
  cyber: 'тема похожа на компьютерную безопасность',
  bio: 'тема похожа на опасную биологию',
  frontier_llm: 'запрос похож на разработку моделей ИИ',
  reasoning_extraction: 'запрос просит модель раскрыть ход рассуждений',
  general_harms: 'сработал общий фильтр безопасности',
};

/** Turns SDK and transport errors into messages for the user. */
export function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof NoKeyError) return new AiError('no-key', error.message);
  if (error instanceof Anthropic.APIUserAbortError || (error instanceof DOMException && error.name === 'AbortError')) return new AiError('cancelled', 'Остановлено');
  if (error instanceof Anthropic.AuthenticationError) return new AiError('auth', 'Ключ API не подошёл. Проверьте его в настройках ИИ.');
  if (error instanceof Anthropic.PermissionDeniedError) return new AiError('auth', 'У этого ключа нет доступа к выбранной модели. Выберите другую модель в настройках ИИ или проверьте ключ.');
  if (error instanceof Anthropic.NotFoundError) return new AiError('other', 'Выбранная модель недоступна для этого ключа. Выберите другую в настройках ИИ.');
  if (error instanceof Anthropic.RateLimitError) return new AiError('rate', 'Слишком много запросов или исчерпан лимит ключа. Подождите минуту и повторите.');
  if (error instanceof Anthropic.ContentTooLargeError) return new AiError('too-long', 'Слишком большой запрос. Попробуйте на меньшем фрагменте.');
  if (error instanceof Anthropic.BadRequestError) {
    const text = error.message;
    if (/credit balance|billing/i.test(text)) return new AiError('auth', 'На счёте ключа API закончились средства. Пополните баланс в консоли Anthropic.');
    if (/prompt is too long|too many tokens|context/i.test(text)) return new AiError('too-long', 'Текст не помещается в модель. Попробуйте на меньшем фрагменте.');
    return new AiError('other', `Запрос отклонён: ${text}`);
  }
  if (error instanceof Anthropic.InternalServerError) return new AiError('overloaded', 'Сервер ИИ сейчас перегружен. Повторите через минуту.');
  if (error instanceof Anthropic.APIConnectionError) {
    // The transport reports a missing key as the cause of a connection error.
    if (error.cause instanceof NoKeyError) return new AiError('no-key', error.cause.message);
    return new AiError('network', 'Нет связи с сервером ИИ. Проверьте интернет.');
  }
  if (error instanceof Anthropic.APIError) return new AiError('other', `Ошибка сервера ИИ (${error.status ?? '?'}): ${error.message}`);
  return new AiError('other', error instanceof Error ? error.message : String(error));
}

function userContent(request: AiRequest): Anthropic.Beta.BetaContentBlockParam[] {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  // The material goes first and is cached: the next action on the same script reads it at a tenth of the price.
  if (request.context) content.push({ type: 'text', text: request.context, cache_control: { type: 'ephemeral' } });
  for (const image of request.images ?? []) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
  content.push({ type: 'text', text: request.prompt });
  return content;
}

/** Parameters shared by every request: model, thoroughness, and a fallback model for declined requests. */
export function baseParams(effort?: Effort) {
  const settings = useAiSettings.getState();
  const info = modelInfo(settings.model);
  return {
    model: info.id,
    thinking: { type: 'adaptive' as const, display: 'summarized' as const },
    effort: effort ?? settings.effort,
    // If the model's safety filter declines a harmless request (medical or security topics can
    // trip it), the API retries it on the model Anthropic recommends, within the same call.
    ...(info.fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  };
}

export function refusalMessage(category: string | null | undefined): string {
  const why = category ? REFUSALS[category] : undefined;
  return `Модель отказалась выполнять этот запрос${why ? ` (${why})` : ''}. Попробуйте переформулировать или выбрать другую модель в настройках ИИ.`;
}

/** Adds what an answer cost to the running total shown in the settings. */
export function recordSpend(cost: number) {
  setAiSettings({ spent: useAiSettings.getState().spent + cost });
}

export async function ask<T = null>(request: AiRequest, hooks: AiHooks = {}): Promise<AiAnswer<T>> {
  const { effort, ...base } = baseParams(request.effort);
  try {
    const stream = claude.beta.messages.stream(
      {
        ...base,
        max_tokens: request.maxTokens ?? 32000,
        system: [{ type: 'text', text: request.system }],
        messages: [{ role: 'user', content: userContent(request) }],
        output_config: { effort, ...(request.schema ? { format: { type: 'json_schema' as const, schema: request.schema } } : {}) },
      },
      { signal: hooks.signal },
    );
    if (hooks.onText) stream.on('text', (_delta, snapshot) => hooks.onText!(snapshot));
    if (hooks.onThinking) stream.on('thinking', (_delta, snapshot) => hooks.onThinking!(snapshot));
    const message = await stream.finalMessage();
    const cost = costOf(message.model, message.usage);
    recordSpend(cost);
    if (message.stop_reason === 'refusal') throw new AiError('refusal', refusalMessage(message.stop_details?.category));
    const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    const truncated = message.stop_reason === 'max_tokens';
    let data = null as T;
    if (request.schema) {
      if (truncated) throw new AiError('too-long', 'Ответ не поместился. Попробуйте на меньшем фрагменте.');
      try {
        data = JSON.parse(text) as T;
      } catch {
        throw new AiError('bad-answer', 'Модель вернула ответ не в том виде. Повторите запрос.');
      }
    }
    return {
      text,
      data,
      model: message.model,
      usage: message.usage,
      cost,
      usedFallback: (message.usage.iterations ?? []).some((entry) => entry.type === 'fallback_message'),
      truncated,
    };
  } catch (error) {
    throw toAiError(error);
  }
}

/** How many tokens a request sends, counted by the API for the chosen model (free), and what that input costs. */
export async function estimate(request: AiRequest): Promise<{ tokens: number; cost: number }> {
  const { model } = baseParams();
  try {
    const counted = await claude.beta.messages.countTokens({
      model,
      system: [{ type: 'text', text: request.system }],
      messages: [{ role: 'user', content: userContent(request) }],
    });
    return { tokens: counted.input_tokens, cost: (counted.input_tokens * modelInfo(model).input) / 1_000_000 };
  } catch (error) {
    throw toAiError(error);
  }
}

/** A rough size of a text in tokens, only to decide whether to ask before sending (Cyrillic takes more tokens than Latin). */
export function roughTokens(text: string): number {
  const cyrillic = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  return Math.round(cyrillic / 2 + (text.length - cyrillic) / 3.5);
}
