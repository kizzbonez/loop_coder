import { badRequest } from '../../lib/errors';
import { getSettings } from '../settings/settings.service';

// A small deny-list of the most common passwords that would satisfy the length rule.
const COMMON_PASSWORDS = new Set([
  'password1234',
  'password12345',
  'password123456',
  'passwordpassword',
  '123456789012',
  '1234567890123',
  'qwertyuiopas',
  'qwerty123456',
  'administrator',
  'administrator1',
  'letmeinletmein',
  'iloveyou1234',
  'welcome12345',
  'changeme1234',
  'loopcoder123',
  'loopcoder1234',
]);

export function passwordPolicyError(password: string, ctx: { email?: string; name?: string } = {}): string | null {
  const { passwordMinLength } = getSettings().security;
  if (password.length < passwordMinLength) return `Password must be at least ${passwordMinLength} characters`;
  if (password.length > 256) return 'Password must be at most 256 characters';
  if (/^(.)\1+$/.test(password)) return 'Password cannot be a single repeated character';

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'This password is too common';
  if (ctx.email) {
    const email = ctx.email.toLowerCase();
    const local = email.split('@')[0] ?? '';
    if (lower === email || (local.length >= 4 && lower.includes(local))) {
      return 'Password must not contain your email address';
    }
  }
  if (ctx.name && ctx.name.length >= 4 && lower === ctx.name.toLowerCase()) {
    return 'Password must not be your name';
  }
  return null;
}

export function assertPasswordPolicy(password: string, ctx: { email?: string; name?: string } = {}): void {
  const error = passwordPolicyError(password, ctx);
  if (error) throw badRequest(error, [{ path: 'password', message: error }]);
}
