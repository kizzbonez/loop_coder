// Runs an agent's file operations and shell commands as the unprivileged tool user, in a clean
// environment: none of the runner's secrets (its own secret, the agents' access tokens) reach
// them, and that user can neither read the runner's memory nor its environment.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FS_TOOL = fileURLToPath(new URL('./fs-tool.mjs', import.meta.url));
const MAX_OUTPUT = 30_000;

/**
 * @param {{ workspacesDir: string, uid?: number, gid?: number, home: string, gitConfig?: string, shell?: string }} config
 */
export function createSandbox(config) {
  const ids = config.uid === undefined ? {} : { uid: config.uid, gid: config.gid ?? config.uid };

  /** The only variables a tool process gets. */
  const cleanEnv = (git) => ({
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: config.home,
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    NO_COLOR: '1',
    CI: 'true',
    npm_config_update_notifier: 'false',
    ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH } : {}),
    ...(config.gitConfig ? { GIT_CONFIG_GLOBAL: config.gitConfig } : {}),
    ...(git ? { GIT_AUTHOR_NAME: git.name, GIT_AUTHOR_EMAIL: git.email, GIT_COMMITTER_NAME: git.name, GIT_COMMITTER_EMAIL: git.email } : {}),
  });

  /** One file operation (see fs-tool.mjs). Resolves { ok, text } or { ok: false, error }. */
  function fileOp(request) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [FS_TOOL], { ...ids, cwd: config.workspacesDir, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 });
      let out = '';
      child.stdout.setEncoding('utf8').on('data', (d) => (out += d));
      child.stderr.resume();
      child.on('error', (err) => resolve({ ok: false, error: `Could not run the file tool: ${err.code ?? err.message}` }));
      child.on('close', () => {
        try {
          resolve(JSON.parse(out));
        } catch {
          resolve({ ok: false, error: 'The file tool failed.' });
        }
      });
      child.stdin.end(JSON.stringify({ ...request, base: config.workspacesDir }));
    });
  }

  /**
   * A shell command in `cwd` (absolute). Its whole process group is killed when it ends or times
   * out, so nothing it started in the background keeps running.
   */
  function command(cmd, { cwd, timeoutMs, git, signal }) {
    return new Promise((resolve) => {
      const started = Date.now();
      const child = spawn(config.shell ?? '/bin/sh', ['-c', cmd], { ...ids, cwd, env: cleanEnv(git), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      let output = '';
      let dropped = 0;
      const take = (d) => {
        if (output.length < MAX_OUTPUT) output += d;
        else dropped += d.length;
      };
      child.stdout.setEncoding('utf8').on('data', take);
      child.stderr.setEncoding('utf8').on('data', take);
      const killGroup = () => {
        try {
          if (process.platform === 'win32') child.kill('SIGKILL');
          else process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      };
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killGroup();
      }, timeoutMs);
      const onAbort = () => killGroup();
      signal?.addEventListener('abort', onAbort, { once: true });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ exitCode: -1, output: `Could not start the command: ${err.code ?? err.message}`, timedOut: false, ms: Date.now() - started });
      });
      child.on('close', (code, sig) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        killGroup();
        const tail = dropped ? `\n… (${dropped} more characters of output not shown)` : '';
        resolve({ exitCode: code ?? (sig ? 128 : -1), output: output + tail, timedOut, ms: Date.now() - started });
      });
    });
  }

  return { fileOp, command, cleanEnv };
}
