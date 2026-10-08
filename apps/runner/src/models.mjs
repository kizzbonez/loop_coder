// Model adapters. Both talk to Loop Coder's model relay (never to a provider directly): it adds
// the provider's API key, enforces the agent's model and daily token limit, and counts usage.
import Anthropic from '@anthropic-ai/sdk';

export class BudgetError extends Error {}
export class AgentStoppedError extends Error {}
export class AuthError extends Error {}
export class ModelError extends Error {}

const MAX_TOKENS = 16_000;
const TIMEOUT_MS = 10 * 60_000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Claude models that take adaptive thinking (4.6 and later). */
export const adaptiveThinking = (model) => /^claude-(opus|sonnet|haiku|fable|mythos)-(4-[6-9]|[5-9])/.test(model);
/** Claude models with Anthropic's default refusal fallbacks. */
export const defaultFallbacks = (model) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);

/** The relay's own refusals, by status: they mean the same for both adapters. */
function relayError(status, type, message) {
  if (status === 402 || type === 'budget_exhausted') return new BudgetError(message || 'Daily token limit reached');
  if (status === 409 && type === 'agent_stopped') return new AgentStoppedError('The agent was stopped');
  if (status === 401) return new AuthError('The relay did not accept the agent’s token');
  return null;
}

/** Text of an assistant reply, for status lines and summaries. */
const short = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

// ---------------------------------------------------------------------------
// Anthropic (official SDK)
// ---------------------------------------------------------------------------

export function anthropicModel({ baseURL, token, model }) {
  const client = new Anthropic({ apiKey: token, baseURL, timeout: TIMEOUT_MS, maxRetries: 2 });
  let fallbacks = defaultFallbacks(model);

  async function create(params) {
    try {
      if (fallbacks) return await client.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' });
      return await client.messages.create(params);
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        const relay = relayError(err.status, err.error?.error?.type, err.error?.error?.message);
        if (relay) throw relay;
        if (fallbacks && err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
          fallbacks = false; // not offered for this model or account: carry on without
          return create(params);
        }
        throw new ModelError(`The model request failed (${err.status ?? 'network'}): ${short(err.error?.error?.message ?? err.message)}`);
      }
      throw new ModelError(`The model request failed: ${short(err.message)}`);
    }
  }

  return {
    conversation(system, firstMessage, tools) {
      const messages = [{ role: 'user', content: firstMessage }];
      const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
      return {
        async next() {
          const response = await create({
            model,
            max_tokens: MAX_TOKENS,
            system,
            messages,
            tools: toolDefs,
            // Automatic prompt caching: each turn re-reads the conversation so far from the cache.
            cache_control: { type: 'ephemeral' },
            ...(adaptiveThinking(model) ? { thinking: { type: 'adaptive' } } : {}),
          });
          // The whole reply goes back, thinking blocks included, as tool use requires.
          messages.push({ role: 'assistant', content: response.content });
          const calls = response.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));
          const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
          return { calls, text: short(text), stopReason: response.stop_reason };
        },
        addResults(results) {
          messages.push({
            role: 'user',
            content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.text || '(no output)', ...(r.isError ? { is_error: true } : {}) })),
          });
        },
        nudge(text) {
          messages.push({ role: 'user', content: text });
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat completions (OpenAI, Gemini, Qwen, Kimi, DeepSeek, OpenRouter, ...)
// ---------------------------------------------------------------------------

const SCHEMA_KEYS = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'nullable', 'anyOf']);

/**
 * A JSON schema in the plain subset every OpenAI-compatible provider accepts (some, like Gemini,
 * reject $schema, additionalProperties or type arrays).
 */
export function plainSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties') out.properties = Object.fromEntries(Object.entries(value ?? {}).map(([k, v]) => [k, plainSchema(v)]));
    else if (key === 'items') out.items = plainSchema(value);
    else if (key === 'anyOf') {
      const options = value.filter((o) => o?.type !== 'null');
      if (options.length < value.length) out.nullable = true;
      if (options.length === 1) Object.assign(out, plainSchema(options[0]));
      else out.anyOf = options.map(plainSchema);
    } else if (key === 'type' && Array.isArray(value)) {
      const types = value.filter((t) => t !== 'null');
      out.type = types[0] ?? 'string';
      if (types.length < value.length) out.nullable = true;
    } else out[key] = value;
  }
  if (out.type === 'object' && !out.properties) out.properties = {};
  return out;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

export function openaiModel({ baseURL, token, model, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  async function post(body) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt < 2) {
          await sleep(2000 * 2 ** attempt);
          continue;
        }
        throw new ModelError(`The model request failed: ${short(err.message)}`);
      }
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      if (res.ok && json) return json;
      const err = Array.isArray(json) ? json[0]?.error : json?.error;
      const relay = relayError(res.status, err?.type, err?.message);
      if (relay) throw relay;
      if (RETRYABLE.has(res.status) && attempt < 2) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      throw new ModelError(`The model request failed (${res.status}): ${short(err?.message ?? text)}`);
    }
  }

  return {
    conversation(system, firstMessage, tools) {
      const messages = [
        { role: 'system', content: system },
        { role: 'user', content: firstMessage },
      ];
      const toolDefs = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: plainSchema(t.inputSchema) } }));
      let counter = 0;
      return {
        async next() {
          const json = await post({ model, messages, tools: toolDefs, tool_choice: 'auto' });
          const choice = json.choices?.[0];
          if (!choice) throw new ModelError('The model returned no answer.');
          // Kept as returned: some providers attach data to tool calls that must come back (e.g. Gemini's thought signatures).
          const message = { ...choice.message, role: 'assistant' };
          if (message.content === undefined) message.content = null;
          const calls = (message.tool_calls ?? []).map((tc) => {
            if (!tc.id) tc.id = `call_${++counter}`;
            let input;
            try {
              input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
            } catch {
              input = { __invalid_json: true };
            }
            return { id: tc.id, name: tc.function?.name ?? '', input };
          });
          if (!message.tool_calls?.length) delete message.tool_calls;
          messages.push(message);
          const finish = choice.finish_reason;
          const stopReason = finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : calls.length ? 'tool_use' : 'end_turn';
          const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.map((p) => p.text ?? '').join('\n') : '';
          return { calls, text: short(text), stopReason };
        },
        addResults(results) {
          for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, content: (r.isError ? 'Error: ' : '') + (r.text || '(no output)') });
        },
        nudge(text) {
          messages.push({ role: 'user', content: text });
        },
      };
    },
  };
}

export function createModel(agent, apiUrl) {
  const options = { baseURL: `${apiUrl}/llm/agents/${agent.id}`, token: agent.token, model: agent.model };
  return agent.providerKind === 'anthropic' ? anthropicModel(options) : openaiModel(options);
}
