import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createProject, createToken, freshApp, mcpClient, setupAdmin, type Agent } from '../helpers';

let app: Express;
let human: Agent;
let projectId: string;

beforeEach(async () => {
  app = freshApp();
  const admin = await setupAdmin(app);
  human = admin.agent;
  projectId = (await createProject(human, admin.workspaceId)).id;
});

const P = { project: 'SHOP' };

describe('client-neutral agent naming', () => {
  it('labels activity, remarks, claims and presence with the connected client (Cursor)', async () => {
    const cursor = mcpClient(app, await createToken(human));
    await cursor.initialize('cursor-vscode');
    await cursor.ok('get_next_work', P); // kickoff as Project Manager
    await cursor.ok('create_work_items', { ...P, items: [{ title: 'Search' }] });
    await cursor.ok('complete_kickoff', { ...P, summary: 'ok' });
    await cursor.ok('get_next_work', P); // claims SHOP-1 for refinement
    await cursor.ok('add_remark', { item: 'SHOP-1', body: 'Thinking about search', kind: 'design' });

    const project = (await human.get(`/api/projects/${projectId}`).expect(200)).body;
    expect(project.agent).toMatchObject({ agentName: 'Cursor', clientName: 'cursor-vscode 2.1.0' });

    const tasks = (await human.get(`/api/projects/${projectId}/tasks`).expect(200)).body.items;
    expect(tasks[0].claim).toMatchObject({ agentName: 'Cursor', roleKey: 'project_manager' });

    const detail = (await human.get(`/api/tasks/${tasks[0].id}`).expect(200)).body;
    expect(detail.remarks.at(-1)).toMatchObject({ authorType: 'agent', authorName: 'Cursor' });

    const activity = (await human.get(`/api/projects/${projectId}/activity`).expect(200)).body.items as Array<{
      actorType: string;
      actorName: string;
      message: string;
    }>;
    const agentEntries = activity.filter((a) => a.actorType === 'agent');
    expect(agentEntries.length).toBeGreaterThan(0);
    expect(agentEntries.every((a) => a.actorName === 'Cursor')).toBe(true);
    expect(activity.some((a) => a.message.startsWith('Cursor (Project Manager) started working on SHOP-1'))).toBe(true);
    expect(JSON.stringify(activity)).not.toContain('Claude');
  });

  it('keeps each agent\'s own name when several clients share a project', async () => {
    const claude = mcpClient(app, await createToken(human));
    const vscode = mcpClient(app, await createToken(human));
    await claude.initialize('claude-code');
    await vscode.initialize('Visual Studio Code');
    await claude.ok('get_next_work', P);
    await claude.ok('create_work_items', { ...P, items: [{ title: 'A' }, { title: 'B' }] });
    await claude.ok('complete_kickoff', { ...P, summary: 'ok' });
    await claude.ok('get_next_work', P); // SHOP-1
    await vscode.ok('get_next_work', P); // SHOP-2
    const tasks = (await human.get(`/api/projects/${projectId}/tasks`).expect(200)).body.items as Array<{ key: string; claim: { agentName: string } | null }>;
    expect(tasks.find((t) => t.key === 'SHOP-1')!.claim!.agentName).toBe('Claude Code');
    expect(tasks.find((t) => t.key === 'SHOP-2')!.claim!.agentName).toBe('VS Code');
    // Two agents on one project count as two online agents.
    expect((await human.get('/api/admin/stats').expect(200)).body.onlineAgents).toBe(2);
  });

  it('falls back to "Agent" for clients that never sent their name', async () => {
    const anonymous = mcpClient(app, await createToken(human));
    expect(await anonymous.ok('get_next_work', P)).toContain('Project kickoff');
    const project = (await human.get(`/api/projects/${projectId}`).expect(200)).body;
    expect(project.agent.agentName).toBe('Agent');
  });

  it('shows the agent name in remark threads returned to the agent', async () => {
    const cursor = mcpClient(app, await createToken(human));
    await cursor.initialize('cursor-vscode');
    await cursor.ok('get_next_work', P);
    await cursor.ok('create_work_items', { ...P, items: [{ title: 'Search' }] });
    await cursor.ok('add_remark', { item: 'SHOP-1', body: 'Note', kind: 'work_log' });
    expect(await cursor.ok('get_work_item', { item: 'SHOP-1' })).toMatch(/#### Cursor/);
  });

  it('clears the claiming agent once the item moves on', async () => {
    const cursor = mcpClient(app, await createToken(human));
    await cursor.initialize('cursor-vscode');
    await cursor.ok('get_next_work', P);
    await cursor.ok('create_work_items', { ...P, items: [{ title: 'Search' }] });
    await cursor.ok('complete_kickoff', { ...P, summary: 'ok' });
    await cursor.ok('get_next_work', P);
    await cursor.ok('request_human_input', { item: 'SHOP-1', question: '?' });
    const tasks = (await human.get(`/api/projects/${projectId}/tasks`).expect(200)).body.items;
    expect(tasks[0].claim).toBeNull();
  });
});
