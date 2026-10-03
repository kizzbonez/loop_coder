import { Router, type Request } from 'express';
import { completeSprintSchema, updateSprintSchema } from '@loop/shared';
import { idParam, parse } from '../../lib/http';
import { actorFrom, requireUser } from '../../middleware/auth';
import { completeSprint, deleteSprint, getBurndown, startSprint, updateSprint } from './sprints.service';

export function sprintsRoutes(): Router {
  const router = Router();
  router.use(requireUser);
  const sid = (req: Request) => idParam(req, 'id', 'Sprint');

  router.patch('/:id', (req, res) => {
    res.json(updateSprint(actorFrom(req), sid(req), parse(updateSprintSchema, req.body)));
  });

  router.delete('/:id', (req, res) => {
    deleteSprint(actorFrom(req), sid(req));
    res.status(204).end();
  });

  router.post('/:id/start', (req, res) => {
    res.json(startSprint(actorFrom(req), sid(req)));
  });

  router.post('/:id/complete', (req, res) => {
    res.json(completeSprint(actorFrom(req), sid(req), parse(completeSprintSchema, req.body ?? {})));
  });

  router.get('/:id/burndown', (req, res) => {
    res.json({ items: getBurndown(actorFrom(req), sid(req)) });
  });

  return router;
}
