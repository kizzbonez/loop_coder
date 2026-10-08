import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentWorker, parseStatus, stepTitle, systemPrompt } from '../src/agent.mjs';
import { BudgetError, ModelError } from '../src/models.mjs';
import { createSupervisor } from '../src/supervisor.mjs';
import { buildToolset } from '../src/tools.mjs';

const agent = (over = {}) => ({ id: 'a1', name: 'Gemma', projectId: 'p1', projectKey: 'SHOP', workspacePath: 'acme/shop', providerKind: 'openai_compatible', model: 'gemini-3.8-flash', maxTurnsPerStep: 5, canRunCommands: true, token: 'tok1', git: { name: 'Ada', email: 'ada@example.com' }, ...over });
const WORK = '# SHOP-1: you are acting as the **Backend Developer**\nDo it.';
const silentLog = { info() {}, warn() {}, error() {} };

/** A board that answers get_next_work / wait_for_work from a script and records every call. */
function fakeBoard(script) {
  const calls = [];
  return {
    calls,
    connectMcp: async ({ token, agentName }) => ({
      listTools: async () => ['get_next_work', 'wait_for_work', 'move_work_item', 'log_progress'].map((name) => ({ name, description: name, inputSchema: { type: 'object' } })),
      call: async (name, args) => {
        calls.push({ name, args, token, agentName });
        if (name === 'get_next_work' || name === 'wait_for_work') return { text: script.shift() ?? 'STATUS: STOPPED\nStopped.', isError: false };
        return { text: `${name} ok`, isError: false };
      },
      close: async () => {},
    }),
  };
}

function fakeModel(turns) {
  const seen = [];
  return {
    seen,
    createModel: () => ({
      conversation: (system, first, tools) => {
        seen.push({ system, first, tools: tools.map((t) => t.name) });
        return {
          next: async () => {
            const turn = turns.shift();
            if (turn instanceof Error) throw turn;
            return turn ?? { calls: [], text: '', stopReason: 'end_turn' };
          },
          addResults: (results) => seen.push({ results }),
          nudge: (text) => seen.push({ nudge: text }),
        };
      },
    }),
  };
}

function worker(board, model, over = {}) {
  const reports = [];
  const w = new AgentWorker(agent(over), {
    api: { report: async (_id, u) => reports.push(u), budget: async () => 1000 },
    connectMcp: board.connectMcp,
    createModel: model.createModel,
    sandbox: { fileOp: async (req) => ({ ok: true, text: `${req.op} ${req.rel}` }), command: async () => ({ exitCode: 0, output: 'ok', timedOut: false, ms: 1 }) },
    workspacesDir: '/workspaces',
    mcpUrl: 'http://api:3000/mcp',
    version: '0.9.0',
    log: silentLog,
    sleep: async () => {},
  });
  return { w, reports };
}

test('status lines and step titles', () => {
  assert.deepEqual(parseStatus('STATUS: PAUSED\nThe project is paused.\nDo not end'), { status: 'PAUSED', message: 'The project is paused.' });
  assert.equal(parseStatus(WORK), null);
  assert.equal(stepTitle(WORK), 'SHOP-1: you are acting as the Backend Developer');
  const prompt = systemPrompt(agent(), ['acme/shop', 'acme/shop.worktrees']);
  assert.match(prompt, /"Gemma"/);
  assert.match(prompt, /`acme\/shop` and `acme\/shop.worktrees`/);
  assert.match(prompt, /at most 5 rounds/);
  assert.match(systemPrompt(agent({ canRunCommands: false }), ['a/b', 'a/b.worktrees']), /cannot run commands/);
});

test('does a step with its model, finishing with the tool the instructions name, then stops when told', async () => {
  const board = fakeBoard([WORK, 'STATUS: STOPPED\nA human stopped you.']);
  const model = fakeModel([
    { calls: [{ id: '1', name: 'read_file', input: { path: 'acme/shop/a.js' } }, { id: '2', name: 'read_file', input: { path: '/etc/passwd' } }], text: '', stopReason: 'tool_use' },
    { calls: [{ id: '3', name: 'move_work_item', input: { item: 'SHOP-1', to: 'review', remark: 'Built' } }], text: '', stopReason: 'tool_use' },
  ]);
  const { w, reports } = worker(board, model);
  await w.run();
  // The runner fetched work itself; the model never got get_next_work / wait_for_work.
  assert.deepEqual(model.seen[0].tools.slice(0, 2), ['move_work_item', 'log_progress']);
  assert.ok(!model.seen[0].tools.includes('get_next_work'));
  assert.ok(model.seen[0].tools.includes('run_command'));
  assert.equal(model.seen[0].first, WORK);
  const results = model.seen[1].results;
  assert.deepEqual(results[0], { id: '1', text: 'read acme/shop/a.js', isError: false });
  assert.equal(results[1].isError, true);
  assert.deepEqual(board.calls.map((c) => c.name), ['get_next_work', 'move_work_item', 'get_next_work']);
  assert.ok(board.calls.every((c) => c.token === 'tok1' && c.agentName === 'Gemma'));
  assert.ok(board.calls.filter((c) => c.name === 'get_next_work').every((c) => c.args.project === 'SHOP'));
  assert.deepEqual(board.calls[1].args, { item: 'SHOP-1', to: 'review', remark: 'Built' });
  assert.deepEqual(reports.map((r) => r.activity), ['Connecting to the board…', 'SHOP-1: you are acting as the Backend Developer', 'Stopped from the board']);
  assert.equal(reports.at(-1).stopped, true);
});

test('waits without the model while the board is paused or waiting', async () => {
  const board = fakeBoard(['STATUS: PAUSED\nThe project is paused.', 'STATUS: WAITING\nWaiting for an answer.', 'STATUS: COMPLETE\nAll done.']);
  const model = fakeModel([]);
  const { w, reports } = worker(board, model);
  await w.run();
  assert.equal(model.seen.length, 0);
  assert.deepEqual(board.calls.map((c) => [c.name, c.args.seconds]), [['get_next_work', undefined], ['wait_for_work', 45], ['wait_for_work', 45]]);
  assert.deepEqual(reports.map((r) => r.activity), ['Connecting to the board…', 'Paused: The project is paused.', 'Waiting: Waiting for an answer.', 'The project is complete']);
});

test('reminds a model that stops early once, then counts it as a failure; stops after three', async () => {
  const board = fakeBoard([WORK, WORK, WORK]);
  const model = fakeModel([]);
  const { w, reports } = worker(board, model);
  await w.run();
  assert.equal(model.seen.filter((s) => s.nudge).length, 3);
  const last = reports.at(-1);
  assert.equal(last.stopped, true);
  assert.equal(last.activity, 'Stopped after repeated failures');
  assert.match(last.error, /stopped without finishing/);
});

test('a spent budget waits for the next day instead of failing', async () => {
  const board = fakeBoard([WORK, 'STATUS: STOPPED\nStopped.']);
  const model = fakeModel([new BudgetError('Daily token limit of 10,000 reached')]);
  const { w, reports } = worker(board, model);
  await w.run();
  assert.ok(reports.some((r) => /tomorrow/.test(r.activity) && /Daily token limit/.test(r.error)));
  assert.equal(reports.at(-1).stopped, true);
});

test('runs out of tool rounds', async () => {
  const board = fakeBoard([WORK, 'STATUS: STOPPED\nx']);
  const loop = Array.from({ length: 5 }, (_, i) => ({ calls: [{ id: String(i), name: 'log_progress', input: { message: 'hm' } }], text: '', stopReason: 'tool_use' }));
  const model = fakeModel(loop);
  const { w, reports } = worker(board, model);
  await w.run();
  assert.ok(reports.some((r) => /all 5 tool rounds/.test(r.error ?? '')));
});

test('tools: Loop Coder tools pass through, local tools stay in the agent’s folders, no commands when not allowed', async () => {
  const mcpCalls = [];
  const { tools, run } = buildToolset({
    mcpTools: [{ name: 'get_next_work' }, { name: 'add_remark', description: 'x', inputSchema: { type: 'object' } }],
    callMcp: async (name, args) => (mcpCalls.push([name, args]), { text: 'ok', isError: false }),
    sandbox: { fileOp: async (r) => ({ ok: true, text: JSON.stringify(r) }) },
    roots: ['acme/shop', 'acme/shop.worktrees'],
    workspacesDir: '/workspaces',
    canRunCommands: false,
    git: { name: 'A', email: 'a@x' },
  });
  assert.deepEqual(tools.map((t) => t.name), ['add_remark', 'list_files', 'read_file', 'write_file', 'edit_file']);
  assert.deepEqual(await run('add_remark', { item: 'SHOP-1' }), { text: 'ok', isError: false });
  assert.equal((await run('run_command', { command: 'id' })).isError, true);
  assert.equal((await run('get_next_work', {})).isError, true);
  const read = await run('read_file', { path: 'acme/shop/a', base: '/', roots: ['/'] });
  assert.deepEqual(JSON.parse(read.text).roots, ['acme/shop', 'acme/shop.worktrees']);
  assert.equal(JSON.parse(read.text).base, undefined);
  assert.equal((await run('read_file', { path: 'acme/other/a' })).isError, true);
});

test('commands run in the workspaces directory by default, or in one of the agent’s folders', async () => {
  const runs = [];
  const { run } = buildToolset({
    mcpTools: [],
    callMcp: async () => ({ text: '', isError: false }),
    sandbox: { command: async (cmd, o) => (runs.push([cmd, o.cwd, o.timeoutMs, o.git.email]), { exitCode: 1, output: 'fatal: nope', timedOut: false, ms: 5 }) },
    roots: ['acme/shop', 'acme/shop.worktrees'],
    workspacesDir: '/workspaces',
    canRunCommands: true,
    git: { name: 'Ada', email: 'ada@example.com' },
  });
  const failed = await run('run_command', { command: 'git -C acme/shop status' });
  assert.deepEqual(failed, { text: 'Exit code 1 (0.0s).\nfatal: nope', isError: true });
  await run('run_command', { command: 'npm test', cwd: 'acme/shop.worktrees/gemma-1a2b3c', timeout_seconds: 9999 });
  assert.equal((await run('run_command', { command: 'ls', cwd: 'acme/other' })).isError, true);
  const sep = process.platform === 'win32' ? '\\' : '/';
  assert.deepEqual(runs, [
    ['git -C acme/shop status', `${sep}workspaces`, 120_000, 'ada@example.com'],
    ['npm test', ['', 'workspaces', 'acme', 'shop.worktrees', 'gemma-1a2b3c'].join(sep), 600_000, 'ada@example.com'],
  ]);
});

test('supervisor: starts listed agents, passes on new tokens, stops the rest', async () => {
  let items = [agent()];
  const made = [];
  const sup = createSupervisor({
    api: { listAgents: async () => items },
    log: silentLog,
    makeWorker: (a) => {
      const w = { agent: a, stopped: false, run: () => new Promise(() => {}), update(next) { this.agent = next; }, stop() { this.stopped = true; } };
      made.push(w);
      return w;
    },
  });
  await sup.tick();
  assert.equal(made.length, 1);
  items = [agent({ token: 'tok2' })];
  await sup.tick();
  assert.equal(made.length, 1);
  assert.equal(made[0].agent.token, 'tok2');
  items = [];
  await sup.tick();
  assert.equal(made[0].stopped, true);
  assert.equal(sup.workers.size, 0);
});

test('supervisor: an agent that ended on its own is not restarted at once', async () => {
  let clock = 0;
  const made = [];
  const sup = createSupervisor({
    api: { listAgents: async () => [agent()] },
    log: silentLog,
    now: () => clock,
    makeWorker: () => {
      const w = { run: async () => { throw new ModelError('boom'); }, update() {}, stop() {} };
      made.push(w);
      return w;
    },
  });
  await sup.tick();
  await new Promise((r) => setImmediate(r));
  await sup.tick();
  assert.equal(made.length, 1);
  clock = 61_000;
  await sup.tick();
  assert.equal(made.length, 2);
});
