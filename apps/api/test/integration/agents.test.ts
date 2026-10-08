import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { ProjectDTO } from '@loop/shared';
import { createProject, freshApp, mcpClient, setupAdmin, type Agent, type McpClient } from '../helpers';
import { agentFolder, gitContext, gitGuidance, slugify } from '../../src/modules/workflow/git';

let app: Express;
let human: Agent;
let project: ProjectDTO;

const AC = '- Given a visitor\n- When they sign up\n- Then an account exists';
const P = { project: 'SHOP' };

beforeEach(async () => {
  app = freshApp();
  const admin = await setupAdmin(app);
  human = admin.agent;
  const created = await createProject(human, admin.workspaceId, 'SHOP', 'A shop');
  project = (await human.get(`/api/projects/${created.id}`).expect(200)).body as ProjectDTO;
});

/** An agent with its own access token (optionally limited to some roles). */
async function agent(name: string, roleKeys?: string[]): Promise<{ mcp: McpClient; tokenId: string }> {
  const res = await human.post('/api/account/tokens').send({ name, expiresInDays: 30, ...(roleKeys ? { roleKeys } : {}) }).expect(201);
  const mcp = mcpClient(app, res.body.secret);
  await mcp.initialize();
  return { mcp, tokenId: res.body.token.id };
}

/** Kickoff with one refined story, then plan and start a sprint with it. */
async function startSprint(lead: McpClient): Promise<void> {
  expect(await lead.ok('get_next_work', P)).toContain('Project kickoff');
  await lead.ok('create_work_items', { ...P, items: [{ title: 'Sign up', story_points: 3, acceptance_criteria: AC, refined: true }] });
  await lead.ok('complete_kickoff', { ...P, summary: 'ok' });
  expect(await lead.ok('get_next_work', P)).toContain('Sprint planning');
  await lead.ok('start_sprint', { ...P, goal: 'Accounts', items: ['SHOP-1'] });
}

const folderOf = (name: string, tokenId: string) => `${slugify(name)}-${tokenId.replace(/-/g, '').slice(0, 6)}`;

describe('a git worktree per agent', () => {
  it('gives each agent its own worktree and every item its own branch, merged when done', async () => {
    expect(project).toMatchObject({ gitMode: 'worktrees', baseBranch: 'main' });
    const repo = project.workspacePath;
    const parent = repo.slice(0, repo.lastIndexOf('/') + 1);
    const dev = await agent('Dev laptop');
    const qa = await agent('QA box');
    const devTree = `${parent}shop.worktrees/${folderOf('Dev laptop', dev.tokenId)}`;
    const qaTree = `${parent}shop.worktrees/${folderOf('QA box', qa.tokenId)}`;
    expect(devTree).not.toBe(qaTree);

    await startSprint(dev.mcp);
    const build = await dev.mcp.ok('get_next_work', P);
    expect(build).toContain(`Work in **your own git worktree** \`${devTree}\` on the branch \`item/SHOP-1\``);
    expect(build).toContain(`git -C ${repo} worktree add --detach ../shop.worktrees/${folderOf('Dev laptop', dev.tokenId)} main`);
    expect(build).toContain('git switch -c item/SHOP-1 main');
    expect(build).toContain('git merge main');
    expect(build).toContain('git switch --detach` so the next agent can take it');
    await dev.mcp.ok('move_work_item', { item: 'SHOP-1', to: 'review', remark: 'Built' });

    // Another agent reviews in its own worktree, without taking the branch over.
    const review = await qa.mcp.ok('get_next_work', P);
    expect(review).toContain('Code Reviewer');
    expect(review).toContain(`\`${qaTree}\``);
    expect(review).toContain('git diff main...item/SHOP-1');
    expect(review).toContain('git switch --detach item/SHOP-1');
    expect(review).toContain(`git -C ${repo} merge --no-ff item/SHOP-1`); // if it goes straight to done
    await qa.mcp.ok('move_work_item', { item: 'SHOP-1', to: 'testing', remark: 'Approved', kind: 'review' });

    const test = await qa.mcp.ok('get_next_work', P);
    expect(test).toContain('QA Engineer');
    expect(test).toContain(`git -C ${repo} merge --no-ff item/SHOP-1 -m "SHOP-1: merge item/SHOP-1"`);
    expect(test).toContain(`git -C ${repo} merge --abort`);
    expect(test).toContain(`git -C ${repo} branch -d item/SHOP-1`);

    const context = await qa.mcp.ok('get_project_context', P);
    expect(context).toContain(`Git: your own worktree \`${qaTree}\``);
    expect(context).toContain('Roles: every role');
  });

  it('keeps the single project folder in shared mode', async () => {
    await human.patch(`/api/projects/${project.id}`).send({ gitMode: 'shared' }).expect(200);
    const lead = await agent('Lead');
    await startSprint(lead.mcp);
    const build = await lead.mcp.ok('get_next_work', P);
    expect(build).toContain(`Work in the project repository folder \`${project.workspacePath}\``);
    expect(build).not.toContain('## Git');
    expect(build).not.toContain('worktree');
  });

  it('accepts only branch names that are safe in git and in a shell', async () => {
    for (const baseBranch of ['master', 'develop', 'release/2.0', 'team_a/next-1']) {
      const res = await human.patch(`/api/projects/${project.id}`).send({ baseBranch }).expect(200);
      expect(res.body.baseBranch).toBe(baseBranch);
    }
    for (const baseBranch of ['main; rm -rf ~', '$(whoami)', '-main', 'a..b', 'x.lock', 'feature/', '/main', 'a b', '`id`', 'main|cat', '.hidden', '']) {
      await human.patch(`/api/projects/${project.id}`).send({ baseBranch }).expect(400);
    }
    await human.patch(`/api/projects/${project.id}`).send({ gitMode: 'svn' }).expect(400);
  });
});

describe('git helpers', () => {
  it('makes folder names that are safe in paths and commands', () => {
    expect(slugify('Dev Laptop #1 (ünïcode)')).toBe('dev-laptop-1-unicode');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('; rm -rf / $(id)')).toBe('rm-rf-id');
    expect(slugify('!!!')).toBe('agent');
    expect(agentFolder({ kind: 'agent', userId: 'u', userRole: 'user', name: 'A', email: 'a@x.io', tokenId: '3F9A2C11-0000-4000-8000-000000000000', tokenName: 'Dev laptop' })).toBe('dev-laptop-3f9a2c');
  });

  it('writes commands from safe parts only', () => {
    const g = gitContext({ key: 'SHOP', gitMode: 'worktrees', baseBranch: 'release/2.0' }, 'acme/shop', { kind: 'agent', userId: 'u', userRole: 'user', name: 'A', email: 'a@x.io', tokenId: 'abcdef12', tokenName: 'x' }, 'SHOP-7')!;
    for (const kind of ['todo', 'in_progress', 'review', 'testing'] as const) {
      const text = gitGuidance(kind, g, 'SHOP-7')!;
      for (const command of text.match(/`git [^`]*`/g) ?? []) expect(command, command).toMatch(/^`git [A-Za-z0-9 ._/:"-]+`$/);
    }
    expect(gitContext({ key: 'SHOP', gitMode: 'shared', baseBranch: 'main' }, 'acme/shop', { kind: 'user', userId: 'u', userRole: 'user', name: 'A', email: 'a@x.io' }, 'SHOP-7')).toBeNull();
  });
});

describe('roles per agent', () => {
  it('stores the roles on the token, and the owner can change them', async () => {
    const created = await human.post('/api/account/tokens').send({ name: 'Reviewer', expiresInDays: 30, roleKeys: ['code_reviewer', 'qa_engineer', 'qa_engineer'] }).expect(201);
    expect(created.body.token.roleKeys).toEqual(['code_reviewer', 'qa_engineer']);
    const id = created.body.token.id as string;
    const all = await human.patch(`/api/account/tokens/${id}`).send({ roleKeys: null }).expect(200);
    expect(all.body.roleKeys).toBeNull();
    const dev = await human.patch(`/api/account/tokens/${id}`).send({ roleKeys: ['frontend_developer'] }).expect(200);
    expect(dev.body.roleKeys).toEqual(['frontend_developer']);
    await human.patch(`/api/account/tokens/${id}`).send({ roleKeys: ['wizard'] }).expect(400);
    await human.patch(`/api/account/tokens/${id}`).send({ roleKeys: [] }).expect(400);
    await human.post('/api/account/tokens').send({ name: 'x', expiresInDays: 30, roleKeys: ['Project Manager'] }).expect(400);
    const list = (await human.get('/api/account/tokens').expect(200)).body.items as Array<{ id: string; roleKeys: string[] | null }>;
    expect(list.find((t) => t.id === id)?.roleKeys).toEqual(['frontend_developer']);
  });

  it('hands each agent only the work of its roles', async () => {
    const reviewer = await agent('Reviewer', ['code_reviewer', 'qa_engineer']);
    const developer = await agent('Developer', ['senior_developer', 'backend_developer', 'frontend_developer']);
    const lead = await agent('Lead', ['project_manager']);

    // Only a Project Manager may run the kickoff.
    expect(await reviewer.mcp.ok('get_next_work', P)).toMatch(/STATUS: WAITING[\s\S]*Project Manager/);
    await startSprint(lead.mcp);

    expect(await reviewer.mcp.ok('get_next_work', P)).toMatch(/STATUS: WAITING[\s\S]*Your roles: code_reviewer, qa_engineer/);
    expect(await lead.mcp.ok('get_next_work', P)).toMatch(/STATUS: WAITING/); // the build is not the lead's job
    const build = await developer.mcp.ok('get_next_work', P);
    expect(build).toContain('# SHOP-1: you are acting as the **Senior Developer**');
    await developer.mcp.ok('move_work_item', { item: 'SHOP-1', to: 'review', remark: 'Built' });

    expect(await developer.mcp.ok('get_next_work', P)).toMatch(/STATUS: WAITING/);
    expect(await reviewer.mcp.ok('get_next_work', P)).toContain('# SHOP-1: you are acting as the **Code Reviewer**');
    expect(await reviewer.mcp.ok('get_project_context', P)).toContain('Roles: `code_reviewer`, `qa_engineer`');
  });
});
