import { and, desc, eq, isNull } from 'drizzle-orm';
import type { ApiTokenDTO, CreatedTokenDTO, CreateTokenInput } from '@loop/shared';
import { agentRoles } from '../../db/schema';
import { db } from '../../db/client';
import { apiTokens, projects, users, workspaces, type ApiTokenRow, type UserRow } from '../../db/schema';
import type { Actor } from '../../lib/actor';
import { generateToken, sha256 } from '../../lib/crypto';
import { badRequest, notFound } from '../../lib/errors';
import { addDays, now } from '../../lib/time';
import { audit } from '../audit/audit.service';
import { requireProjectAccess, requireWorkspaceAccess } from '../projects/access';
import { getSettings } from '../settings/settings.service';

export const TOKEN_PREFIX = 'lc_pat';
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

type TokenWithJoins = {
  token: ApiTokenRow;
  workspaceName: string | null;
  projectName: string | null;
  userEmail: string | null;
};

function toDTO({ token, workspaceName, projectName, userEmail }: TokenWithJoins, includeUser = false): ApiTokenDTO {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    workspaceId: token.workspaceId,
    workspaceName,
    projectId: token.projectId,
    projectName,
    userId: token.userId,
    ...(includeUser ? { userEmail: userEmail ?? undefined } : {}),
    roleKeys: token.roleKeys ?? null,
    clientName: token.lastClientName ?? null,
    createdAt: token.createdAt.toISOString(),
    expiresAt: token.expiresAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
  };
}

function selectTokens() {
  return db
    .select({ token: apiTokens, workspaceName: workspaces.name, projectName: projects.name, userEmail: users.email })
    .from(apiTokens)
    .leftJoin(workspaces, eq(workspaces.id, apiTokens.workspaceId))
    .leftJoin(projects, eq(projects.id, apiTokens.projectId))
    .leftJoin(users, eq(users.id, apiTokens.userId));
}

/** Role keys must name existing roles (kept as given; a role disabled later simply hands out no work). */
function checkRoleKeys(roleKeys: string[] | null | undefined): string[] | null {
  if (!roleKeys) return null;
  const known = new Set(db.select({ key: agentRoles.key }).from(agentRoles).all().map((r) => r.key));
  const unknown = roleKeys.filter((k) => !known.has(k));
  if (unknown.length) throw badRequest(`Unknown role: ${unknown.join(', ')}`, [{ path: 'roleKeys', message: `Unknown role: ${unknown.join(', ')}` }]);
  return roleKeys;
}

export function createToken(actor: Actor, input: CreateTokenInput): CreatedTokenDTO {
  const maxDays = getSettings().security.tokenMaxDays;
  if (input.expiresInDays > maxDays) {
    throw badRequest(`Tokens can be valid for at most ${maxDays} days`, [
      { path: 'expiresInDays', message: `Maximum is ${maxDays} days` },
    ]);
  }
  if (input.workspaceId) requireWorkspaceAccess(actor, input.workspaceId, 'editor');
  if (input.projectId) requireProjectAccess(actor, input.projectId, 'editor');
  const roleKeys = checkRoleKeys(input.roleKeys);

  const secret = generateToken(TOKEN_PREFIX);
  const row = db
    .insert(apiTokens)
    .values({
      userId: actor.userId,
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      name: input.name,
      roleKeys,
      tokenHash: sha256(secret),
      prefix: secret.slice(0, TOKEN_PREFIX.length + 5),
      expiresAt: addDays(now(), input.expiresInDays),
    })
    .returning()
    .get();
  audit({ action: 'token.created', actor, targetType: 'api_token', targetId: row.id, metadata: { name: row.name, roleKeys } });
  const joined = selectTokens().where(eq(apiTokens.id, row.id)).get()!;
  return { token: toDTO(joined), secret };
}

export function listOwnTokens(userId: string): ApiTokenDTO[] {
  return selectTokens()
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt))
    .all()
    .map((r) => toDTO(r));
}

export function listAllTokens(): ApiTokenDTO[] {
  return selectTokens()
    .orderBy(desc(apiTokens.createdAt))
    .all()
    .map((r) => toDTO(r, true));
}

/** Change which roles the agent using one of your tokens plays (null: every role). */
export function updateTokenRoles(actor: Actor, tokenId: string, roleKeys: string[] | null): ApiTokenDTO {
  const keys = checkRoleKeys(roleKeys);
  const changed = db
    .update(apiTokens)
    .set({ roleKeys: keys })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, actor.userId), isNull(apiTokens.revokedAt)))
    .run().changes;
  if (changed === 0) throw notFound('Token');
  audit({ action: 'token.roles_changed', actor, targetType: 'api_token', targetId: tokenId, metadata: { roleKeys: keys } });
  return toDTO(selectTokens().where(eq(apiTokens.id, tokenId)).get()!);
}

/** Revoke a token. Non-admins may only revoke their own tokens. */
export function revokeToken(actor: Actor, tokenId: string, asAdmin = false): void {
  const where = asAdmin
    ? and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt))
    : and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, actor.userId), isNull(apiTokens.revokedAt));
  const changed = db.update(apiTokens).set({ revokedAt: now() }).where(where).run().changes;
  if (changed === 0) throw notFound('Token');
  audit({ action: asAdmin ? 'admin.token_revoked' : 'token.revoked', actor, targetType: 'api_token', targetId: tokenId });
}

export function revokeAllUserTokens(userId: string): number {
  return db
    .update(apiTokens)
    .set({ revokedAt: now() })
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .run().changes;
}

export interface AuthenticatedToken {
  token: ApiTokenRow;
  user: UserRow;
}

/** Validate a bearer secret. Returns null for unknown, revoked or expired tokens and disabled users. */
export function authenticateToken(secret: string): AuthenticatedToken | null {
  if (!secret.startsWith(`${TOKEN_PREFIX}_`) || secret.length > 200) return null;
  const row = db
    .select({ token: apiTokens, user: users })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, sha256(secret)))
    .get();
  if (!row) return null;
  const t = now();
  if (row.token.revokedAt || row.token.expiresAt <= t || row.user.status !== 'active') return null;
  if (!row.token.lastUsedAt || t.getTime() - row.token.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    db.update(apiTokens).set({ lastUsedAt: t }).where(eq(apiTokens.id, row.token.id)).run();
  }
  return row;
}

export function recordClientName(tokenId: string, clientName: string): void {
  db.update(apiTokens)
    .set({ lastClientName: clientName.slice(0, 80) })
    .where(eq(apiTokens.id, tokenId))
    .run();
}
