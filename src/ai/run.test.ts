import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiError, ask, estimate, roughTokens } from './run';
import { costOf, money, setAiSettings, useAiSettings } from './settings';
import { fakeStream, type FakeAnswer } from './testing';

/** Stands in for the API: records each request and answers from a queue. */
function fakeApi(answers: (FakeAnswer | Response)[]) {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
      requests.push({ url: String(input), headers, body: JSON.parse(String(init?.body ?? '{}')) });
      const next = answers.shift();
      if (next instanceof Response) return next;
      if (String(input).includes('count_tokens')) return new Response(JSON.stringify({ input_tokens: 54321 }), { headers: { 'content-type': 'application/json' } });
      return new Response(fakeStream(next ?? { text: 'ок' }), { headers: { 'content-type': 'text/event-stream' } });
    }),
  );
  return requests;
}

beforeEach(() => setAiSettings({ model: 'claude-opus-5-5', effort: 'medium', spent: 0 }));
afterEach(() => vi.unstubAllGlobals());

describe('asking Claude', () => {
  it('sends the request without credentials, with caching, effort and a fallback for declined requests', async () => {
    const requests = fakeApi([{ text: 'Привет', thinking: 'думаю', inputTokens: 1000, outputTokens: 500 }]);
    const seen: string[] = [];
    const answer = await ask({ system: 'Ты редактор.', context: 'СЦЕНАРИЙ', prompt: 'Что скажешь?' }, { onText: (s) => seen.push(s) });
    expect(answer.text).toBe('Привет');
    expect(seen.at(-1)).toBe('Привет');
    const { url, headers, body } = requests[0];
    expect(url).toMatch(/^\/__ai\/anthropic\/v1\/messages(\?beta=true)?$/);
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(body).toMatchObject({ model: 'claude-opus-5-5', stream: true, fallbacks: 'default', thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'medium' } });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('tool_choice');
    const content = (body.messages as { content: { text: string; cache_control?: unknown }[] }[])[0].content;
    expect(content[0]).toMatchObject({ text: 'СЦЕНАРИЙ', cache_control: { type: 'ephemeral' } });
    expect(content[1]).toMatchObject({ text: 'Что скажешь?' });
    // 1000 in × $4 + 500 out × $20, per million.
    expect(answer.cost).toBeCloseTo(0.014, 5);
    expect(useAiSettings.getState().spent).toBeCloseTo(0.014, 5);
  });

  it('asks for a schema answer and parses it', async () => {
    const requests = fakeApi([{ text: '{"items":[{"name":"нож"}]}' }]);
    const schema = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } } }, required: ['items'], additionalProperties: false };
    const answer = await ask<{ items: { name: string }[] }>({ system: 's', prompt: 'p', schema });
    expect(answer.data.items[0].name).toBe('нож');
    expect(requests[0].body.output_config).toMatchObject({ format: { type: 'json_schema', schema } });
  });

  it('does not ask for a fallback on a model that has none', async () => {
    setAiSettings({ model: 'claude-haiku-5-5' });
    const requests = fakeApi([{ text: 'ок', model: 'claude-haiku-5-5' }]);
    await ask({ system: 's', prompt: 'p' });
    expect(requests[0].body).not.toHaveProperty('fallbacks');
    expect(requests[0].headers['anthropic-beta'] ?? '').not.toContain('fallback');
  });

  it('reports a refusal, a wrong key and a cut-off schema answer in plain words', async () => {
    fakeApi([{ text: '', stopReason: 'refusal' }]);
    await expect(ask({ system: 's', prompt: 'p' })).rejects.toMatchObject({ kind: 'refusal', message: expect.stringContaining('отказалась') });
    fakeApi([new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } })]);
    await expect(ask({ system: 's', prompt: 'p' })).rejects.toMatchObject({ kind: 'auth' });
    fakeApi([{ text: '{"items":[', stopReason: 'max_tokens' }]);
    const error = await ask({ system: 's', prompt: 'p', schema: { type: 'object' } }).catch((e) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error.kind).toBe('too-long');
  });

  it('stops when asked to', async () => {
    fakeApi([{ text: 'поздно' }]);
    const controller = new AbortController();
    controller.abort();
    await expect(ask({ system: 's', prompt: 'p' }, { signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('counts tokens through the API and prices them', async () => {
    const requests = fakeApi([]);
    const { tokens, cost } = await estimate({ system: 's', context: 'текст', prompt: 'p' });
    expect(tokens).toBe(54321);
    expect(cost).toBeCloseTo(0.217284, 5);
    expect(requests[0].url).toContain('/v1/messages/count_tokens');
    expect(requests[0].body).not.toHaveProperty('max_tokens');
  });

  it('prices answers and shows money simply', () => {
    expect(costOf('claude-opus-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.4);
    expect(costOf('claude-haiku-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(0.6);
    expect(money(0.001)).toBe('меньше цента');
    expect(money(0.234)).toBe('≈ $0.23');
    expect(roughTokens('привет мир')).toBeGreaterThan(roughTokens('hello mir'));
  });
});
