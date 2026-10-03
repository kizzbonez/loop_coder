import { createServer } from 'node:http';
import { createApp } from './app';
import { announceSetupIfRequired, bootstrap } from './bootstrap';
import { env } from './config/env';
import { versionInfo } from './config/version';
import { closeDatabase } from './db/client';
import { logger } from './lib/logger';
import { purgeExpiredSessions } from './modules/auth/sessions.service';

bootstrap();

const app = createApp();
const server = createServer(app);
// Long-lived SSE streams: no request timeout; keep-alive slightly above typical proxy values.
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;

server.listen(env.PORT, env.HOST, () => {
  logger.info({ ...versionInfo, port: env.PORT, database: env.DATABASE_PATH }, 'Loop Coder API listening');
  announceSetupIfRequired();
});

const housekeeping = setInterval(() => purgeExpiredSessions(), 60 * 60_000);
housekeeping.unref();

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
  // Open SSE streams keep the server alive; force-close after a grace period.
  setTimeout(() => {
    server.closeAllConnections();
    closeDatabase();
    process.exit(0);
  }, 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
