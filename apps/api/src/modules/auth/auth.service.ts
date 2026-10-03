import { randomInt } from 'node:crypto';
import { count, eq, sql } from 'drizzle-orm';
import type { LoginInput, RegisterInput, SetupData } from '@loop/shared';
import { env, publicOrigin } from '../../config/env';
import { db } from '../../db/client';
import { users, type UserRow } from '../../db/schema';
import { hashPassword, safeEqual, verifyAgainstDummy, verifyPassword } from '../../lib/crypto';
import { conflict, forbidden, HttpError, locked, unauthorized } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { addMinutes, now } from '../../lib/time';
import { audit } from '../audit/audit.service';
import { getSettings, updateSettings } from '../settings/settings.service';
import { insertWorkspace } from '../workspaces/workspaces.service';
import { assertPasswordPolicy } from './password-policy';
import { createSession, revokeUserSessions, type SessionMeta } from './sessions.service';

const INVALID_CREDENTIALS = 'Invalid email or password';

// ---------------------------------------------------------------------------
// First-run onboarding
// ---------------------------------------------------------------------------

const SETUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I

function generateSetupCode(): string {
  const chunk = () => Array.from({ length: 4 }, () => SETUP_ALPHABET[randomInt(SETUP_ALPHABET.length)]).join('');
  return `${chunk()}-${chunk()}-${chunk()}`;
}

const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');

let setupCode = env.SETUP_CODE ?? generateSetupCode();

export function isSetupRequired(): boolean {
  const row = db.select({ n: count() }).from(users).get();
  return (row?.n ?? 0) === 0;
}

/** Print the one-time setup code so only someone with access to the server logs can claim the instance. */
export function announceSetupIfRequired(): void {
  if (!isSetupRequired()) return;
  logger.warn(
    { setupUrl: `${publicOrigin}/setup` },
    `First-run setup required. Open ${publicOrigin}/setup and enter the setup code: ${setupCode}`,
  );
}

export function getSetupCodeForTests(): string {
  return setupCode;
}

export async function completeSetup(
  input: SetupData,
  meta: SessionMeta,
): Promise<{ token: string; user: UserRow; workspaceId: string; expiresAt: Date }> {
  if (!isSetupRequired()) throw conflict('Setup has already been completed');
  if (!safeEqual(normalizeCode(input.setupCode), normalizeCode(setupCode))) {
    audit({ action: 'setup.invalid_code', ...meta });
    throw forbidden('Invalid setup code. Find it in the server logs: docker compose logs api');
  }
  assertPasswordPolicy(input.password, { email: input.email, name: input.name });
  const passwordHash = await hashPassword(input.password);

  const { user, workspaceId } = db.transaction((tx) => {
    // Re-check inside the transaction so two concurrent wizards cannot both succeed.
    const existing = tx.select({ n: count() }).from(users).get();
    if ((existing?.n ?? 0) > 0) throw conflict('Setup has already been completed');
    const created = tx
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash, role: 'admin' })
      .returning()
      .get();
    const ws = insertWorkspace(tx, created.id, { name: input.workspaceName });
    return { user: created, workspaceId: ws.id };
  });

  const current = getSettings();
  updateSettings(
    {
      ...current,
      general: { ...current.general, appName: input.appName, registrationEnabled: input.registrationEnabled },
    },
    user.id,
  );
  setupCode = generateSetupCode(); // single use

  const { token, session } = createSession(user.id, meta);
  audit({
    action: 'setup.completed',
    actor: { userId: user.id, email: user.email, kind: 'user', ...meta },
    targetType: 'user',
    targetId: user.id,
  });
  return { token, user, workspaceId, expiresAt: session.expiresAt };
}

// ---------------------------------------------------------------------------
// Login / registration / password
// ---------------------------------------------------------------------------

export async function login(input: LoginInput, meta: SessionMeta): Promise<{ token: string; user: UserRow; expiresAt: Date }> {
  const user = db.select().from(users).where(eq(users.email, input.email)).get();
  if (!user) {
    await verifyAgainstDummy(input.password);
    audit({ action: 'auth.login_failed', metadata: { email: input.email, reason: 'unknown_user' }, ...meta });
    throw unauthorized(INVALID_CREDENTIALS);
  }

  const security = getSettings().security;
  const actor = { userId: user.id, email: user.email, kind: 'user' as const, ...meta };

  if (user.lockedUntil && user.lockedUntil > now()) {
    audit({ action: 'auth.login_locked', actor });
    throw locked('Too many failed attempts. This account is temporarily locked, try again later.');
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    const updated = db
      .update(users)
      .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
      .where(eq(users.id, user.id))
      .returning({ failures: users.failedLoginCount })
      .get();
    if ((updated?.failures ?? 0) >= security.maxFailedLogins) {
      db.update(users)
        .set({ failedLoginCount: 0, lockedUntil: addMinutes(now(), security.lockoutMinutes) })
        .where(eq(users.id, user.id))
        .run();
      audit({ action: 'auth.account_locked', actor, metadata: { minutes: security.lockoutMinutes } });
    } else {
      audit({ action: 'auth.login_failed', actor, metadata: { reason: 'bad_password' } });
    }
    throw unauthorized(INVALID_CREDENTIALS);
  }

  if (user.status !== 'active') {
    audit({ action: 'auth.login_disabled', actor });
    throw forbidden('This account has been disabled. Contact an administrator.');
  }

  db.update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now() })
    .where(eq(users.id, user.id))
    .run();
  const { token, session } = createSession(user.id, meta);
  audit({ action: 'auth.login', actor });
  return { token, user, expiresAt: session.expiresAt };
}

export async function register(input: RegisterInput, meta: SessionMeta): Promise<{ token: string; user: UserRow; expiresAt: Date }> {
  if (isSetupRequired()) throw new HttpError(409, 'setup_required', 'Complete the setup wizard first');
  if (!getSettings().general.registrationEnabled) throw forbidden('Self-registration is disabled');
  assertPasswordPolicy(input.password, { email: input.email, name: input.name });

  const existing = db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get();
  if (existing) throw conflict('An account with this email already exists');

  const passwordHash = await hashPassword(input.password);
  const user = db
    .insert(users)
    .values({ email: input.email, name: input.name, passwordHash, role: 'user' })
    .returning()
    .get();
  const { token, session } = createSession(user.id, meta);
  audit({
    action: 'auth.register',
    actor: { userId: user.id, email: user.email, kind: 'user', ...meta },
    targetType: 'user',
    targetId: user.id,
  });
  return { token, user, expiresAt: session.expiresAt };
}

export async function changePassword(
  user: UserRow,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
  meta: SessionMeta,
): Promise<void> {
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new HttpError(400, 'bad_request', 'Current password is incorrect', [
      { path: 'currentPassword', message: 'Current password is incorrect' },
    ]);
  }
  if (currentPassword === newPassword) {
    throw new HttpError(400, 'bad_request', 'New password must be different', [
      { path: 'newPassword', message: 'New password must be different' },
    ]);
  }
  assertPasswordPolicy(newPassword, { email: user.email, name: user.name });
  const passwordHash = await hashPassword(newPassword);
  db.update(users)
    .set({ passwordHash, passwordChangedAt: now(), updatedAt: now() })
    .where(eq(users.id, user.id))
    .run();
  // Sign out every other device.
  revokeUserSessions(user.id, currentSessionId);
  audit({ action: 'auth.password_changed', actor: { userId: user.id, email: user.email, kind: 'user', ...meta } });
}
