import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  createApiAgentSchema,
  updateApiAgentSchema,
  type ApiAgentDTO,
  type ApiAgentsDTO,
  type CreateApiAgentInput,
  type UpdateApiAgentInput,
} from '@loop/shared';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { aiProviders, apiAgents, apiAgentUsage, apiTokens, projects, users, workspaces, type AiProviderRow, type ApiAgentRow } from '../../db/schema';
import type { Actor } from '../../lib/actor';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { keyFingerprint, open, parseMasterKey, seal, SecretsUnavailableError } from '../../lib/secrets';
import { addDays, now } from '../../lib/time';
import { audit } from '../audit/audit.service';
import { getSettings } from '../settings/settings.service';
import { issueAgentToken, revokeTokenById, setAgentTokenRoles } from '../tokens/tokens.service';

/** Agent tokens are renewed when they have less than this left. */
const RENEW_BEFORE_DAYS = 7;
const owner = (id: string) => `api-agent:${id}`;
const today = () => new Date().toISOString().slice(0, 10);

function masterKey(): Buffer {
  const key = parseMasterKey(env.LOOP_SECRETS_KEY);
  if (!key) throw conflict(new SecretsUnavailableError().message);
  return key;
}

export const runnerConfigured = (): boolean => Boolean(env.LOOP_RUNNER_SECRET);

function usageOf(agentId: string, day = today()) {
  const row = db.select().from(apiAgentUsage).where(and(eq(apiAgentUsage.agentId, agentId), eq(apiAgentUsage.day, day))).get();
  return { inputTokens: row?.inputTokens ?? 0, outputTokens: row?.outputTokens ?? 0, requests: row?.requests ?? 0 };
}

/** Tokens left today under the agent's daily limit. */
export function tokensLeftToday(agent: ApiAgentRow): number {
  const used = usageOf(agent.id);
  return Math.max(0, agent.dailyTokenLimit - used.inputTokens - used.outputTokens);
}

export function recordUsage(agentId: string, inputTokens: number, outputTokens: number): void {
  const day = today();
  db.insert(apiAgentUsage)
    .values({ agentId, day, inputTokens, outputTokens, requests: 1 })
    .onConflictDoUpdate({
      target: [apiAgentUsage.agentId, apiAgentUsage.day],
      set: {
        inputTokens: sql`${apiAgentUsage.inputTokens} + ${inputTokens}`,
        outputTokens: sql`${apiAgentUsage.outputTokens} + ${outputTokens}`,
        requests: sql`${apiAgentUsage.requests} + 1`,
      },
    })
    .run();
}

function providerOf(row: ApiAgentRow): AiProviderRow | undefined {
  return row.providerId ? db.select().from(aiProviders).where(eq(aiProviders.id, row.providerId)).get() : undefined;
}

/** The model it uses: its own choice, else its provider's default. */
export const modelOf = (row: ApiAgentRow, provider: AiProviderRow | undefined): string => row.model || provider?.model || '';

function toDTO(row: ApiAgentRow): ApiAgentDTO {
  const provider = providerOf(row);
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    providerId: row.providerId,
    providerName: provider?.name ?? null,
    providerKind: provider?.kind ?? null,
    model: modelOf(row, provider),
    modelChoice: row.model,
    roleKeys: row.roleKeys ?? null,
    dailyTokenLimit: row.dailyTokenLimit,
    maxTurnsPerStep: row.maxTurnsPerStep,
    canRunCommands: row.canRunCommands,
    state: row.state,
    status: { activity: row.statusActivity, error: row.statusError, at: row.statusAt?.toISOString() ?? null },
    usageToday: usageOf(row.id),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function getAgentRow(id: string): ApiAgentRow {
  const row = db.select().from(apiAgents).where(eq(apiAgents.id, id)).get();
  if (!row) throw notFound('API agent');
  return row;
}

function requireProvider(id: string): AiProviderRow {
  const provider = db.select().from(aiProviders).where(eq(aiProviders.id, id)).get();
  if (!provider) throw badRequest('Choose an AI provider', [{ path: 'providerId', message: 'Unknown AI provider' }]);
  return provider;
}

function assertNameFree(projectId: string, name: string, except?: string): void {
  const taken = db.select({ id: apiAgents.id }).from(apiAgents).where(and(eq(apiAgents.projectId, projectId), eq(apiAgents.name, name))).get();
  if (taken && taken.id !== except) throw conflict(`This project already has an API agent named “${name}”`);
}

export function listApiAgents(projectId: string): ApiAgentsDTO {
  if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) throw notFound('Project');
  return {
    items: db.select().from(apiAgents).where(eq(apiAgents.projectId, projectId)).orderBy(asc(apiAgents.name)).all().map(toDTO),
    runnerConfigured: runnerConfigured(),
  };
}

/** A fresh token for the agent, sealed for the runner; the old one (if any) is revoked. */
function newToken(row: Pick<ApiAgentRow, 'id' | 'projectId' | 'name' | 'roleKeys' | 'tokenId'>, userId: string) {
  const token = issueAgentToken(userId, row.projectId, `API agent · ${row.name}`, row.roleKeys ?? null, getSettings().security.tokenMaxDays);
  const sealed = seal(masterKey(), token.secret, owner(row.id));
  if (row.tokenId) revokeTokenById(row.tokenId);
  return { tokenId: token.id, tokenSealed: sealed.sealed, tokenKeyId: sealed.keyId };
}

export function createApiAgent(actor: Actor, input: CreateApiAgentInput): ApiAgentDTO {
  const data = createApiAgentSchema.parse(input);
  masterKey();
  if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, data.projectId)).get()) throw notFound('Project');
  requireProvider(data.providerId);
  assertNameFree(data.projectId, data.name);
  const id = randomUUID();
  const base = { id, projectId: data.projectId, name: data.name, roleKeys: data.roleKeys, tokenId: null };
  const row = db
    .insert(apiAgents)
    .values({
      ...base,
      providerId: data.providerId,
      model: data.model,
      dailyTokenLimit: data.dailyTokenLimit,
      maxTurnsPerStep: data.maxTurnsPerStep,
      canRunCommands: data.canRunCommands,
      createdById: actor.userId,
      ...newToken(base, actor.userId),
    })
    .returning()
    .get();
  audit({ action: 'api_agent.created', actor, targetType: 'api_agent', targetId: id, metadata: { name: row.name, projectId: row.projectId, providerId: row.providerId, roleKeys: row.roleKeys } });
  return toDTO(row);
}

export function updateApiAgent(actor: Actor, id: string, input: UpdateApiAgentInput): ApiAgentDTO {
  const patch = updateApiAgentSchema.parse(input);
  const before = getAgentRow(id);
  if (patch.name !== undefined) assertNameFree(before.projectId, patch.name, id);
  if (patch.providerId !== undefined) requireProvider(patch.providerId);
  if (patch.roleKeys !== undefined && before.tokenId) setAgentTokenRoles(before.tokenId, patch.roleKeys);
  const row = db
    .update(apiAgents)
    .set({ ...patch, updatedAt: now() })
    .where(eq(apiAgents.id, id))
    .returning()
    .get()!;
  audit({ action: 'api_agent.updated', actor, targetType: 'api_agent', targetId: id, metadata: { fields: Object.keys(patch) } });
  return toDTO(row);
}

export function deleteApiAgent(actor: Actor, id: string): void {
  const row = getAgentRow(id);
  if (row.tokenId) revokeTokenById(row.tokenId);
  db.delete(apiAgents).where(eq(apiAgents.id, id)).run();
  audit({ action: 'api_agent.deleted', actor, targetType: 'api_agent', targetId: id, metadata: { name: row.name } });
}

/** Start (the runner picks it up within seconds) or stop it (it finishes its current step first). */
export function setApiAgentState(actor: Actor, id: string, state: 'running' | 'stopped'): ApiAgentDTO {
  const row = getAgentRow(id);
  if (state === 'running') {
    const provider = providerOf(row);
    if (!provider) throw conflict('Choose an AI provider for this agent first.');
    if (!provider.enabled) throw conflict(`The provider “${provider.name}” is disabled.`);
    if (!modelOf(row, provider)) throw conflict('Choose a model for this agent, or a default model for its provider.');
    if (!runnerConfigured()) throw conflict('The runner is not set up: run `npm run secrets-key` on the server, then `npm run up`.');
  }
  const updated = db
    .update(apiAgents)
    .set({ state, statusError: null, statusActivity: state === 'running' ? 'Starting…' : 'Stopped', statusAt: now(), updatedAt: now() })
    .where(eq(apiAgents.id, id))
    .returning()
    .get()!;
  audit({ action: state === 'running' ? 'api_agent.started' : 'api_agent.stopped', actor, targetType: 'api_agent', targetId: id });
  return toDTO(updated);
}

/** What the runner says about an agent: its activity, an error, or that it stopped. */
export function reportApiAgentStatus(id: string, report: { activity?: string | null; error?: string | null; stopped?: boolean }): void {
  getAgentRow(id);
  db.update(apiAgents)
    .set({
      ...(report.activity !== undefined ? { statusActivity: report.activity?.slice(0, 300) ?? null } : {}),
      ...(report.error !== undefined ? { statusError: report.error?.slice(0, 500) ?? null } : {}),
      ...(report.stopped ? { state: 'stopped' as const } : {}),
      statusAt: now(),
    })
    .where(eq(apiAgents.id, id))
    .run();
}

export interface RunnerAgent {
  id: string;
  name: string;
  projectId: string;
  projectKey: string;
  /** Workspace folder of the project, relative to the workspaces directory (e.g. "acme/shop"). */
  workspacePath: string;
  providerKind: 'anthropic' | 'openai_compatible';
  model: string;
  maxTurnsPerStep: number;
  canRunCommands: boolean;
  /** The agent's own access token, for the MCP server and the model relay. */
  token: string;
  /** Commits it makes are authored as the administrator who created it. */
  git: { name: string; email: string };
}

/**
 * Running agents for the runner, each with its token in the clear. Tokens that are missing,
 * revoked or about to expire are replaced first. Agents that cannot run are left out, with why.
 */
export function runnerAgents(): RunnerAgent[] {
  const key = parseMasterKey(env.LOOP_SECRETS_KEY);
  const result: RunnerAgent[] = [];
  for (const row of db.select().from(apiAgents).where(eq(apiAgents.state, 'running')).all()) {
    const fail = (error: string) => reportApiAgentStatus(row.id, { error });
    const provider = providerOf(row);
    if (!provider || !provider.enabled || !modelOf(row, provider)) {
      fail('Its AI provider is missing, disabled or has no model.');
      continue;
    }
    if (!key) {
      fail(new SecretsUnavailableError().message);
      continue;
    }
    const creator = row.createdById ? db.select().from(users).where(eq(users.id, row.createdById)).get() : undefined;
    if (!creator || creator.status !== 'active' || creator.role !== 'admin') {
      fail('The administrator who created it is no longer an active administrator: create the agent again.');
      continue;
    }
    let agent = row;
    const token = row.tokenId ? db.select().from(apiTokens).where(eq(apiTokens.id, row.tokenId)).get() : undefined;
    const stale = !token || token.revokedAt || token.expiresAt <= addDays(now(), RENEW_BEFORE_DAYS) || row.tokenKeyId !== keyFingerprint(key);
    if (stale) {
      agent = db.update(apiAgents).set(newToken(row, creator.id)).where(eq(apiAgents.id, row.id)).returning().get()!;
    }
    let secret: string;
    try {
      secret = open(key, { sealed: agent.tokenSealed!, keyId: agent.tokenKeyId! }, owner(agent.id));
    } catch {
      fail('Its access token could not be read.');
      continue;
    }
    const project = db.select({ key: projects.key, workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, agent.projectId)).get()!;
    const ws = db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, project.workspaceId)).get();
    result.push({
      id: agent.id,
      name: agent.name,
      projectId: agent.projectId,
      projectKey: project.key,
      workspacePath: `${ws?.slug ?? 'workspace'}/${project.key.toLowerCase()}`,
      providerKind: provider.kind,
      model: modelOf(agent, provider),
      maxTurnsPerStep: agent.maxTurnsPerStep,
      canRunCommands: agent.canRunCommands,
      token: secret,
      git: { name: creator.name, email: creator.email },
    });
  }
  return result;
}
