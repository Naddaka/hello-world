import { isTauri } from '../storage/repo';

/**
 * How requests to AI providers leave the app. The web view never holds an API
 * key: in the desktop app a request goes to the Rust side, which adds the key
 * from the keychain and talks to the provider's host; the answer is streamed
 * back over a channel. In a browser there is no keychain: requests go to
 * same-origin paths under /__ai (a development or test server may answer them;
 * otherwise AI is simply unavailable).
 */

export interface KeyStatus {
  anthropic: boolean;
  openai: boolean;
}

type ProxyEvent =
  | { type: 'head'; status: number; headers: Record<string, string> }
  | { type: 'chunk'; text: string }
  | { type: 'end' }
  | { type: 'error'; message: string };

/** Thrown before any request is made: there is no key for the provider. */
export class NoKeyError extends Error {
  constructor(public provider: 'anthropic' | 'openai') {
    super(provider === 'anthropic' ? 'Не задан ключ API Anthropic' : 'Не задан ключ API OpenAI');
    this.name = 'NoKeyError';
  }
}

const abortError = () => new DOMException('Запрос остановлен', 'AbortError');

function headersOf(init: RequestInit | undefined, input: RequestInfo | URL): Record<string, string> {
  const out: Record<string, string> = {};
  const source = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  source.forEach((value, name) => {
    // Credentials never travel from the page; the native side adds the real key.
    if (name !== 'x-api-key' && name !== 'authorization') out[name] = value;
  });
  return out;
}

async function desktopFetch(path: string, method: string, headers: Record<string, string>, body: string | undefined, signal: AbortSignal | null | undefined): Promise<Response> {
  const { invoke, Channel } = await import('@tauri-apps/api/core');
  if (signal?.aborted) throw abortError();
  const id = crypto.randomUUID();
  const encoder = new TextEncoder();
  return new Promise<Response>((resolve, reject) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let started = false;
    let finished = false;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
      },
      cancel: () => {
        finished = true;
        void invoke('ai_cancel', { id });
      },
    });
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      if (started) controller.error(error);
      else reject(error);
    };
    const onAbort = () => {
      void invoke('ai_cancel', { id });
      fail(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const channel = new Channel<ProxyEvent>();
    channel.onmessage = (event) => {
      if (finished) return;
      if (event.type === 'head') {
        started = true;
        // 204/304 responses must not carry a body.
        resolve(new Response([204, 205, 304].includes(event.status) ? null : stream, { status: event.status, headers: event.headers }));
      } else if (event.type === 'chunk') controller.enqueue(encoder.encode(event.text));
      else if (event.type === 'end') {
        finished = true;
        signal?.removeEventListener('abort', onAbort);
        controller.close();
      } else {
        signal?.removeEventListener('abort', onAbort);
        fail(event.message === 'CANCELLED' ? abortError() : event.message === 'NO_KEY' ? new NoKeyError('anthropic') : new TypeError(event.message));
      }
    };
    invoke('ai_fetch', { id, method, path, headers, body: body ?? null, onEvent: channel }).catch((error) => fail(String(error) === 'NO_KEY' ? new NoKeyError('anthropic') : new TypeError(String(error))));
  });
}

/** The `fetch` the Anthropic SDK uses: same requests, sent through the app instead of from the page. */
export const anthropicFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = headersOf(init, input);
  const raw = init?.body;
  const body = raw == null ? undefined : typeof raw === 'string' ? raw : await new Response(raw as BodyInit).text();
  const path = url.pathname + url.search;
  if (isTauri()) return desktopFetch(path, method, headers, body, init?.signal);
  return fetch(`/__ai/anthropic${path}`, { method, headers, body, signal: init?.signal });
};

/** Which providers have a key (never the keys themselves). */
export async function keyStatus(): Promise<KeyStatus> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<KeyStatus>('ai_key_status');
  }
  try {
    const response = await fetch('/__ai/status');
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return { anthropic: false, openai: false };
    const data = (await response.json()) as Partial<KeyStatus>;
    return { anthropic: !!data.anthropic, openai: !!data.openai };
  } catch {
    return { anthropic: false, openai: false };
  }
}

/** Saves a key in the keychain; an empty key removes it. Desktop only. */
export async function saveKey(provider: 'anthropic' | 'openai', key: string): Promise<void> {
  if (!isTauri()) throw new Error('Ключи хранятся в связке ключей macOS — это работает только в приложении Zadum.');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('ai_set_key', { provider, key });
}

export interface GeneratedImage {
  id: string;
  ext: string;
  width?: number | null;
  height?: number | null;
}

/** Generates a picture with OpenAI's image model and stores it in the media library. */
export async function generateImage(prompt: string, size: '1024x1024' | '1536x1024' | '1024x1536', model: string, quality: string): Promise<GeneratedImage> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      return await invoke<GeneratedImage>('ai_generate_image', { prompt, size, model, quality: quality || null });
    } catch (error) {
      if (String(error) === 'NO_KEY') throw new NoKeyError('openai');
      throw new Error(String(error));
    }
  }
  const response = await fetch('/__ai/openai/image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, size, model, quality }) });
  if (!response.ok) throw new Error(`Не удалось сгенерировать изображение (${response.status})`);
  const { b64_json } = (await response.json()) as { b64_json: string };
  const bytes = Uint8Array.from(atob(b64_json), (c) => c.charCodeAt(0));
  const { media } = await import('../storage/media');
  return (await media()).importFile(new File([bytes], 'кадр.png', { type: 'image/png' }));
}
