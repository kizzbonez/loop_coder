import { Router, type Request } from 'express';
import {
  adminCreateUserSchema,
  adminResetPasswordSchema,
  adminUpdateUserSchema,
  agentRoleSchema,
  createAiProviderSchema,
  createApiAgentSchema,
  settingsSchema,
  updateAgentRoleSchema,
  updateAiProviderSchema,
  updateApiAgentSchema,
} from '@loop/shared';
import { notFound } from '../../lib/errors';
import { idParam, isUuid, parse, queryInt, queryString } from '../../lib/http';
import { actorFrom, requireAdmin } from '../../middleware/auth';
import { audit, listAudit } from '../audit/audit.service';
import { listAgentSessions } from '../presence/presence.service';
import { listAllProjects } from '../projects/projects.service';
import { createRole, deleteRole, listRoles, toRoleDTO, updateRole } from '../roles/roles.service';
import { getSettings, updateSettings } from '../settings/settings.service';
import { listAllTokens, revokeToken } from '../tokens/tokens.service';
import {
  adminCreateUser,
  adminDeleteUser,
  adminResetPassword,
  adminRevokeSessions,
  adminUnlockUser,
  adminUpdateUser,
  listUsers,
} from '../users/users.service';
import { deleteWorkspace, listAllWorkspaces } from '../workspaces/workspaces.service';
import { createBackup, getAdminStats, getSystemInfo } from './admin.service';
import { createAiProvider, deleteAiProvider, listAiProviders, testAiProvider, updateAiProvider } from '../ai-providers/ai-providers.service';
import { createApiAgent, deleteApiAgent, listApiAgents, setApiAgentState, updateApiAgent } from '../api-agents/api-agents.service';

/** Administration → AI providers. */
function aiProviderRoutes(router: Router): void {
  router.get('/ai-providers', (_req, res) => {
    res.json(listAiProviders());
  });
  router.post('/ai-providers', (req, res) => {
    res.status(201).json(createAiProvider(actorFrom(req), parse(createAiProviderSchema, req.body)));
  });
  router.patch('/ai-providers/:id', (req, res) => {
    res.json(updateAiProvider(actorFrom(req), idParam(req, 'id', 'AI provider'), parse(updateAiProviderSchema, req.body)));
  });
  router.delete('/ai-providers/:id', (req, res) => {
    deleteAiProvider(actorFrom(req), idParam(req, 'id', 'AI provider'));
    res.status(204).end();
  });
  router.post('/ai-providers/:id/test', async (req, res) => {
    res.json(await testAiProvider(actorFrom(req), idParam(req, 'id', 'AI provider')));
  });
}

/** API agents of a project (administrators only: they spend the providers' credits). */
function apiAgentRoutes(router: Router): void {
  const aid = (req: Request) => idParam(req, 'id', 'API agent');
  router.get('/api-agents', (req, res) => {
    const projectId = queryString(req.query.projectId, 36);
    if (!projectId || !isUuid(projectId)) throw notFound('Project');
    res.json(listApiAgents(projectId.toLowerCase()));
  });
  router.post('/api-agents', (req, res) => {
    res.status(201).json(createApiAgent(actorFrom(req), parse(createApiAgentSchema, req.body)));
  });
  router.patch('/api-agents/:id', (req, res) => {
    res.json(updateApiAgent(actorFrom(req), aid(req), parse(updateApiAgentSchema, req.body)));
  });
  router.delete('/api-agents/:id', (req, res) => {
    deleteApiAgent(actorFrom(req), aid(req));
    res.status(204).end();
  });
  router.post('/api-agents/:id/start', (req, res) => {
    res.json(setApiAgentState(actorFrom(req), aid(req), 'running'));
  });
  router.post('/api-agents/:id/stop', (req, res) => {
    res.json(setApiAgentState(actorFrom(req), aid(req), 'stopped'));
  });
}

/** Platform administration. Every route requires the platform `admin` role. */
export function adminRoutes(): Router {
  const router = Router();
  router.use(requireAdmin);
  aiProviderRoutes(router);
  apiAgentRoutes(router);
  const uid = (req: Request) => idParam(req, 'id', 'User');

  // Overview -------------------------------------------------------------------
  router.get('/stats', (_req, res) => {
    res.json(getAdminStats());
  });

  router.get('/system', (_req, res) => {
    res.json(getSystemInfo());
  });

  router.get('/backup', async (req, res) => {
    const backup = await createBackup();
    audit({ action: 'admin.backup_downloaded', actor: actorFrom(req) });
    res.download(backup.path, backup.filename, () => backup.cleanup());
  });

  // Users ----------------------------------------------------------------------
  router.get('/users', (_req, res) => {
    res.json({ items: listUsers() });
  });

  router.post('/users', async (req, res) => {
    res.status(201).json(await adminCreateUser(actorFrom(req), parse(adminCreateUserSchema, req.body)));
  });

  router.patch('/users/:id', (req, res) => {
    res.json(adminUpdateUser(actorFrom(req), uid(req), parse(adminUpdateUserSchema, req.body)));
  });

  router.delete('/users/:id', (req, res) => {
    adminDeleteUser(actorFrom(req), uid(req));
    res.status(204).end();
  });

  router.post('/users/:id/reset-password', async (req, res) => {
    const { password } = parse(adminResetPasswordSchema, req.body);
    await adminResetPassword(actorFrom(req), uid(req), password);
    res.status(204).end();
  });

  router.post('/users/:id/unlock', (req, res) => {
    res.json(adminUnlockUser(actorFrom(req), uid(req)));
  });

  router.post('/users/:id/revoke-sessions', (req, res) => {
    res.json({ revoked: adminRevokeSessions(actorFrom(req), uid(req)) });
  });

  // Workspaces & projects ------------------------------------------------------------
  router.get('/workspaces', (_req, res) => {
    res.json({ items: listAllWorkspaces() });
  });

  router.delete('/workspaces/:id', (req, res) => {
    deleteWorkspace(actorFrom(req), idParam(req, 'id', 'Workspace'));
    res.status(204).end();
  });

  router.get('/projects', (_req, res) => {
    res.json({ items: listAllProjects() });
  });

  // Agent roles -------------------------------------------------------------------
  router.post('/agent-roles', (req, res) => {
    res.status(201).json(toRoleDTO(createRole(actorFrom(req), parse(agentRoleSchema, req.body))));
  });

  router.patch('/agent-roles/:id', (req, res) => {
    res.json(toRoleDTO(updateRole(actorFrom(req), idParam(req, 'id', 'Role'), parse(updateAgentRoleSchema, req.body))));
  });

  router.delete('/agent-roles/:id', (req, res) => {
    deleteRole(actorFrom(req), idParam(req, 'id', 'Role'));
    res.status(204).end();
  });

  router.get('/agent-roles', (_req, res) => {
    res.json({ items: listRoles().map(toRoleDTO) });
  });

  // Settings ------------------------------------------------------------------------
  router.get('/settings', (_req, res) => {
    res.json(getSettings());
  });

  router.put('/settings', (req, res) => {
    const actor = actorFrom(req);
    const next = updateSettings(parse(settingsSchema, req.body), actor.userId);
    audit({ action: 'admin.settings_updated', actor });
    res.json(next);
  });

  // Tokens, agents, audit ------------------------------------------------------------
  router.get('/tokens', (_req, res) => {
    res.json({ items: listAllTokens() });
  });

  router.delete('/tokens/:id', (req, res) => {
    revokeToken(actorFrom(req), idParam(req, 'id', 'Token'), true);
    res.status(204).end();
  });

  router.get('/agent-sessions', (req, res) => {
    res.json({ items: listAgentSessions({ limit: queryInt(req.query.limit, 50, 1, 200) }) });
  });

  router.get('/audit', (req, res) => {
    const before = queryString(req.query.before);
    res.json(
      listAudit({
        action: queryString(req.query.action, 60),
        actorUserId: queryString(req.query.actorUserId, 36),
        before: before && !Number.isNaN(Date.parse(before)) ? new Date(before) : undefined,
        limit: queryInt(req.query.limit, 50, 1, 200),
      }),
    );
  });

  return router;
}
