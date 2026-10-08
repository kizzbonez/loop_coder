import { beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { Express } from 'express';
import { db } from '../../src/db/client';
import { activities, agentPresenceLog, agentRoles, boardColumns, taskRemarks, tasks, users } from '../../src/db/schema';
import { DEFAULT_ROLES } from '../../src/modules/roles/default-roles';
import { LEGACY_PROJECT_MANAGER_INSTRUCTIONS, LEGACY_SOFTWARE_ENGINEER_INSTRUCTIONS } from '../../src/modules/roles/legacy-roles';
import { seedDefaultRoles } from '../../src/modules/roles/roles.service';
import { upgradeLegacyRoles } from '../../src/modules/roles/roles.upgrade';
import { createProject, createToken, freshApp, mcpClient, setupAdmin, type Agent } from '../helpers';

let app: Express;
let human: Agent;
let projectId: string;
let taskId: string;
let userId: string;

const role = (key: string) => db.select().from(agentRoles).where(eq(agentRoles.key, key)).get();
const defaults = (key: string) => DEFAULT_ROLES.find((r) => r.key === key)!;

/** Turn today's database back into one from before 0.5.0: one Software Engineer, used everywhere. */
function makeLegacy(edits: Partial<{ name: string; instructions: string; pmInstructions: string }> = {}) {
  db.delete(agentRoles).where(inArray(agentRoles.key, ['backend_developer', 'frontend_developer'])).run();
  db.update(agentRoles)
    .set({
      key: 'software_engineer',
      name: edits.name ?? 'Software Engineer',
      description: 'Implements features and fixes with tests.',
      instructions: edits.instructions ?? LEGACY_SOFTWARE_ENGINEER_INSTRUCTIONS,
    })
    .where(eq(agentRoles.key, 'senior_developer'))
    .run();
  db.update(agentRoles)
    .set({ instructions: edits.pmInstructions ?? LEGACY_PROJECT_MANAGER_INSTRUCTIONS })
    .where(eq(agentRoles.key, 'project_manager'))
    .run();
  const engineer = role('software_engineer')!;
  db.update(tasks).set({ assignedRoleId: engineer.id, claimRoleKey: 'software_engineer' }).where(eq(tasks.id, taskId)).run();
  db.insert(activities)
    .values({ projectId, taskId, taskKey: 'SHOP-1', actorType: 'agent', actorUserId: userId, agentName: 'Claude Code', roleKey: 'software_engineer', action: 'task.started', message: 'started' })
    .run();
  db.insert(taskRemarks).values({ taskId, projectId, authorType: 'agent', authorUserId: userId, agentName: 'Claude Code', roleKey: 'software_engineer', kind: 'work_log', body: 'Built it' }).run();
  db.insert(agentPresenceLog).values({ projectId, sessionId: 's1', agentName: 'Claude Code', roleKey: 'software_engineer', taskId, taskKey: 'SHOP-1' }).run();
  return engineer;
}

beforeEach(async () => {
  app = freshApp();
  const admin = await setupAdmin(app);
  human = admin.agent;
  userId = admin.userId;
  projectId = (await createProject(human, admin.workspaceId)).id;
  taskId = (await human.post(`/api/projects/${projectId}/tasks`).send({ title: 'Search' }).expect(201)).body.id;
});

describe('upgrade to the developer roles (0.5.0)', () => {
  it('turns the Software Engineer into the Senior Developer, keeping everything that used it', () => {
    const engineer = makeLegacy();
    const columnsBefore = db.select().from(boardColumns).where(eq(boardColumns.agentRoleId, engineer.id)).all();
    expect(columnsBefore.length).toBeGreaterThan(0); // To Do and In Progress default to it

    expect(upgradeLegacyRoles()).toBe(true);
    seedDefaultRoles();

    const senior = role('senior_developer')!;
    expect(senior.id).toBe(engineer.id); // the same role, renamed
    expect(senior).toMatchObject({ name: 'Senior Developer', description: defaults('senior_developer').description, instructions: defaults('senior_developer').instructions, isSystem: true });
    expect(role('software_engineer')).toBeUndefined();
    expect(role('backend_developer')).toMatchObject({ name: 'Backend Developer', assignable: true, isSystem: true });
    expect(role('frontend_developer')).toMatchObject({ name: 'Frontend Developer', assignable: true, isSystem: true });
    expect(db.select().from(boardColumns).where(eq(boardColumns.agentRoleId, senior.id)).all()).toHaveLength(columnsBefore.length);

    // The item, its claim and the history follow the rename.
    expect(db.select().from(tasks).where(eq(tasks.id, taskId)).get()).toMatchObject({ assignedRoleId: senior.id, claimRoleKey: 'senior_developer' });
    expect(db.select({ k: activities.roleKey }).from(activities).where(eq(activities.action, 'task.started')).get()!.k).toBe('senior_developer');
    expect(db.select({ k: taskRemarks.roleKey }).from(taskRemarks).get()!.k).toBe('senior_developer');
    expect(db.select({ k: agentPresenceLog.roleKey }).from(agentPresenceLog).get()!.k).toBe('senior_developer');

    // The Project Manager now knows when to pick each developer.
    expect(role('project_manager')!.instructions).toBe(defaults('project_manager').instructions);
    expect(role('project_manager')!.instructions).toContain('backend_developer for server-side implementation');

    // Running it again changes nothing.
    expect(upgradeLegacyRoles()).toBe(false);
  });

  it('keeps names and instructions an administrator changed', () => {
    makeLegacy({ name: 'Full-stack Engineer', instructions: 'Our own rules.', pmInstructions: 'Our own PM rules.' });
    upgradeLegacyRoles();
    expect(role('senior_developer')).toMatchObject({ name: 'Full-stack Engineer', instructions: 'Our own rules.' });
    expect(role('project_manager')!.instructions).toBe('Our own PM rules.');
  });

  it('leaves both alone when a Senior Developer role already exists', () => {
    const engineer = makeLegacy();
    db.insert(agentRoles)
      .values({ key: 'senior_developer', name: 'Senior Dev (custom)', description: '', instructions: 'x', color: '#000000', isSystem: false, enabled: true, assignable: true })
      .run();
    expect(upgradeLegacyRoles()).toBe(false);
    expect(role('software_engineer')!.id).toBe(engineer.id);
    expect(role('senior_developer')!.name).toBe('Senior Dev (custom)');
  });

  it('does nothing on a new install', () => {
    expect(upgradeLegacyRoles()).toBe(false);
    expect(role('senior_developer')!.instructions).toBe(defaults('senior_developer').instructions);
    expect(db.select({ n: users.id }).from(users).all().length).toBeGreaterThan(0);
  });
});

describe('work with the developer roles', () => {
  it('gives each item to the developer it was assigned to, and unassigned ones to the Senior Developer', async () => {
    // A project of its own, without the extra unrefined item made above.
    const other = await createProject(human, (await human.get('/api/workspaces').expect(200)).body.items[0].id, 'AUTH');
    const P = { project: 'AUTH' };
    const agents = await Promise.all([1, 2, 3].map(async () => mcpClient(app, await createToken(human))));
    for (const a of agents) await a.initialize('claude-code');
    const [pm] = agents;
    await pm!.ok('get_next_work', P); // kickoff
    await pm!.ok('create_work_items', {
      ...P,
      items: [
        { title: 'Login API', story_points: 3, acceptance_criteria: '- Returns a session', refined: true, priority: 'critical', assigned_role: 'backend_developer' },
        { title: 'Login form', story_points: 3, acceptance_criteria: '- Shows errors', refined: true, priority: 'high', assigned_role: 'frontend_developer', depends_on: [] },
        { title: 'Sessions across tabs', story_points: 3, acceptance_criteria: '- Stays signed in', refined: true, priority: 'medium' },
      ],
    });
    await pm!.ok('complete_kickoff', { ...P, summary: 'ok' });
    await pm!.ok('get_next_work', P); // sprint planning
    await pm!.ok('start_sprint', { ...P, goal: 'People can sign in', items: ['AUTH-1', 'AUTH-2', 'AUTH-3'] });

    const prompts = [];
    for (const a of agents) prompts.push(await a.ok('get_next_work', P));
    expect(prompts[0]).toContain('AUTH-1: you are acting as the **Backend Developer**');
    expect(prompts[0]).toContain('You are the Backend Developer.');
    expect(prompts[1]).toContain('AUTH-2: you are acting as the **Frontend Developer**');
    expect(prompts[1]).toContain('WCAG 2.2 AA');
    expect(prompts[2]).toContain('AUTH-3: you are acting as the **Senior Developer**');
    expect(other.id).toBeTruthy();
  });

  it('refuses an unknown developer role and lists the right ones', async () => {
    const claude = mcpClient(app, await createToken(human));
    await claude.initialize('claude-code');
    await claude.ok('get_next_work', { project: 'SHOP' });
    const res = await claude.call('create_work_items', { project: 'SHOP', items: [{ title: 'X', assigned_role: 'software_engineer' }] });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Unknown role "software_engineer"');
    expect(res.text).toMatch(/backend_developer.*frontend_developer|frontend_developer.*backend_developer/);
    expect(res.text).toContain('senior_developer');
  });
});
