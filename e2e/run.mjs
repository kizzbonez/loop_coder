// Runs Playwright against an isolated, throwaway Docker stack (own compose project, port and volume).
//   npm run e2e                     build, start, run the E2E suite, tear down
//   npm run docs:screenshots        same, but runs the user-guide screenshot script
//   E2E_KEEP=1 npm run e2e          keep the stack running afterwards for debugging
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const project = process.env.E2E_COMPOSE_PROJECT ?? 'loopcoder-e2e';
const port = process.env.E2E_PORT ?? '18090';
const workspaces = process.env.E2E_WORKSPACES ?? './e2e/.workspaces';
const env = {
  ...process.env,
  WEB_PORT: port,
  BIND_ADDRESS: '127.0.0.1',
  // Override values from the developer's .env (e.g. a public domain or a fixed setup code).
  APP_ORIGIN: `http://localhost:${port}`,
  COOKIE_SECURE: 'auto',
  SETUP_CODE: 'E2E-SETUP-CODE-0001',
  // A throwaway master key so the tests can store (fake) AI provider keys.
  LOOP_SECRETS_KEY: 'e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0',
  // Lets the tests start API agents (the e2e stack has no runner, so they never call a model).
  LOOP_RUNNER_SECRET: 'e2e-runner-secret-e2e-runner-secret-0000',
  // Test the secure default, not the framing allowed for the developer's own sites.
  FRAME_ANCESTORS: 'none',
  // Never share the real stack's edge network (where a tunnel connector may be attached).
  EDGE_NETWORK: `${project}-edge`,
  WORKSPACES_HOST_DIR: workspaces,
  RATE_LIMIT_ENABLED: 'false',
  E2E_BASE_URL: `http://localhost:${port}`,
};
rmSync(resolve(root, workspaces), { recursive: true, force: true });
mkdirSync(resolve(root, workspaces), { recursive: true });

const compose = (...args) => spawnSync('docker', ['compose', '-p', project, ...args], { cwd: root, env, stdio: 'inherit' });

compose('down', '-v', '--remove-orphans');
// No runner: API agents can be started, but no model is ever called.
const up = compose('up', '-d', '--build', '--wait', '--scale', 'runner=0');
if (up.status !== 0) {
  console.error('Failed to start the test stack');
  process.exit(up.status ?? 1);
}

const test = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], { cwd: here, env, stdio: 'inherit', shell: true });

if (!process.env.E2E_KEEP) compose('down', '-v', '--remove-orphans');
process.exit(test.status ?? 1);
