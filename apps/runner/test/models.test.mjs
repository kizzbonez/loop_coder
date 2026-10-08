import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { adaptiveThinking, AgentStoppedError, anthropicModel, BudgetError, defaultFallbacks, ModelError, openaiModel, plainSchema } from '../src/models.mjs';

const tools = [{ name: 'read_file', description: 'Read a file', inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, note: { type: ['string', 'null'] }, mode: { anyOf: [{ type: 'string', enum: ['a', 'b'] }, { type: 'null' }] } }, required: ['path'] } }];

test('schemas are reduced to the subset every OpenAI-compatible provider accepts', () => {
  assert.deepEqual(plainSchema(tools[0].inputSchema), {
    type: 'object',
    properties: { path: { type: 'string' }, note: { type: 'string', nullable: true }, mode: { type: 'string', enum: ['a', 'b'], nullable: true } },
    required: ['path'],
  });
  assert.deepEqual(plainSchema({ type: 'object' }), { type: 'object', properties: {} });
});

test('which Claude models get adaptive thinking and default fallbacks', () => {
  assert.equal(adaptiveThinking('claude-opus-5-5'), true);
  assert.equal(adaptiveThinking('claude-sonnet-4-6'), true);
  assert.equal(adaptiveThinking('claude-haiku-4-5-20251001'), false);
  assert.equal(adaptiveThinking('claude-3-5-sonnet-latest'), false);
  assert.equal(defaultFallbacks('claude-opus-5-5'), true);
  assert.equal(defaultFallbacks('claude-fable-5-1'), true);
  assert.equal(defaultFallbacks('claude-sonnet-5-5'), true);
  assert.equal(defaultFallbacks('claude-haiku-4-5-20251001'), false);
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('OpenAI-compatible: tool calls out, tool results back, provider data on tool calls kept', async () => {
  const bodies = [];
  const replies = [
    json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"acme/shop/a"}' }, extra_content: { google: { thought_signature: 'sig' } } }, { id: '', type: 'function', function: { name: 'read_file', arguments: '{oops' } }] } }] }),
    json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Done.' } }] }),
  ];
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'http://api:3000/llm/agents/a1/chat/completions');
    assert.equal(init.headers.authorization, 'Bearer loop_agent_token');
    bodies.push(JSON.parse(init.body));
    return replies.shift();
  };
  const conv = openaiModel({ baseURL: 'http://api:3000/llm/agents/a1', token: 'loop_agent_token', model: 'gemini-3.8-flash', fetchImpl }).conversation('system text', 'do the step', tools);
  const first = await conv.next();
  assert.equal(first.stopReason, 'tool_use');
  assert.deepEqual(first.calls, [{ id: 'c1', name: 'read_file', input: { path: 'acme/shop/a' } }, { id: 'call_1', name: 'read_file', input: { __invalid_json: true } }]);
  conv.addResults([{ id: 'c1', text: 'contents', isError: false }, { id: 'call_1', text: 'bad args', isError: true }]);
  const second = await conv.next();
  assert.deepEqual(second, { calls: [], text: 'Done.', stopReason: 'end_turn' });
  assert.equal(bodies[0].model, 'gemini-3.8-flash');
  assert.equal(bodies[0].tools[0].function.parameters.additionalProperties, undefined);
  assert.deepEqual(bodies[0].messages.map((m) => m.role), ['system', 'user']);
  const sent = bodies[1].messages;
  assert.deepEqual(sent.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'tool']);
  assert.equal(sent[2].tool_calls[0].extra_content.google.thought_signature, 'sig');
  assert.equal(sent[2].tool_calls[1].id, 'call_1');
  assert.deepEqual(sent[4], { role: 'tool', tool_call_id: 'call_1', content: 'Error: bad args' });
});

test('OpenAI-compatible: relay refusals become typed errors; overloads are retried', async () => {
  const relayError = (status, type) => json({ type: 'error', error: { type, message: 'nope' } }, status);
  const make = (...replies) => openaiModel({ baseURL: 'http://x', token: 't', model: 'm', fetchImpl: async () => replies.shift(), sleep: async () => {} }).conversation('s', 'u', []);
  await assert.rejects(make(relayError(402, 'budget_exhausted')).next(), BudgetError);
  await assert.rejects(make(relayError(409, 'agent_stopped')).next(), AgentStoppedError);
  await assert.rejects(make(json([{ error: { code: 400, message: 'Invalid model' } }], 400)).next(), (err) => err instanceof ModelError && /400.*Invalid model/.test(err.message));
  const ok = await make(json({}, 503), json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hi' } }] })).next();
  assert.equal(ok.text, 'hi');
});

/** A fake relay for the Anthropic SDK. */
async function fakeRelay(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const request = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body || '{}') };
      requests.push(request);
      const [status, reply, headers = {}] = handler(request, requests.length);
      res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(reply));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/llm/agents/a1`, requests, close: () => server.close() };
}

test('Anthropic: official SDK through the relay, with adaptive thinking, caching and default fallbacks', async () => {
  const relay = await fakeRelay((req, n) =>
    n === 1
      ? [200, { id: 'm1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'acme/shop/a' } }], usage: { input_tokens: 10, output_tokens: 5 } }]
      : [200, { id: 'm2', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Moved it.' }], usage: { input_tokens: 10, output_tokens: 5 } }],
  );
  try {
    const conv = anthropicModel({ baseURL: relay.url, token: 'loop_agent_token', model: 'claude-opus-5-5' }).conversation('system text', 'do the step', tools);
    const first = await conv.next();
    assert.deepEqual(first.calls, [{ id: 'tu1', name: 'read_file', input: { path: 'acme/shop/a' } }]);
    conv.addResults([{ id: 'tu1', text: 'contents', isError: false }]);
    const second = await conv.next();
    assert.equal(second.text, 'Moved it.');
    const [r1, r2] = relay.requests;
    assert.equal(r1.url, '/llm/agents/a1/v1/messages?beta=true');
    assert.equal(r1.headers['x-api-key'], 'loop_agent_token');
    assert.match(r1.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(r1.body.fallbacks, 'default');
    assert.deepEqual(r1.body.thinking, { type: 'adaptive' });
    assert.deepEqual(r1.body.cache_control, { type: 'ephemeral' });
    assert.equal(r1.body.stream, undefined);
    assert.equal(r1.body.tools[0].input_schema.properties.path.type, 'string');
    // The whole assistant turn (thinking included) goes back, then one user message of results.
    assert.deepEqual(r2.body.messages[1].content.map((b) => b.type), ['thinking', 'tool_use']);
    assert.deepEqual(r2.body.messages[2].content, [{ type: 'tool_result', tool_use_id: 'tu1', content: 'contents' }]);
  } finally {
    relay.close();
  }
});

test('Anthropic: budget and stop come through as typed errors without retries', async () => {
  const relay = await fakeRelay(() => [402, { type: 'error', error: { type: 'budget_exhausted', message: 'Daily token limit reached' } }, { 'x-should-retry': 'false' }]);
  try {
    const conv = anthropicModel({ baseURL: relay.url, token: 't', model: 'claude-haiku-4-5-20251001' }).conversation('s', 'u', []);
    await assert.rejects(conv.next(), BudgetError);
    assert.equal(relay.requests.length, 1);
    assert.equal(relay.requests[0].url, '/llm/agents/a1/v1/messages');
    assert.equal(relay.requests[0].body.thinking, undefined);
  } finally {
    relay.close();
  }
});
