import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createProject, createToken, createUser, freshApp, mcpClient, setupAdmin, type Agent } from '../helpers';

let app: Express;
let admin: Agent;
let wsId: string;
let project: Awaited<ReturnType<typeof createProject>>;

beforeEach(async () => {
  app = freshApp();
  ({ agent: admin, workspaceId: wsId } = await setupAdmin(app));
  project = await createProject(admin, wsId);
});

describe('MCP transport and authentication', () => {
  it('rejects requests without a token with 401 and a Bearer challenge', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
    expect(res.body.error.code).toBe(-32001);
  });

  it('rejects unknown, malformed and session-cookie credentials', async () => {
    for (const auth of ['Bearer lc_pat_unknown', 'Bearer ', 'Basic abc', 'lc_pat_x']) {
      await request(app).post('/mcp').set('Authorization', auth).send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).expect(401);
    }
  });

  it('rejects revoked tokens', async () => {
    const token = await createToken(admin);
    await mcpClient(app, token).initialize().then((r) => expect(r.status).toBe(200));
    const tokens = (await admin.get('/api/account/tokens').expect(200)).body.items;
    await admin.delete(`/api/account/tokens/${tokens[0].id}`).expect(204);
    expect((await mcpClient(app, token).initialize()).status).toBe(401);
  });

  it('rejects tokens of disabled users', async () => {
    const { agent, userId } = await createUser(app, admin, 'bot@example.com');
    const token = await createToken(agent);
    await admin.patch(`/api/admin/users/${userId}`).send({ status: 'disabled' }).expect(200);
    expect((await mcpClient(app, token).initialize()).status).toBe(401);
  });

  it('only accepts POST (stateless server)', async () => {
    await request(app).get('/mcp').expect(405);
    await request(app).delete('/mcp').expect(405);
  });

  it('blocks browser cross-origin requests (DNS rebinding protection)', async () => {
    const token = await createToken(admin);
    await request(app)
      .post('/mcp')
      .set('Origin', 'https://evil.example')
      .set('Authorization', `Bearer ${token}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(403);
  });

  it('initialises and reports server info, then records the client name', async () => {
    const token = await createToken(admin);
    const res = await mcpClient(app, token).initialize('claude-code');
    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo).toMatchObject({ name: 'loopcoder', title: 'Loop Coder' });
    expect(res.body.result.capabilities).toHaveProperty('tools');
    expect(res.body.result.capabilities).toHaveProperty('prompts');
    expect(res.body.result.instructions).toMatch(/get_next_work/);
  });

  it('lists every tool with an input schema', async () => {
    const token = await createToken(admin);
    const res = await mcpClient(app, token).rpc('tools/list').expect(200);
    const names = res.body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(
      [
        'add_remark',
        'complete_kickoff',
        'complete_sprint',
        'create_work_items',
        'get_next_work',
        'get_project_context',
        'get_work_item',
        'list_projects',
        'list_work_items',
        'log_progress',
        'mark_refined',
        'move_work_item',
        'release_work_item',
        'request_human_input',
        'start_sprint',
        'update_project_notes',
        'update_work_item',
        'wait_for_work',
      ].sort(),
    );
    for (const tool of res.body.result.tools) expect(tool.inputSchema.type).toBe('object');
  });

  it('serves the "work" prompt for Claude Code slash commands', async () => {
    const token = await createToken(admin);
    const mcp = mcpClient(app, token);
    const list = await mcp.rpc('prompts/list').expect(200);
    expect(list.body.result.prompts.map((p: { name: string }) => p.name)).toContain('work');
    const prompt = await mcp.rpc('prompts/get', { name: 'work', arguments: { project: 'shop' } }).expect(200);
    const text = prompt.body.result.messages[0].content.text as string;
    expect(text).toContain('SHOP');
    expect(text).toContain('acme/shop');
    expect(text).toContain('get_next_work');
    // Paused or waiting agents stay connected; only a stop ends the session.
    expect(text).toContain('wait_for_work');
    expect(text).toMatch(/End your session[^.]*only when it reports \*\*STOPPED\*\*/);
  });

  it('returns tool errors as isError results instead of crashing', async () => {
    const token = await createToken(admin);
    const mcp = mcpClient(app, token);
    const missing = await mcp.call('get_next_work', {});
    expect(missing).toMatchObject({ isError: true });
    expect(missing.text).toMatch(/project/);
    const unknown = await mcp.call('get_work_item', { item: 'SHOP-999' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/not found/);
    const invalid = await mcp.rpc('tools/call', { name: 'move_work_item', arguments: { item: 'SHOP-1' } }).expect(200);
    expect(invalid.body.result?.isError ?? Boolean(invalid.body.error)).toBe(true);
  });
});

describe('MCP authorisation scopes', () => {
  it('a user only sees projects of their workspaces', async () => {
    const { agent: bob } = await createUser(app, admin, 'bob@example.com');
    const bobWs = (await bob.post('/api/workspaces').send({ name: 'Bob' }).expect(201)).body.id;
    await createProject(bob, bobWs, 'BOB');
    const mcp = mcpClient(app, await createToken(bob));
    const list = await mcp.ok('list_projects');
    expect(list).toContain('BOB');
    expect(list).not.toContain('SHOP');
    const denied = await mcp.call('get_project_context', { project: 'SHOP' });
    expect(denied.isError).toBe(true);
  });

  it('viewers cannot pull work', async () => {
    const { agent: viewer } = await createUser(app, admin, 'viewer@example.com');
    await admin.post(`/api/workspaces/${wsId}/members`).send({ email: 'viewer@example.com', role: 'viewer' }).expect(201);
    const mcp = mcpClient(app, await createToken(viewer));
    expect((await mcp.call('get_project_context', { project: 'SHOP' })).isError).toBe(false);
    const res = await mcp.call('get_next_work', { project: 'SHOP' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/read-only/);
  });

  it('a project-scoped token is confined to its project and needs no project argument', async () => {
    await createProject(admin, wsId, 'OTHER');
    const mcp = mcpClient(app, await createToken(admin, { projectId: project.id }));
    expect(await mcp.ok('get_project_context')).toContain('SHOP');
    expect((await mcp.call('get_project_context', { project: 'OTHER' })).isError).toBe(true);
    expect(await mcp.ok('list_projects')).not.toContain('OTHER');
  });

  it('a workspace-scoped token is confined to its workspace', async () => {
    const otherWs = (await admin.post('/api/workspaces').send({ name: 'Elsewhere' }).expect(201)).body.id;
    await createProject(admin, otherWs, 'ELSE');
    const mcp = mcpClient(app, await createToken(admin, { workspaceId: wsId }));
    expect((await mcp.call('get_project_context', { project: 'SHOP' })).isError).toBe(false);
    expect((await mcp.call('get_project_context', { project: 'ELSE' })).isError).toBe(true);
  });
});
