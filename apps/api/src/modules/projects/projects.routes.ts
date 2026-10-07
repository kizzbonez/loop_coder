import { Router, type Request } from 'express';
import {
  FLOW_ACTIONS,
  createProjectSchema,
  createSprintSchema,
  createTaskSchema,
  updateColumnSchema,
  updateProjectSchema,
} from '@loop/shared';
import { idParam, parse, queryInt, queryString } from '../../lib/http';
import { actorFrom, requireUser } from '../../middleware/auth';
import { streamProjectEvents } from '../../realtime/sse';
import { listActivity } from '../activity/activity.service';
import { listDirectory, readFileContent } from '../files/files.service';
import { listAgentSessions } from '../presence/presence.service';
import { createSprint, listSprints } from '../sprints/sprints.service';
import { createTask, listTasks } from '../tasks/tasks.service';
import { requireProjectAccess } from './access';
import {
  createProject,
  deleteProject,
  getProjectDetail,
  listProjects,
  updateColumn,
  updateProject,
} from './projects.service';

export function projectsRoutes(): Router {
  const router = Router();
  router.use(requireUser);
  const pid = (req: Request) => idParam(req, 'id', 'Project');

  router.get('/', (req, res) => {
    res.json({ items: listProjects(actorFrom(req)) });
  });

  router.post('/', (req, res) => {
    res.status(201).json(createProject(actorFrom(req), parse(createProjectSchema, req.body)));
  });

  router.get('/:id', (req, res) => {
    res.json(getProjectDetail(actorFrom(req), pid(req)));
  });

  router.patch('/:id', (req, res) => {
    res.json(updateProject(actorFrom(req), pid(req), parse(updateProjectSchema, req.body)));
  });

  router.delete('/:id', (req, res) => {
    deleteProject(actorFrom(req), pid(req));
    res.status(204).end();
  });

  router.patch('/:id/columns/:columnId', (req, res) => {
    const columns = updateColumn(actorFrom(req), pid(req), idParam(req, 'columnId', 'Column'), parse(updateColumnSchema, req.body));
    res.json({ items: columns });
  });

  router.get('/:id/tasks', (req, res) => {
    res.json({ items: listTasks(actorFrom(req), pid(req)) });
  });

  router.post('/:id/tasks', (req, res) => {
    res.status(201).json(createTask(actorFrom(req), pid(req), parse(createTaskSchema, req.body)));
  });

  router.get('/:id/sprints', (req, res) => {
    res.json({ items: listSprints(actorFrom(req), pid(req)) });
  });

  router.post('/:id/sprints', (req, res) => {
    res.status(201).json(createSprint(actorFrom(req), pid(req), parse(createSprintSchema, req.body)));
  });

  router.get('/:id/activity', (req, res) => {
    const actor = actorFrom(req);
    const projectId = pid(req);
    requireProjectAccess(actor, projectId, 'viewer');
    const before = queryString(req.query.before);
    const beforeDate = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : undefined;
    // ?kind=flow returns only the events that move work or agents through the SDLC (Flow view replay).
    const flow = req.query.kind === 'flow';
    const limit = queryInt(req.query.limit, 50, 1, flow ? 1000 : 200);
    res.json({ items: listActivity(projectId, { limit, before: beforeDate, actions: flow ? FLOW_ACTIONS : undefined }) });
  });

  router.get('/:id/agent-sessions', (req, res) => {
    const actor = actorFrom(req);
    const projectId = pid(req);
    requireProjectAccess(actor, projectId, 'viewer');
    res.json({ items: listAgentSessions({ projectId, limit: queryInt(req.query.limit, 20, 1, 100) }) });
  });

  router.get('/:id/files', (req, res) => {
    res.json({ items: listDirectory(actorFrom(req), pid(req), queryString(req.query.path, 1000) ?? '') });
  });

  router.get('/:id/files/content', (req, res) => {
    res.json(readFileContent(actorFrom(req), pid(req), queryString(req.query.path, 1000) ?? ''));
  });

  /** Live board updates (Server-Sent Events). */
  router.get('/:id/events', (req, res) => {
    const actor = actorFrom(req);
    const projectId = pid(req);
    requireProjectAccess(actor, projectId, 'viewer');
    streamProjectEvents(req, res, actor, projectId);
  });

  return router;
}
