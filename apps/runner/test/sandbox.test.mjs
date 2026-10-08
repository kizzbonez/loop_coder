import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agentRoots, resolveAgentPath } from '../src/paths.mjs';
import { createSandbox } from '../src/sandbox.mjs';

const roots = agentRoots('acme/shop');

test('an agent may use only its project folder and the project worktrees folder', () => {
  assert.deepEqual(roots, ['acme/shop', 'acme/shop.worktrees']);
  assert.deepEqual(resolveAgentPath('acme/shop/src/a.ts', roots), { rel: 'acme/shop/src/a.ts' });
  assert.deepEqual(resolveAgentPath('/workspaces/acme/shop/README.md', roots), { rel: 'acme/shop/README.md' });
  assert.deepEqual(resolveAgentPath('./acme/shop.worktrees/bot-123abc/', roots), { rel: 'acme/shop.worktrees/bot-123abc' });
  assert.deepEqual(resolveAgentPath('acme\\shop\\x', roots), { rel: 'acme/shop/x' });
  for (const bad of ['acme/shop/../other/x', 'acme/shopping/x', 'acme/other', '/etc/passwd', '../secrets', 'acme', '', 'acme/shop/\0x', '/workspaces/../etc']) {
    assert.ok(resolveAgentPath(bad, roots).error, `should refuse ${JSON.stringify(bad)}`);
  }
  assert.throws(() => agentRoots('../etc'));
  assert.throws(() => agentRoots('acme'));
});

function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'runner-ws-'));
  mkdirSync(path.join(dir, 'acme', 'shop', 'src'), { recursive: true });
  mkdirSync(path.join(dir, 'acme', 'other'), { recursive: true });
  writeFileSync(path.join(dir, 'acme', 'shop', 'src', 'app.js'), 'const a = 1;\r\nconst b = 2;\r\n');
  writeFileSync(path.join(dir, 'acme', 'other', 'secret.txt'), 'not yours');
  return dir;
}

test('file operations: list, read, write and edit (keeping Windows line endings)', async () => {
  const dir = workspace();
  const sandbox = createSandbox({ workspacesDir: dir, home: dir });
  const listed = await sandbox.fileOp({ op: 'list', rel: 'acme/shop', roots });
  assert.equal(listed.ok, true);
  assert.match(listed.text, /src\/\nsrc\/app\.js/);

  const read = await sandbox.fileOp({ op: 'read', rel: 'acme/shop/src/app.js', roots });
  assert.match(read.text, /^ {4}1 {2}const a = 1;\n {4}2 {2}const b = 2;/);

  const wrote = await sandbox.fileOp({ op: 'write', rel: 'acme/shop/docs/new/notes.md', roots, content: '# Notes\n' });
  assert.equal(wrote.ok, true);
  assert.equal(readFileSync(path.join(dir, 'acme/shop/docs/new/notes.md'), 'utf8'), '# Notes\n');

  const edited = await sandbox.fileOp({ op: 'edit', rel: 'acme/shop/src/app.js', roots, old_text: 'const b = 2;', new_text: 'const b = 3;' });
  assert.equal(edited.ok, true);
  assert.equal(readFileSync(path.join(dir, 'acme/shop/src/app.js'), 'utf8'), 'const a = 1;\r\nconst b = 3;\r\n');

  const twice = await sandbox.fileOp({ op: 'edit', rel: 'acme/shop/src/app.js', roots, old_text: 'const', new_text: 'let' });
  assert.match(twice.error, /appears 2 times/);
  const missing = await sandbox.fileOp({ op: 'read', rel: 'acme/shop/nope.txt', roots });
  assert.deepEqual(missing, { ok: false, error: 'No such file or folder.' });
});

test('file operations refuse a link that leads outside the agent’s folders', async (t) => {
  const dir = workspace();
  try {
    symlinkSync(path.join(dir, 'acme', 'other'), path.join(dir, 'acme', 'shop', 'escape'), 'junction');
  } catch {
    t.skip('cannot create links here');
    return;
  }
  const sandbox = createSandbox({ workspacesDir: dir, home: dir });
  const read = await sandbox.fileOp({ op: 'read', rel: 'acme/shop/escape/secret.txt', roots });
  assert.equal(read.ok, false);
  assert.match(read.error, /outside your folders/);
  const wrote = await sandbox.fileOp({ op: 'write', rel: 'acme/shop/escape/x.txt', roots, content: 'x' });
  assert.equal(wrote.ok, false);
});

test('the file tool cannot be pointed at another base folder', async () => {
  const dir = workspace();
  const sandbox = createSandbox({ workspacesDir: dir, home: dir });
  const read = await sandbox.fileOp({ op: 'read', rel: 'acme/shop/src/app.js', roots, base: path.join(dir, 'acme', 'other') });
  assert.equal(read.ok, true);
});

const posixShell = process.platform !== 'win32';

test('commands run in a clean environment, and their output and exit code come back', { skip: !posixShell && 'needs a POSIX shell' }, async () => {
  const dir = workspace();
  process.env.LOOP_TEST_SECRET = 'must-not-leak';
  const sandbox = createSandbox({ workspacesDir: dir, home: dir });
  const r = await sandbox.command('echo "$HOME"; env | sort; exit 3', { cwd: path.join(dir, 'acme', 'shop'), timeoutMs: 10_000, git: { name: 'Ada', email: 'ada@example.com' } });
  assert.equal(r.exitCode, 3);
  assert.match(r.output, /GIT_AUTHOR_EMAIL=ada@example.com/);
  assert.doesNotMatch(r.output, /must-not-leak|LOOP_/);
  delete process.env.LOOP_TEST_SECRET;
});

test('a command that runs too long is stopped, with whatever it started', { skip: !posixShell && 'needs a POSIX shell' }, async () => {
  const dir = workspace();
  const sandbox = createSandbox({ workspacesDir: dir, home: dir });
  const r = await sandbox.command('(sleep 30 &) ; echo started; sleep 30', { cwd: dir, timeoutMs: 500 });
  assert.equal(r.timedOut, true);
  assert.match(r.output, /started/);
  assert.ok(r.ms < 5000);
});

const root = typeof process.getuid === 'function' && process.getuid() === 0;

test('as root, tools run as the agents’ user, which cannot read the runner’s secrets', { skip: !root && 'needs root (runs in the runner image)' }, async () => {
  const dir = workspace();
  const { chmodSync, chownSync } = await import('node:fs');
  chownSync(dir, 1000, 1000);
  for (const p of ['acme', 'acme/shop', 'acme/shop/src', 'acme/shop/src/app.js']) chownSync(path.join(dir, p), 1000, 1000);
  const secretFile = path.join(tmpdir(), `runner-secret-${process.pid}`);
  writeFileSync(secretFile, 'top secret');
  chmodSync(secretFile, 0o600);
  const sandbox = createSandbox({ workspacesDir: dir, uid: 1000, gid: 1000, home: dir });
  const r = await sandbox.command(`id -u; cat ${secretFile}; cat /proc/1/environ; cat /proc/${process.pid}/environ`, { cwd: path.join(dir, 'acme', 'shop'), timeoutMs: 10_000 });
  assert.match(r.output, /^1000\n/);
  assert.doesNotMatch(r.output, /top secret/);
  assert.match(r.output, /Permission denied/);
  const wrote = await sandbox.fileOp({ op: 'write', rel: 'acme/shop/by-agent.txt', roots, content: 'x' });
  assert.equal(wrote.ok, true);
  const { statSync } = await import('node:fs');
  assert.equal(statSync(path.join(dir, 'acme/shop/by-agent.txt')).uid, 1000);
});
