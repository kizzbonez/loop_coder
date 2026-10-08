import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import {
  columnId,
  createProject,
  createToken,
  freshApp,
  mcpClient,
  setupAdmin,
  type Agent,
  type McpClient,
} from '../helpers';

let app: Express;
let human: Agent;
let project: Awaited<ReturnType<typeof createProject>>;
let mcp: McpClient;

const AC = '- Given a visitor\n- When they sign up\n- Then an account exists';

beforeEach(async () => {
  app = freshApp();
  const admin = await setupAdmin(app);
  human = admin.agent;
  project = await createProject(human, admin.workspaceId, 'SHOP', 'A todo app with accounts');
  mcp = mcpClient(app, await createToken(human));
  await mcp.initialize();
});

const P = { project: 'SHOP' };
const task = async (key: string) => {
  const list = (await human.get(`/api/projects/${project.id}/tasks`).expect(200)).body.items as Array<Record<string, unknown>>;
  const found = list.find((t) => t.key === key);
  if (!found) throw new Error(`no ${key}`);
  return found as { id: string; columnId: string; refined: boolean; sprintId: string | null; bounceCount: number; claim: unknown };
};

/** Run the kickoff: create an epic with two refined stories and one unrefined idea. */
async function kickoff(): Promise<void> {
  const work = await mcp.ok('get_next_work', P);
  expect(work).toContain('Project kickoff');
  expect(work).toContain('Project Manager');
  await mcp.ok('update_project_notes', { ...P, text: 'Stack: TypeScript + SQLite' });
  const created = await mcp.ok('create_work_items', {
    ...P,
    items: [
      { ref: 'auth', type: 'epic', title: 'Accounts', refined: true },
      { ref: 'signup', title: 'Sign up', parent: 'auth', story_points: 3, acceptance_criteria: AC, refined: true, priority: 'high' },
      {
        ref: 'login',
        title: 'Log in',
        parent: 'auth',
        story_points: 2,
        acceptance_criteria: AC,
        refined: true,
        depends_on: ['signup'],
        assigned_role: 'senior_developer',
      },
      { title: 'Dark mode idea', priority: 'low' },
    ],
  });
  expect(created).toContain('signup → SHOP-2');
  await mcp.ok('complete_kickoff', { ...P, summary: 'Backlog ready' });
}

describe('kickoff', () => {
  it('requires a backlog before the kickoff can complete', async () => {
    await mcp.ok('get_next_work', P);
    const res = await mcp.call('complete_kickoff', { ...P, summary: 'nothing' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/create_work_items/);
  });

  it('builds the backlog with parents and dependencies from refs', async () => {
    await kickoff();
    const signup = await task('SHOP-2');
    const login = (await human.get(`/api/tasks/${(await task('SHOP-3')).id}`).expect(200)).body;
    expect(login.parentId).toBe((await task('SHOP-1')).id);
    expect(login.dependsOn).toEqual([signup.id]);
    expect(login.createdByAgent).toBe(true);
    const detail = (await human.get(`/api/projects/${project.id}`).expect(200)).body;
    expect(detail.kickoffCompletedAt).not.toBeNull();
    expect(detail.notes).toContain('Stack: TypeScript + SQLite');
    await expect(mcp.call('complete_kickoff', { ...P, summary: 'again' })).resolves.toMatchObject({ isError: true });
  });

  it('rejects unknown roles with the list of valid ones', async () => {
    await mcp.ok('get_next_work', P);
    const res = await mcp.call('create_work_items', { ...P, items: [{ title: 'x', assigned_role: 'wizard' }] });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/senior_developer/);
  });
});

describe('the Scrum loop', () => {
  it('refines, plans, develops, reviews, tests and closes the sprint', async () => {
    await kickoff();

    // Backlog refinement of the unrefined idea (Project Manager).
    let work = await mcp.ok('get_next_work', P);
    expect(work).toContain('SHOP-4');
    expect(work).toContain('Current stage: Backlog');
    expect(work).toContain('Definition of Ready');
    expect((await mcp.call('mark_refined', { item: 'SHOP-4', summary: 'ready' })).text).toMatch(/story points/);
    await mcp.ok('update_work_item', { item: 'SHOP-4', story_points: 1, acceptance_criteria: AC, title: 'Dark mode toggle' });
    await mcp.ok('mark_refined', { item: 'SHOP-4', summary: 'Small and clear' });
    expect((await task('SHOP-4')).refined).toBe(true);

    // Sprint planning ceremony.
    work = await mcp.ok('get_next_work', P);
    expect(work).toContain('Sprint planning');
    expect(work).toContain('SHOP-2');
    expect(work).not.toContain('SHOP-1**'); // epics are not planned directly
    const bad = await mcp.call('start_sprint', { ...P, goal: 'x', items: ['SHOP-1'] });
    expect(bad.isError).toBe(true);
    const started = await mcp.ok('start_sprint', { ...P, goal: 'Users can sign up and log in', items: ['SHOP-2', 'SHOP-3'] });
    expect(started).toContain('5 points');
    expect((await task('SHOP-2')).columnId).toBe(columnId(project, 'todo'));

    // SHOP-3 depends on SHOP-2, so SHOP-2 comes first and is pulled into In Progress.
    work = await mcp.ok('get_next_work', P);
    expect(work).toContain('# SHOP-2');
    expect(work).toContain('Senior Developer');
    let signup = await task('SHOP-2');
    expect(signup.columnId).toBe(columnId(project, 'in_progress'));
    expect(signup.claim).toMatchObject({ roleKey: 'senior_developer' });
    await mcp.ok('log_progress', { ...P, item: 'SHOP-2', message: 'Writing the sign-up form' });
    await mcp.ok('move_work_item', { item: 'SHOP-2', to: 'review', remark: 'Implemented form + tests' });

    // Nothing for SHOP-3 yet (dependency open); the reviewer reviews SHOP-2.
    work = await mcp.ok('get_next_work', P);
    expect(work).toContain('# SHOP-2');
    expect(work).toContain('Code Reviewer');
    expect(work).toContain('Implemented form + tests');
    await mcp.ok('move_work_item', { item: 'SHOP-2', to: 'in_progress', remark: '1. Missing validation', kind: 'review' });
    signup = await task('SHOP-2');
    expect(signup.bounceCount).toBe(1);

    // Rework, then approval, then QA.
    work = await mcp.ok('get_next_work', P);
    expect(work).toContain('Senior Developer');
    expect(work).toContain('Missing validation');
    await mcp.ok('move_work_item', { item: 'SHOP-2', to: 'review', remark: 'Added validation' });
    await mcp.ok('get_next_work', P);
    await mcp.ok('move_work_item', { item: 'SHOP-2', to: 'testing', remark: 'LGTM', kind: 'review' });
    work = await mcp.ok('get_next_work', P);
    expect(work).toContain('QA Engineer');
    expect(work).toContain('Definition of Done');
    await mcp.ok('move_work_item', { item: 'SHOP-2', to: 'done', remark: '| AC | pass |', kind: 'test_report' });
    expect((await task('SHOP-2')).columnId).toBe(columnId(project, 'done'));

    // Now SHOP-3 is unblocked.
    work = await mcp.ok('get_next_work', P);
    expect(work).toContain('# SHOP-3');
    for (const to of ['review', 'testing', 'done']) {
      if (to !== 'review') await mcp.ok('get_next_work', P);
      await mcp.ok('move_work_item', { item: 'SHOP-3', to, remark: `to ${to}` });
    }
    // The epic completes itself once both stories are done.
    expect((await task('SHOP-1')).columnId).toBe(columnId(project, 'done'));

    // Sprint review & retrospective.
    work = await mcp.ok('get_next_work', P);
    expect(work).toContain('Sprint review');
    expect(work).toContain('SHOP-2');
    const closed = await mcp.ok('complete_sprint', { ...P, review_notes: 'Auth shipped', retro_notes: 'Split earlier' });
    expect(closed).toContain('2/2');

    // Next planning picks up the refined dark-mode item.
    work = await mcp.ok('get_next_work', P);
    expect(work).toContain('Sprint planning');
    await mcp.ok('start_sprint', { ...P, goal: 'Polish', items: ['SHOP-4'] });
    await mcp.ok('get_next_work', P);
    for (const to of ['review', 'testing', 'done']) {
      if (to !== 'review') await mcp.ok('get_next_work', P);
      await mcp.ok('move_work_item', { item: 'SHOP-4', to, remark: to });
    }
    await mcp.ok('get_next_work', P); // sprint review
    await mcp.ok('complete_sprint', { ...P, review_notes: 'Done', retro_notes: 'Good' });
    expect(await mcp.ok('get_next_work', P)).toMatch(/STATUS: COMPLETE/);

    // Everything was visible in the activity feed.
    const actions = new Set(
      ((await human.get(`/api/projects/${project.id}/activity?limit=200`).expect(200)).body.items as Array<{ action: string }>).map(
        (a) => a.action,
      ),
    );
    for (const a of ['task.created', 'task.started', 'task.moved', 'task.refined', 'sprint.started', 'sprint.completed', 'agent.progress', 'project.kickoff_completed']) {
      expect(actions).toContain(a);
    }
  });

  it('escalates to a human after too many rework cycles, and resumes after an answer', async () => {
    await kickoff();
    await human.get('/api/admin/settings').expect(200).then(async (r) => {
      r.body.agent.maxBounces = 1;
      await human.put('/api/admin/settings').send(r.body).expect(200);
    });
    await mcp.ok('get_next_work', P); // refine SHOP-4 first? It is unrefined: refine it to clear the way
    await mcp.ok('update_work_item', { item: 'SHOP-4', story_points: 1, acceptance_criteria: AC });
    await mcp.ok('mark_refined', { item: 'SHOP-4', summary: 'ok' });
    await mcp.ok('get_next_work', P);
    await mcp.ok('start_sprint', { ...P, goal: 'g', items: ['SHOP-2'] });

    await mcp.ok('get_next_work', P);
    await mcp.ok('move_work_item', { item: 'SHOP-2', to: 'review', remark: 'v1' });
    await mcp.ok('get_next_work', P);
    await mcp.ok('move_work_item', { item: 'SHOP-2', to: 'in_progress', remark: 'redo 1', kind: 'review' });
    await mcp.ok('get_next_work', P);
    await mcp.ok('move_work_item', { item: 'SHOP-2', to: 'review', remark: 'v2' });
    await mcp.ok('get_next_work', P);
    const escalated = await mcp.ok('move_work_item', { item: 'SHOP-2', to: 'in_progress', remark: 'redo 2', kind: 'review' });
    expect(escalated).toMatch(/escalated/);
    const blocked = await task('SHOP-2');
    expect(blocked.columnId).toBe(columnId(project, 'blocked'));

    const detail = (await human.get(`/api/tasks/${blocked.id}`).expect(200)).body;
    expect(detail.remarks.at(-1)).toMatchObject({ kind: 'system', authorType: 'system' });

    // Human answers and resumes: back to Code Review with a fresh rework budget.
    await human.post(`/api/tasks/${blocked.id}/remarks`).send({ body: 'Accept v2 as is', kind: 'answer', resume: true }).expect(201);
    const resumed = await task('SHOP-2');
    expect(resumed.columnId).toBe(columnId(project, 'review'));
    expect(resumed.bounceCount).toBe(0);
    expect(await mcp.ok('get_next_work', P)).toContain('Accept v2 as is');
  });

  it('request_human_input parks the item and the agent continues elsewhere', async () => {
    await kickoff();
    const work = await mcp.ok('get_next_work', P);
    expect(work).toContain('SHOP-4');
    await mcp.ok('request_human_input', { item: 'SHOP-4', question: 'Which colours?' });
    const parked = await task('SHOP-4');
    expect(parked.columnId).toBe(columnId(project, 'blocked'));
    expect(await mcp.ok('get_next_work', P)).toContain('Sprint planning');
    const moveToBlocked = await mcp.call('move_work_item', { item: 'SHOP-2', to: 'blocked', remark: 'x' });
    expect(moveToBlocked.isError).toBe(true);
  });

  it('reports waiting when only human-blocked work remains', async () => {
    await mcp.ok('get_next_work', P);
    await mcp.ok('create_work_items', { ...P, items: [{ title: 'Needs a decision' }] });
    await mcp.ok('complete_kickoff', { ...P, summary: 'ok' });
    await mcp.ok('get_next_work', P);
    await mcp.ok('request_human_input', { item: 'SHOP-1', question: '?' });
    const res = await mcp.ok('get_next_work', P);
    expect(res).toMatch(/STATUS: WAITING/);
    expect(res).toMatch(/Needs Human/);
  });
});

describe('controls and safety', () => {
  const setAgent = (agentState: string) => human.patch(`/api/projects/${project.id}`).send({ agentState }).expect(200);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('stops handing out work when the project is paused, and resumes', async () => {
    await setAgent('paused');
    const paused = await mcp.ok('get_next_work', P);
    expect(paused).toMatch(/STATUS: PAUSED/);
    expect(paused).toMatch(/Do not end your session: call `wait_for_work`/);
    await setAgent('active');
    expect(await mcp.ok('get_next_work', P)).toContain('Project kickoff');
  });

  it('keeps a paused agent waiting, and hands it work the moment a human resumes', async () => {
    await setAgent('paused');
    const started = Date.now();
    const waiting = mcp.ok('wait_for_work', { ...P, seconds: 20 });
    await sleep(300);
    await setAgent('active');
    const work = await waiting;
    expect(work).toContain('Project kickoff');
    expect(Date.now() - started).toBeLessThan(5_000); // woken by the resume, not by the time limit
  });

  it('gives up after its time limit so the agent can ask again', async () => {
    await setAgent('paused');
    const started = Date.now();
    const res = await mcp.ok('wait_for_work', { ...P, seconds: 1 });
    expect(res).toMatch(/STATUS: PAUSED/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    const limit = await mcp.call('wait_for_work', { ...P, seconds: 51 }); // MCP clients and proxies time out sooner
    expect(limit.isError).toBe(true);
  });

  it('tells a waiting agent to end its session when a human stops it, until resumed', async () => {
    await setAgent('paused');
    const waiting = mcp.ok('wait_for_work', { ...P, seconds: 20 });
    await sleep(300);
    await setAgent('stopped');
    const stopped = await waiting;
    expect(stopped).toMatch(/STATUS: STOPPED/);
    expect(stopped).toMatch(/End your session now/);
    // An agent that is still working hears it with its next get_next_work, and waiting returns at once.
    expect(await mcp.ok('get_next_work', P)).toMatch(/STATUS: STOPPED/);
    expect(await mcp.ok('wait_for_work', { ...P, seconds: 20 })).toMatch(/STATUS: STOPPED/);
    await setAgent('active');
    expect(await mcp.ok('get_next_work', P)).toContain('Project kickoff');
    const activity = (await human.get(`/api/projects/${project.id}/activity`).expect(200)).body.items as Array<{ action: string; message: string }>;
    const changes = activity.filter((a) => a.action.startsWith('agent.')).map((a) => a.action);
    expect(changes).toEqual(['agent.resumed', 'agent.stopped', 'agent.paused']);
    expect(activity.find((a) => a.action === 'agent.stopped')?.message).toMatch(/stopped the agent$/);
  });

  it('never claims work for an agent that went away while waiting', async () => {
    await setAgent('paused');
    // The client gives up after 300 ms (a timeout or a closed session).
    await expect(mcp.rpc('tools/call', { name: 'wait_for_work', arguments: { ...P, seconds: 20 } }).timeout(300)).rejects.toThrow(/Timeout/);
    await sleep(100);
    await setAgent('active');
    await sleep(300);
    // Had the abandoned wait claimed the kickoff, another session would be told to wait.
    const other = mcpClient(app, await createToken(human));
    expect(await other.ok('get_next_work', P)).toContain('Project kickoff');
  });

  it('waits for a human answer when nothing else can move', async () => {
    await mcp.ok('get_next_work', P);
    await mcp.ok('create_work_items', { ...P, items: [{ title: 'Needs a decision' }] });
    await mcp.ok('complete_kickoff', { ...P, summary: 'ok' });
    await mcp.ok('get_next_work', P);
    await mcp.ok('request_human_input', { item: 'SHOP-1', question: 'Which colour?' });
    expect(await mcp.ok('get_next_work', P)).toMatch(/STATUS: WAITING[\s\S]*call `wait_for_work`/);
    const waiting = mcp.ok('wait_for_work', { ...P, seconds: 20 });
    await sleep(300);
    const item = await task('SHOP-1');
    await human.post(`/api/tasks/${item.id}/remarks`).send({ body: 'Raspberry', kind: 'answer', resume: true }).expect(201);
    expect(await waiting).toContain('# SHOP-1');
  });

  it('honours the global admin kill switch', async () => {
    const settings = (await human.get('/api/admin/settings').expect(200)).body;
    settings.agent.enabled = false;
    await human.put('/api/admin/settings').send(settings).expect(200);
    expect(await mcp.ok('get_next_work', P)).toMatch(/STATUS: DISABLED/);
  });

  it('never gives two agents the same item, but resumes an agent\'s own claim', async () => {
    await kickoff();
    const second = mcpClient(app, await createToken(human));
    // Refinement of SHOP-4 goes to the first agent; asking again returns the same item.
    expect(await mcp.ok('get_next_work', P)).toContain('# SHOP-4');
    expect(await mcp.ok('get_next_work', P)).toContain('# SHOP-4');
    // The second agent must not get SHOP-4; it gets sprint planning instead.
    const other = await second.ok('get_next_work', P);
    expect(other).not.toContain('# SHOP-4');
    expect(other).toContain('Sprint planning');
    // And the first agent cannot run the planning ceremony at the same time.
    await mcp.ok('update_work_item', { item: 'SHOP-4', story_points: 1, acceptance_criteria: AC });
    await mcp.ok('mark_refined', { item: 'SHOP-4', summary: 'ok' });
    expect(await mcp.ok('get_next_work', P)).toMatch(/STATUS: WAITING/);
  });

  it('a claimed item cannot be released by another agent', async () => {
    await kickoff();
    await mcp.ok('get_next_work', P);
    const second = mcpClient(app, await createToken(human));
    const res = await second.call('release_work_item', { item: 'SHOP-4' });
    expect(res.isError).toBe(true);
    await mcp.ok('release_work_item', { item: 'SHOP-4', note: 'stopping' });
    expect((await task('SHOP-4')).claim).toBeNull();
  });

  it('respects the In Progress WIP limit when pulling new work', async () => {
    await kickoff();
    await human
      .patch(`/api/projects/${project.id}/columns/${columnId(project, 'in_progress')}`)
      .send({ wipLimit: 1 })
      .expect(200);
    const extra = (await human.post(`/api/projects/${project.id}/tasks`).send({ title: 'Already started', columnId: columnId(project, 'in_progress') }).expect(201)).body;
    await mcp.ok('get_next_work', P); // SHOP-4 refinement
    await mcp.ok('update_work_item', { item: 'SHOP-4', story_points: 1, acceptance_criteria: AC });
    await mcp.ok('mark_refined', { item: 'SHOP-4', summary: 'ok' });
    await mcp.ok('get_next_work', P);
    await mcp.ok('start_sprint', { ...P, goal: 'g', items: ['SHOP-2', 'SHOP-4'] });
    // In Progress is full (1/1), so the agent finishes the started item before pulling from To Do.
    expect(await mcp.ok('get_next_work', P)).toContain(`# ${extra.key}`);
  });

  it('skips items assigned to a human', async () => {
    await mcp.ok('get_next_work', P);
    await mcp.ok('create_work_items', { ...P, items: [{ title: 'Human only' }] });
    await mcp.ok('complete_kickoff', { ...P, summary: 'ok' });
    const me = (await human.get('/api/auth/me').expect(200)).body.user.id;
    await human.patch(`/api/tasks/${(await task('SHOP-1')).id}`).send({ assigneeUserId: me }).expect(200);
    expect(await mcp.ok('get_next_work', P)).toMatch(/STATUS: WAITING/);
  });

  it('uses the item\'s assigned role in development stages', async () => {
    await mcp.ok('get_next_work', P);
    await mcp.ok('create_work_items', {
      ...P,
      items: [{ title: 'Design system', assigned_role: 'ui_designer', story_points: 3, acceptance_criteria: AC, refined: true }],
    });
    await mcp.ok('complete_kickoff', { ...P, summary: 'ok' });
    await mcp.ok('get_next_work', P);
    await mcp.ok('start_sprint', { ...P, goal: 'Design', items: ['SHOP-1'] });
    const work = await mcp.ok('get_next_work', P);
    expect(work).toContain('UI/UX Designer');
    expect(work).toContain('WCAG');
  });

  it('keeps project notes bounded and supports replace', async () => {
    await mcp.ok('update_project_notes', { ...P, text: 'first' });
    await mcp.ok('update_project_notes', { ...P, text: 'second' });
    let notes = (await human.get(`/api/projects/${project.id}`).expect(200)).body.notes as string;
    expect(notes).toMatch(/first[\s\S]*second/);
    await mcp.ok('update_project_notes', { ...P, text: 'condensed', mode: 'replace' });
    notes = (await human.get(`/api/projects/${project.id}`).expect(200)).body.notes;
    expect(notes).toBe('condensed');
  });

  it('tracks agent presence for the live board', async () => {
    await mcp.ok('get_next_work', P);
    const detail = (await human.get(`/api/projects/${project.id}`).expect(200)).body;
    expect(detail.agent).toMatchObject({ online: true, clientName: 'claude-code 2.1.0', currentRoleKey: 'project_manager' });
    const sessions = (await human.get(`/api/projects/${project.id}/agent-sessions`).expect(200)).body.items;
    expect(sessions[0].toolCalls).toBeGreaterThanOrEqual(1);
  });

  it('lists and reads work items through MCP', async () => {
    await kickoff();
    const list = await mcp.ok('list_work_items', { ...P, column: 'backlog' });
    expect(list).toContain('SHOP-2');
    const item = await mcp.ok('get_work_item', { item: 'shop-3' });
    expect(item).toContain('Depends on: SHOP-2 (open)');
    expect(item).toContain('Parent epic: SHOP-1');
    await mcp.ok('add_remark', { item: 'SHOP-3', body: 'Note for later', kind: 'design' });
    expect(await mcp.ok('get_work_item', { item: 'SHOP-3' })).toContain('Note for later');
    const ctx = await mcp.ok('get_project_context', P);
    expect(ctx).toContain('Definition of Done');
    expect(ctx).toContain('Stack: TypeScript + SQLite');
  });
});
