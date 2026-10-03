import { Router } from 'express';
import { requireUser } from '../../middleware/auth';
import { listRoles, toRoleDTO } from './roles.service';

/** Read-only role catalogue for every signed-in user (role pickers, board chips). */
export function rolesRoutes(): Router {
  const router = Router();
  router.use(requireUser);
  router.get('/', (_req, res) => {
    res.json({ items: listRoles().map(toRoleDTO) });
  });
  return router;
}
