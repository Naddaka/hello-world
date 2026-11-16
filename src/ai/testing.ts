/**
 * Test helpers: answers in the shape the Claude API streams them, so tests can
 * stand in for the API (unit tests through `fetch`, browser tests through routes).
 */

export interface FakeAnswer {
  text?: string;
  thinking?: string;
  toolUses?: { id: string; name: string; input: unknown }[];
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** The server-sent events of one streamed message. */
export function fakeStream(answer: FakeAnswer): string {
  const events: unknown[] = [];
  const usage = { input_tokens: answer.inputTokens ?? 1000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  events.push({ type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: answer.model ?? 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage } });
  let index = 0;
  if (answer.thinking) {
    events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
    events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: answer.thinking } });
    events.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'sig' } });
    events.push({ type: 'content_block_stop', index: index++ });
  }
  if (answer.text !== undefined) {
    events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
    // Two deltas, cut in the middle, as the network would.
    const half = Math.ceil(answer.text.length / 2);
    for (const part of [answer.text.slice(0, half), answer.text.slice(half)]) if (part) events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } });
    events.push({ type: 'content_block_stop', index: index++ });
  }
  for (const tool of answer.toolUses ?? []) {
    events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} } });
    events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } });
    events.push({ type: 'content_block_stop', index: index++ });
  }
  const stop = answer.stopReason ?? (answer.toolUses?.length ? 'tool_use' : 'end_turn');
  events.push({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null, ...(stop === 'refusal' ? { stop_details: { type: 'refusal', category: 'bio', explanation: null } } : {}) }, usage: { output_tokens: answer.outputTokens ?? 200 } });
  events.push({ type: 'message_stop' });
  return events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}
