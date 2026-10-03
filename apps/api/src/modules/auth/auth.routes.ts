import { Router, type Request, type RequestHandler } from 'express';
import type { PublicConfigDTO } from '@loop/shared';
import { changePasswordSchema, loginSchema, registerSchema, setupSchema } from '@loop/shared';
import { versionInfo } from '../../config/version';
import { clientIp, parse, userAgent } from '../../lib/http';
import { actorFrom, clearSessionCookie, requireUser, setSessionCookie } from '../../middleware/auth';
import { audit } from '../audit/audit.service';
import { getSettings } from '../settings/settings.service';
import { toUserDTO } from '../users/users.mapper';
import { changePassword, completeSetup, isSetupRequired, login, register } from './auth.service';
import { revokeSession } from './sessions.service';

const meta = (req: Request) => ({ ip: clientIp(req), userAgent: userAgent(req) });

export function authRoutes(authLimiter: RequestHandler): Router {
  const router = Router();

  /** Public bootstrap info for the SPA (no secrets). */
  router.get('/config', (_req, res) => {
    const s = getSettings();
    const body: PublicConfigDTO = {
      appName: s.general.appName,
      registrationEnabled: s.general.registrationEnabled,
      passwordMinLength: s.security.passwordMinLength,
      setupRequired: isSetupRequired(),
      version: versionInfo,
    };
    res.json(body);
  });

  /** First-run onboarding wizard: creates the administrator and the first workspace. */
  router.post('/setup', authLimiter, async (req, res) => {
    const input = parse(setupSchema, req.body);
    const { token, user, workspaceId, expiresAt } = await completeSetup(input, meta(req));
    setSessionCookie(req, res, token, expiresAt);
    res.status(201).json({ user: toUserDTO(user), workspaceId });
  });

  router.post('/auth/login', authLimiter, async (req, res) => {
    const input = parse(loginSchema, req.body);
    const { token, user, expiresAt } = await login(input, meta(req));
    setSessionCookie(req, res, token, expiresAt);
    res.json({ user: toUserDTO(user) });
  });

  router.post('/auth/register', authLimiter, async (req, res) => {
    const input = parse(registerSchema, req.body);
    const { token, user, expiresAt } = await register(input, meta(req));
    setSessionCookie(req, res, token, expiresAt);
    res.status(201).json({ user: toUserDTO(user) });
  });

  router.post('/auth/logout', (req, res) => {
    if (req.identity) {
      revokeSession(req.identity.session.id);
      audit({ action: 'auth.logout', actor: actorFrom(req) });
    }
    clearSessionCookie(req, res);
    res.status(204).end();
  });

  router.get('/auth/me', requireUser, (req, res) => {
    res.json({ user: toUserDTO(req.identity!.user) });
  });

  router.post('/auth/password', requireUser, authLimiter, async (req, res) => {
    const input = parse(changePasswordSchema, req.body);
    await changePassword(req.identity!.user, req.identity!.session.id, input.currentPassword, input.newPassword, meta(req));
    res.status(204).end();
  });

  return router;
}
