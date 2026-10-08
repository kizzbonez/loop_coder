// Loop Coder runner: runs the API agents administrators start, each with its AI provider's model.
// It holds no provider keys (the API's model relay adds them) and runs every file operation and
// command as an unprivileged user with a clean environment.
import { readFileSync } from 'node:fs';
import { AgentWorker } from './agent.mjs';
import { createRunnerApi } from './api.mjs';
import { connectMcp } from './mcp.mjs';
import { createModel } from './models.mjs';
import { createSandbox } from './sandbox.mjs';
import { createSupervisor } from './supervisor.mjs';

const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const env = process.env;
const apiUrl = (env.LOOP_API_URL ?? 'http://api:3000').replace(/\/+$/, '');
const secret = env.LOOP_RUNNER_SECRET ?? '';
const workspacesDir = env.WORKSPACES_DIR ?? '/workspaces';
const pollMs = Math.max(2, Number(env.RUNNER_POLL_SECONDS) || 5) * 1000;
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const toolUid = env.TOOL_UID ? Number(env.TOOL_UID) : asRoot ? 1000 : undefined;

const write = (level) => (fields, msg) => process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })}\n`);
const log = { info: write('info'), warn: write('warn'), error: write('error') };

// Nothing below may reach a tool process: they get a fresh environment (see sandbox.mjs).
delete process.env.LOOP_RUNNER_SECRET;

if (secret.length < 32) {
  log.warn({}, 'LOOP_RUNNER_SECRET is not set: API agents cannot run. Run `npm run secrets-key`, then `npm run up`.');
  // Stay up (and healthy) so the stack starts; there is nothing to do.
  setInterval(() => {}, 1 << 30);
} else {
  if (!asRoot) log.warn({}, 'not running as root: tool processes run as the runner user');
  const api = createRunnerApi({ apiUrl, secret });
  const sandbox = createSandbox({ workspacesDir, uid: toolUid, gid: toolUid, home: env.TOOL_HOME ?? '/home/agent', gitConfig: env.TOOL_GIT_CONFIG ?? '/app/gitconfig' });
  const supervisor = createSupervisor({
    api,
    log,
    makeWorker: (agent) =>
      new AgentWorker(agent, {
        api,
        connectMcp,
        createModel: (a) => createModel(a, apiUrl),
        sandbox,
        workspacesDir,
        mcpUrl: `${apiUrl}/mcp`,
        version,
        log,
      }),
  });
  log.info({ version, apiUrl, toolUid: toolUid ?? null }, 'runner started');
  let timer;
  const loop = async () => {
    await supervisor.tick();
    timer = setTimeout(loop, pollMs);
  };
  void loop();
  const shutdown = () => {
    clearTimeout(timer);
    supervisor.stopAll();
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
