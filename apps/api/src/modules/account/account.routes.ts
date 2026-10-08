import { Router } from 'express';
import { createTokenSchema, updateProfileSchema, updateTokenSchema } from '@loop/shared';
import { idParam, parse } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { actorFrom, requireUser } from '../../middleware/auth';
import { audit } from '../audit/audit.service';
import { listUserSessions, revokeSession } from '../auth/sessions.service';
import { createToken, listOwnTokens, revokeToken, updateTokenRoles } from '../tokens/tokens.service';
import { updateProfile } from '../users/users.service';

/** Self-service account management: profile, personal access tokens, sessions. */
export function accountRoutes(): Router {
  const router = Router();
  router.use(requireUser);

  router.patch('/profile', (req, res) => {
    const { name } = parse(updateProfileSchema, req.body);
    res.json({ user: updateProfile(actorFrom(req), name) });
  });

  router.get('/tokens', (req, res) => {
    res.json({ items: listOwnTokens(req.identity!.user.id) });
  });

  router.post('/tokens', (req, res) => {
    const input = parse(createTokenSchema, req.body);
    res.status(201).json(createToken(actorFrom(req), input));
  });

  router.patch('/tokens/:id', (req, res) => {
    const { roleKeys } = parse(updateTokenSchema, req.body);
    res.json(updateTokenRoles(actorFrom(req), idParam(req, 'id', 'Token'), roleKeys));
  });

  router.delete('/tokens/:id', (req, res) => {
    revokeToken(actorFrom(req), idParam(req, 'id', 'Token'));
    res.status(204).end();
  });

  router.get('/sessions', (req, res) => {
    res.json({ items: listUserSessions(req.identity!.user.id, req.identity!.session.id) });
  });

  router.delete('/sessions/:id', (req, res) => {
    const id = idParam(req, 'id', 'Session');
    if (!revokeSession(id, req.identity!.user.id)) throw notFound('Session');
    audit({ action: 'account.session_revoked', actor: actorFrom(req), targetType: 'session', targetId: id });
    res.status(204).end();
  });

  return router;
}
