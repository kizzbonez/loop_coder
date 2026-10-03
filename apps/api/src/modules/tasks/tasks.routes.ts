import { Router, type Request } from 'express';
import { createRemarkSchema, moveTaskSchema, updateTaskSchema } from '@loop/shared';
import { idParam, parse } from '../../lib/http';
import { actorFrom, requireUser } from '../../middleware/auth';
import { addHumanRemark, deleteTask, getTaskDetail, moveTask, updateTask } from './tasks.service';

export function tasksRoutes(): Router {
  const router = Router();
  router.use(requireUser);
  const tid = (req: Request) => idParam(req, 'id', 'Work item');

  router.get('/:id', (req, res) => {
    res.json(getTaskDetail(actorFrom(req), tid(req)));
  });

  router.patch('/:id', (req, res) => {
    res.json(updateTask(actorFrom(req), tid(req), parse(updateTaskSchema, req.body)));
  });

  router.delete('/:id', (req, res) => {
    deleteTask(actorFrom(req), tid(req));
    res.status(204).end();
  });

  router.post('/:id/move', (req, res) => {
    const { columnId, index } = parse(moveTaskSchema, req.body);
    res.json(moveTask(actorFrom(req), tid(req), columnId, index));
  });

  router.post('/:id/remarks', (req, res) => {
    const input = parse(createRemarkSchema, req.body);
    res.status(201).json(addHumanRemark(actorFrom(req), tid(req), input));
  });

  return router;
}
