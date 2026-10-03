import { and, asc, count, eq, ne } from 'drizzle-orm';
import type { UserDTO, UserRole, UserStatus } from '@loop/shared';
import { db } from '../../db/client';
import { users, workspaceMembers, workspaces, type UserRow } from '../../db/schema';
import type { Actor } from '../../lib/actor';
import { hashPassword } from '../../lib/crypto';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { now } from '../../lib/time';
import { audit } from '../audit/audit.service';
import { assertPasswordPolicy } from '../auth/password-policy';
import { revokeUserSessions } from '../auth/sessions.service';
import { revokeAllUserTokens } from '../tokens/tokens.service';
import { toUserDTO } from './users.mapper';

export function listUsers(): UserDTO[] {
  return db.select().from(users).orderBy(asc(users.createdAt)).all().map(toUserDTO);
}

export function getUser(id: string): UserRow {
  const user = db.select().from(users).where(eq(users.id, id)).get();
  if (!user) throw notFound('User');
  return user;
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
}

function activeAdminCount(excludingId?: string): number {
  const where = excludingId
    ? and(eq(users.role, 'admin'), eq(users.status, 'active'), ne(users.id, excludingId))
    : and(eq(users.role, 'admin'), eq(users.status, 'active'));
  return db.select({ n: count() }).from(users).where(where).get()?.n ?? 0;
}

export async function adminCreateUser(
  actor: Actor,
  input: { email: string; name: string; password: string; role: UserRole },
): Promise<UserDTO> {
  if (findUserByEmail(input.email)) throw conflict('An account with this email already exists');
  assertPasswordPolicy(input.password, { email: input.email, name: input.name });
  const passwordHash = await hashPassword(input.password);
  const user = db
    .insert(users)
    .values({ email: input.email, name: input.name, role: input.role, passwordHash })
    .returning()
    .get();
  audit({ action: 'admin.user_created', actor, targetType: 'user', targetId: user.id, metadata: { role: user.role } });
  return toUserDTO(user);
}

export function adminUpdateUser(
  actor: Actor,
  id: string,
  patch: { name?: string; role?: UserRole; status?: UserStatus },
): UserDTO {
  const user = getUser(id);
  const demoting = patch.role !== undefined && patch.role !== 'admin' && user.role === 'admin';
  const disabling = patch.status === 'disabled' && user.status === 'active';

  if (id === actor.userId && (demoting || disabling)) {
    throw badRequest('You cannot demote or disable your own account');
  }
  if ((demoting || disabling) && user.role === 'admin' && activeAdminCount(id) === 0) {
    throw badRequest('At least one active administrator must remain');
  }

  const updated = db
    .update(users)
    .set({ ...patch, updatedAt: now() })
    .where(eq(users.id, id))
    .returning()
    .get()!;

  if (disabling) {
    revokeUserSessions(id);
    revokeAllUserTokens(id);
  }
  audit({ action: 'admin.user_updated', actor, targetType: 'user', targetId: id, metadata: { ...patch } });
  return toUserDTO(updated);
}

export async function adminResetPassword(actor: Actor, id: string, password: string): Promise<void> {
  const user = getUser(id);
  assertPasswordPolicy(password, { email: user.email, name: user.name });
  const passwordHash = await hashPassword(password);
  db.update(users)
    .set({ passwordHash, passwordChangedAt: now(), failedLoginCount: 0, lockedUntil: null, updatedAt: now() })
    .where(eq(users.id, id))
    .run();
  revokeUserSessions(id);
  audit({ action: 'admin.password_reset', actor, targetType: 'user', targetId: id });
}

export function adminUnlockUser(actor: Actor, id: string): UserDTO {
  getUser(id);
  const updated = db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: now() })
    .where(eq(users.id, id))
    .returning()
    .get()!;
  audit({ action: 'admin.user_unlocked', actor, targetType: 'user', targetId: id });
  return toUserDTO(updated);
}

export function adminRevokeSessions(actor: Actor, id: string): number {
  getUser(id);
  const n = revokeUserSessions(id);
  audit({ action: 'admin.sessions_revoked', actor, targetType: 'user', targetId: id, metadata: { count: n } });
  return n;
}

/** Delete a user. Workspaces they own are transferred to the acting administrator. */
export function adminDeleteUser(actor: Actor, id: string): void {
  const user = getUser(id);
  if (id === actor.userId) throw badRequest('You cannot delete your own account');
  if (user.role === 'admin' && user.status === 'active' && activeAdminCount(id) === 0) {
    throw badRequest('At least one active administrator must remain');
  }
  db.transaction((tx) => {
    const owned = tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.ownerId, id)).all();
    for (const ws of owned) {
      tx.update(workspaces).set({ ownerId: actor.userId, updatedAt: now() }).where(eq(workspaces.id, ws.id)).run();
      tx.insert(workspaceMembers)
        .values({ workspaceId: ws.id, userId: actor.userId, role: 'owner' })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          set: { role: 'owner' },
        })
        .run();
    }
    tx.delete(users).where(eq(users.id, id)).run();
  });
  audit({ action: 'admin.user_deleted', actor, targetType: 'user', targetId: id, metadata: { email: user.email } });
}

export function updateProfile(actor: Actor, name: string): UserDTO {
  const updated = db
    .update(users)
    .set({ name, updatedAt: now() })
    .where(eq(users.id, actor.userId))
    .returning()
    .get();
  if (!updated) throw notFound('User');
  audit({ action: 'account.profile_updated', actor });
  return toUserDTO(updated);
}
