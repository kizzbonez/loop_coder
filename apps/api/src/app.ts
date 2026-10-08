import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { versionInfo } from './config/version';
import { mcpRoutes } from './mcp/mcp.routes';
import { sessionMiddleware } from './middleware/auth';
import { csrfProtection } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { apiLimiter, authLimiter, mcpLimiter, type RateLimitOptions } from './middleware/rate-limit';
import { requestLog } from './middleware/request-log';
import { accountRoutes } from './modules/account/account.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { llmRelayRoutes } from './modules/api-agents/relay.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { projectsRoutes } from './modules/projects/projects.routes';
import { rolesRoutes } from './modules/roles/roles.routes';
import { sprintsRoutes } from './modules/sprints/sprints.routes';
import { tasksRoutes } from './modules/tasks/tasks.routes';
import { workspacesRoutes } from './modules/workspaces/workspaces.routes';

export interface AppOptions {
  rateLimit?: RateLimitOptions;
  log?: boolean;
}

export function createApp(options: AppOptions = {}): Express {
  const rateLimit = options.rateLimit ?? { enabled: env.RATE_LIMIT_ENABLED };
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  if (options.log ?? true) app.use(requestLog);

  // Health & version (unauthenticated, no cookies needed).
  app.get(['/api/health', '/healthz'], (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok', ...versionInfo });
  });
  app.get('/api/version', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(versionInfo);
  });

  // MCP endpoint: bearer-token auth, no cookies, own body parser.
  app.use('/mcp', mcpRoutes(mcpLimiter(rateLimit)));

  // The runner of API agents and its model relay: internal network only (nginx never forwards /llm).
  app.use('/llm', (req, res, next) => (req.get('x-forwarded-for') ? res.status(404).end() : next()), llmRelayRoutes());

  // Browser API: session cookie + CSRF protection.
  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(cookieParser());
  api.use(sessionMiddleware);
  api.use(csrfProtection);
  api.use(apiLimiter(rateLimit));
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  api.use('/', authRoutes(authLimiter(rateLimit)));
  api.use('/account', accountRoutes());
  api.use('/workspaces', workspacesRoutes());
  api.use('/projects', projectsRoutes());
  api.use('/tasks', tasksRoutes());
  api.use('/sprints', sprintsRoutes());
  api.use('/agent-roles', rolesRoutes());
  api.use('/admin', adminRoutes());
  api.use(notFoundHandler);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
