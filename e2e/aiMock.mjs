// Stands in for the AI providers in browser tests: the app sends its requests to
// same-origin /__ai paths (there is no key in a browser), and these routes answer
// in the shape the real APIs do. Nothing here calls a real model.

/** Server-sent events of one streamed message (the shape of POST /v1/messages with stream: true). */
export function sse({ text, thinking, toolUses = [], stop, model = 'claude-opus-5-5', inputTokens = 1200, outputTokens = 300 }) {
  const events = [];
  events.push({ type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
  let index = 0;
  if (thinking) {
    events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
    events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } });
    events.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'sig' } });
    events.push({ type: 'content_block_stop', index: index++ });
  }
  if (text !== undefined) {
    events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
    const half = Math.ceil(text.length / 2);
    for (const part of [text.slice(0, half), text.slice(half)]) if (part) events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } });
    events.push({ type: 'content_block_stop', index: index++ });
  }
  for (const tool of toolUses) {
    events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} } });
    events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } });
    events.push({ type: 'content_block_stop', index: index++ });
  }
  const stopReason = stop ?? (toolUses.length ? 'tool_use' : 'end_turn');
  events.push({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null, ...(stopReason === 'refusal' ? { stop_details: { type: 'refusal', category: 'bio', explanation: null } } : {}) }, usage: { output_tokens: outputTokens } });
  events.push({ type: 'message_stop' });
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

/** What the request asks for, from its answer schema. */
export const wants = (body) => Object.keys(body.output_config?.format?.schema?.properties ?? {})[0] ?? 'text';

/** The text of the last user turn (the ask), and everything the request carries as one string. */
export const lastUserText = (body) => {
  const last = [...body.messages].reverse().find((m) => m.role === 'user');
  return typeof last.content === 'string' ? last.content : last.content.map((b) => b.text ?? '').join('\n');
};

/**
 * Routes the app's AI requests. `answer(body, n)` returns what the model says for
 * a Messages request: {text}, {json}, {toolUses}, {stop}, or {status, error}.
 * Returns the list of requests seen, for assertions.
 */
export async function mockAi(page, { keys = { anthropic: true, openai: true }, answer, image } = {}) {
  const seen = { messages: [], counts: [], images: [], keys };
  await page.route('**/__ai/status', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(seen.keys) }));
  await page.route('**/__ai/anthropic/v1/models**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'claude-opus-5-5', type: 'model', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-opus-5-5' }) }));
  await page.route('**/__ai/anthropic/v1/messages/count_tokens**', (route) => {
    const body = route.request().postDataJSON();
    seen.counts.push(body);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ input_tokens: Math.round(JSON.stringify(body.messages).length / 2) }) });
  });
  await page.route(/\/__ai\/anthropic\/v1\/messages(\?.*)?$/, async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    seen.messages.push({ body, headers: request.headers() });
    const reply = (await answer?.(body, seen.messages.length)) ?? { text: 'Готово.' };
    if (reply.status) return route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: reply.error ?? { type: 'api_error', message: 'failed' } }) });
    if (reply.delay) await new Promise((r) => setTimeout(r, reply.delay));
    route.fulfill({ contentType: 'text/event-stream', body: sse({ ...reply, text: reply.json !== undefined ? JSON.stringify(reply.json) : reply.text }) });
  });
  await page.route('**/__ai/openai/image', async (route) => {
    const body = route.request().postDataJSON();
    seen.images.push(body);
    const reply = await image?.(body);
    if (!reply) return route.fulfill({ status: 500, body: 'no image' });
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ b64_json: reply }) });
  });
  return seen;
}
