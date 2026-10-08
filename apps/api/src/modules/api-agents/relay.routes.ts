import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { aiProviders, type AiProviderRow, type ApiAgentRow } from '../../db/schema';
import { safeEqual } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { providerApiKey } from '../ai-providers/ai-providers.service';
import { authenticateToken } from '../tokens/tokens.service';
import { getAgentRow, modelOf, recordUsage, reportApiAgentStatus, runnerAgents, tokensLeftToday } from './api-agents.service';

/** A model call may take long on hard steps. */
const UPSTREAM_TIMEOUT_MS = 10 * 60_000;

/** The relay's own errors, in the Anthropic error shape; SDKs must not retry them. */
const error = (res: Response, status: number, type: string, message: string) =>
  res.status(status).set('x-should-retry', 'false').json({ type: 'error', error: { type, message } });

/** Only the runner (with LOOP_RUNNER_SECRET) may list running agents and their tokens. */
function requireRunner(req: Request, res: Response, next: NextFunction): void {
  const secret = env.LOOP_RUNNER_SECRET;
  if (!secret) return void error(res, 503, 'runner_not_configured', 'LOOP_RUNNER_SECRET is not set');
  const given = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!given || !safeEqual(given, secret)) return void error(res, 401, 'authentication_error', 'Unknown runner');
  next();
}

interface AgentContext {
  agent: ApiAgentRow;
  provider: AiProviderRow;
  apiKey: string;
}

/**
 * A model request from a running API agent, authenticated with the agent's own access token
 * (the Anthropic SDK sends it as x-api-key, others as a bearer token).
 */
function authenticateAgent(req: Request, res: Response): AgentContext | null {
  const presented = req.get('x-api-key') ?? (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const auth = presented ? authenticateToken(presented) : null;
  let agent: ApiAgentRow;
  try {
    agent = getAgentRow(String(req.params.id));
  } catch {
    error(res, 404, 'not_found_error', 'Unknown API agent');
    return null;
  }
  if (!auth || auth.token.id !== agent.tokenId) {
    error(res, 401, 'authentication_error', 'This token does not belong to the agent');
    return null;
  }
  if (agent.state !== 'running') {
    error(res, 409, 'agent_stopped', 'The agent is stopped');
    return null;
  }
  const provider = agent.providerId ? db.select().from(aiProviders).where(eq(aiProviders.id, agent.providerId)).get() : undefined;
  if (!provider || !provider.enabled) {
    error(res, 409, 'provider_unavailable', 'The agent’s AI provider is missing or disabled');
    return null;
  }
  // 402, not 429: SDKs retry 429s, and a spent budget will not come back before tomorrow.
  if (tokensLeftToday(agent) <= 0) {
    error(res, 402, 'budget_exhausted', `Daily token limit of ${agent.dailyTokenLimit.toLocaleString('en-US')} reached`);
    return null;
  }
  let apiKey: string;
  try {
    apiKey = providerApiKey(provider);
  } catch {
    error(res, 409, 'provider_unavailable', 'The provider’s API key cannot be read: enter it again in Admin › AI providers');
    return null;
  }
  return { agent, provider, apiKey };
}

/** Forward one non-streaming model request to the provider with the real key, and count its tokens. */
async function forward(res: Response, ctx: AgentContext, url: string, headers: Record<string, string>, body: unknown, countUsage: (json: any) => [number, number]): Promise<void> {
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), redirect: 'error' });
  } catch (err) {
    logger.warn({ err: (err as Error).name, agentId: ctx.agent.id }, 'model relay: provider unreachable');
    return void error(res, 502, 'relay_error', 'The AI provider could not be reached');
  }
  const text = await upstream.text();
  if (upstream.ok) {
    try {
      const [input, output] = countUsage(JSON.parse(text));
      recordUsage(ctx.agent.id, Math.max(0, input || 0), Math.max(0, output || 0));
    } catch {
      recordUsage(ctx.agent.id, 0, 0);
    }
  }
  res.status(upstream.status).type('application/json').send(text);
}

const messageBody = z.object({ stream: z.boolean().optional() }).passthrough();

/**
 * The runner's private routes (mounted at /llm, which nginx never forwards: only containers on
 * the internal network reach it). Provider API keys never leave this process.
 */
export function llmRelayRoutes(): Router {
  const router = Router();
  router.use(express.json({ limit: '20mb' }));

  router.get('/runner/agents', requireRunner, (_req, res) => {
    res.json({ items: runnerAgents() });
  });

  router.post('/runner/agents/:id/status', requireRunner, (req, res) => {
    const report = z
      .object({ activity: z.string().max(300).nullable().optional(), error: z.string().max(500).nullable().optional(), stopped: z.boolean().optional() })
      .safeParse(req.body);
    if (!report.success) return void error(res, 400, 'invalid_request_error', 'Bad status report');
    try {
      reportApiAgentStatus(String(req.params.id), report.data);
    } catch {
      return void error(res, 404, 'not_found_error', 'Unknown API agent');
    }
    res.status(204).end();
  });

  router.get('/agents/:id/budget', (req, res) => {
    const ctx = authenticateAgent(req, res);
    if (ctx) res.json({ tokensLeftToday: tokensLeftToday(ctx.agent) });
  });

  // Anthropic Messages API (the runner uses the official SDK with this relay as its base URL).
  router.post('/agents/:id/v1/messages', async (req, res) => {
    const ctx = authenticateAgent(req, res);
    if (!ctx) return;
    const body = messageBody.safeParse(req.body);
    if (!body.success || body.data.stream) return void error(res, 400, 'invalid_request_error', 'Send a non-streaming JSON request');
    if (ctx.provider.kind !== 'anthropic') return void error(res, 400, 'invalid_request_error', 'This agent’s provider is not Anthropic');
    const headers: Record<string, string> = { 'x-api-key': ctx.apiKey, 'anthropic-version': /^\d{4}-\d{2}-\d{2}$/.test(req.get('anthropic-version') ?? '') ? req.get('anthropic-version')! : '2023-06-01' };
    const beta = req.get('anthropic-beta');
    if (beta && /^[a-z0-9,-]{1,300}$/i.test(beta)) headers['anthropic-beta'] = beta;
    const url = `${ctx.provider.baseUrl}/v1/messages${req.query.beta === 'true' ? '?beta=true' : ''}`;
    await forward(res, ctx, url, headers, { ...body.data, model: modelOf(ctx.agent, ctx.provider) }, (json) => {
      const u = json?.usage ?? {};
      return [(u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), u.output_tokens ?? 0];
    });
  });

  // OpenAI-compatible chat completions (OpenAI, Gemini, Qwen, Kimi, DeepSeek, OpenRouter, ...).
  router.post('/agents/:id/chat/completions', async (req, res) => {
    const ctx = authenticateAgent(req, res);
    if (!ctx) return;
    const body = messageBody.safeParse(req.body);
    if (!body.success || body.data.stream) return void error(res, 400, 'invalid_request_error', 'Send a non-streaming JSON request');
    if (ctx.provider.kind !== 'openai_compatible') return void error(res, 400, 'invalid_request_error', 'This agent’s provider is not OpenAI-compatible');
    await forward(res, ctx, `${ctx.provider.baseUrl}/chat/completions`, { authorization: `Bearer ${ctx.apiKey}` }, { ...body.data, model: modelOf(ctx.agent, ctx.provider) }, (json) => [
      json?.usage?.prompt_tokens ?? 0,
      json?.usage?.completion_tokens ?? 0,
    ]);
  });

  return router;
}
