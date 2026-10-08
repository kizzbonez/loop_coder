import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import {
  aiProviderPreset,
  createAiProviderSchema,
  updateAiProviderSchema,
  type AiProviderDTO,
  type AiProvidersDTO,
  type AiProviderTestDTO,
  type CreateAiProviderInput,
  type UpdateAiProviderInput,
} from '@loop/shared';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { aiProviders, type AiProviderRow } from '../../db/schema';
import type { Actor } from '../../lib/actor';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { hint, keyFingerprint, open, parseMasterKey, seal, SecretsUnavailableError } from '../../lib/secrets';
import { now } from '../../lib/time';
import { audit } from '../audit/audit.service';
import { explainFailure, listModels } from './provider-clients';

/** The master key from LOOP_SECRETS_KEY, or null when secret storage is not configured. */
function masterKey(): Buffer | null {
  return parseMasterKey(env.LOOP_SECRETS_KEY);
}

const owner = (id: string) => `ai-provider:${id}`;

function toDTO(row: AiProviderRow, key: Buffer | null = masterKey()): AiProviderDTO {
  return {
    id: row.id,
    name: row.name,
    preset: row.preset,
    kind: row.kind,
    baseUrl: row.baseUrl,
    model: row.model,
    enabled: row.enabled,
    key: { hint: row.apiKeyHint, status: key && keyFingerprint(key) === row.apiKeyId ? 'ok' : 'locked' },
    lastTest: row.lastTestAt ? { at: row.lastTestAt.toISOString(), ok: Boolean(row.lastTestOk), message: row.lastTestMessage ?? '' } : null,
    models: row.models ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function getRow(id: string): AiProviderRow {
  const row = db.select().from(aiProviders).where(eq(aiProviders.id, id)).get();
  if (!row) throw notFound('AI provider');
  return row;
}

/** The hosts of enabled providers: all the egress gateway lets through. */
export function allowedHosts(): string[] {
  const hosts = db
    .select({ baseUrl: aiProviders.baseUrl })
    .from(aiProviders)
    .where(eq(aiProviders.enabled, true))
    .all()
    .map((r) => new URL(r.baseUrl).hostname);
  return [...new Set(hosts)].sort();
}

/** Tell the egress gateway which hosts it may reach (atomically, so it never reads half a file). */
export function syncEgressAllowlist(): void {
  const path = env.EGRESS_ALLOWLIST_PATH;
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ hosts: allowedHosts(), updatedAt: new Date().toISOString() })}\n`);
    renameSync(temp, path);
  } catch (err) {
    logger.error({ err, path }, 'could not write the egress allow list');
  }
}

export function listAiProviders(): AiProvidersDTO {
  const key = masterKey();
  return {
    items: db.select().from(aiProviders).orderBy(asc(aiProviders.name)).all().map((r) => toDTO(r, key)),
    secretsConfigured: key !== null,
    allowedHosts: allowedHosts(),
  };
}

function requireKey(): Buffer {
  const key = masterKey();
  if (!key) throw conflict(new SecretsUnavailableError().message);
  return key;
}

export function createAiProvider(actor: Actor, input: CreateAiProviderInput): AiProviderDTO {
  const data = createAiProviderSchema.parse(input);
  const key = requireKey();
  const preset = aiProviderPreset(data.preset)!;
  const baseUrl = data.baseUrl ?? preset.baseUrl;
  if (!baseUrl) throw badRequest('Enter the provider’s base URL', [{ path: 'baseUrl', message: 'Required for this provider' }]);
  if (db.select({ id: aiProviders.id }).from(aiProviders).where(eq(aiProviders.name, data.name)).get()) {
    throw conflict(`An AI provider named “${data.name}” already exists`);
  }
  const id = randomUUID();
  const sealed = seal(key, data.apiKey, owner(id));
  const row = db
    .insert(aiProviders)
    .values({
      id,
      name: data.name,
      preset: preset.id,
      kind: preset.kind,
      baseUrl,
      model: data.model || preset.defaultModel,
      enabled: data.enabled,
      apiKeySealed: sealed.sealed,
      apiKeyId: sealed.keyId,
      apiKeyHint: hint(data.apiKey),
      createdById: actor.userId,
    })
    .returning()
    .get();
  audit({ action: 'ai_provider.created', actor, targetType: 'ai_provider', targetId: id, metadata: { name: row.name, preset: row.preset, host: new URL(baseUrl).hostname } });
  syncEgressAllowlist();
  return toDTO(row, key);
}

export function updateAiProvider(actor: Actor, id: string, input: UpdateAiProviderInput): AiProviderDTO {
  const patch = updateAiProviderSchema.parse(input);
  const before = getRow(id);
  const changes: Partial<typeof aiProviders.$inferInsert> = { updatedAt: now() };
  if (patch.name !== undefined && patch.name !== before.name) {
    const taken = db.select({ id: aiProviders.id }).from(aiProviders).where(eq(aiProviders.name, patch.name)).get();
    if (taken) throw conflict(`An AI provider named “${patch.name}” already exists`);
    changes.name = patch.name;
  }
  if (patch.baseUrl !== undefined) changes.baseUrl = patch.baseUrl;
  if (patch.model !== undefined) changes.model = patch.model;
  if (patch.enabled !== undefined) changes.enabled = patch.enabled;
  if (patch.apiKey !== undefined) {
    const sealed = seal(requireKey(), patch.apiKey, owner(id));
    Object.assign(changes, { apiKeySealed: sealed.sealed, apiKeyId: sealed.keyId, apiKeyHint: hint(patch.apiKey), lastTestAt: null, lastTestOk: null, lastTestMessage: null });
  }
  if (patch.baseUrl !== undefined && patch.baseUrl !== before.baseUrl) Object.assign(changes, { lastTestAt: null, lastTestOk: null, lastTestMessage: null, models: null });
  const row = db.update(aiProviders).set(changes).where(eq(aiProviders.id, id)).returning().get()!;
  const fields = Object.keys(patch).filter((k) => k !== 'apiKey');
  audit({ action: 'ai_provider.updated', actor, targetType: 'ai_provider', targetId: id, metadata: { fields, keyReplaced: patch.apiKey !== undefined } });
  syncEgressAllowlist();
  return toDTO(row);
}

export function deleteAiProvider(actor: Actor, id: string): void {
  const row = getRow(id);
  db.delete(aiProviders).where(eq(aiProviders.id, id)).run();
  audit({ action: 'ai_provider.deleted', actor, targetType: 'ai_provider', targetId: id, metadata: { name: row.name } });
  syncEgressAllowlist();
}

/** The provider's API key in the clear, for a call made right now. Never logged or returned. */
export function providerApiKey(row: AiProviderRow): string {
  const key = masterKey();
  if (!key) throw new SecretsUnavailableError();
  return open(key, { sealed: row.apiKeySealed, keyId: row.apiKeyId }, owner(row.id));
}

/** Check the key and the address by listing the provider's models; remembers the result. */
export async function testAiProvider(actor: Actor, id: string): Promise<AiProviderTestDTO> {
  const row = getRow(id);
  let apiKey: string;
  try {
    apiKey = providerApiKey(row);
  } catch (err) {
    throw conflict(err instanceof SecretsUnavailableError ? err.message : 'The stored key cannot be read: enter it again.');
  }
  let ok = false;
  let message: string;
  let models: string[] = [];
  try {
    models = (await listModels(row, apiKey)).slice(0, 200).sort();
    ok = true;
    message = models.length ? `Connected. ${models.length} model${models.length === 1 ? '' : 's'} available.` : 'Connected.';
  } catch (error) {
    message = explainFailure(error).message;
  }
  const updated = db
    .update(aiProviders)
    .set({ lastTestAt: now(), lastTestOk: ok, lastTestMessage: message, ...(ok ? { models } : {}) })
    .where(eq(aiProviders.id, id))
    .returning()
    .get()!;
  audit({ action: 'ai_provider.tested', actor, targetType: 'ai_provider', targetId: id, metadata: { ok } });
  return { ok, message, models, provider: toDTO(updated) };
}
