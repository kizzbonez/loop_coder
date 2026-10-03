import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createProject, createToken, createUser, CSRF, freshApp, mcpClient, PASSWORD, setupAdmin, type Agent } from '../helpers';

let app: Express;
let server: Server;
let base: string;
let owner: Agent;
let project: Awaited<ReturnType<typeof createProject>>;
const controllers: AbortController[] = [];

beforeEach(async () => {
  app = freshApp();
  const admin = await setupAdmin(app);
  owner = admin.agent;
  project = await createProject(owner, admin.workspaceId);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  for (const c of controllers.splice(0)) c.abort();
  server.closeAllConnections();
  server.close();
});

async function sessionCookie(email = 'admin@example.com'): Promise<string> {
  const res = await request(app).post('/api/auth/login').set(CSRF).send({ email, password: PASSWORD }).expect(200);
  return res.headers['set-cookie']![0]!.split(';')[0]!;
}

async function openStream(cookie: string, projectId = project.id) {
  const controller = new AbortController();
  controllers.push(controller);
  const res = await fetch(`${base}/api/projects/${projectId}/events`, { headers: { cookie }, signal: controller.signal });
  let buffer = '';
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  return {
    res,
    async waitFor(predicate: (text: string) => boolean, timeoutMs = 4000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(buffer)) {
        if (Date.now() > deadline) throw new Error(`timed out; received:\n${buffer}`);
        const chunk = await Promise.race([
          reader!.read(),
          new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), 250)),
        ]);
        if (chunk.value) buffer += decoder.decode(chunk.value, { stream: true });
      }
      return buffer;
    },
  };
}

describe('live board updates (Server-Sent Events)', () => {
  it('streams with the right headers and a hello event carrying the server version', async () => {
    const stream = await openStream(await sessionCookie());
    expect(stream.res.status).toBe(200);
    expect(stream.res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(stream.res.headers.get('x-accel-buffering')).toBe('no');
    const text = await stream.waitFor((t) => t.includes('event: hello'));
    expect(text).toMatch(/"version":"\d+\.\d+\.\d+/);
  });

  it('pushes work item changes made by humans', async () => {
    const stream = await openStream(await sessionCookie());
    await stream.waitFor((t) => t.includes('hello'));
    await owner.post(`/api/projects/${project.id}/tasks`).send({ title: 'Realtime!' }).expect(201);
    const text = await stream.waitFor((t) => t.includes('task.upserted') && t.includes('activity.created'));
    expect(text).toContain('Realtime!');
  });

  it('pushes changes made by the agent through MCP, including presence', async () => {
    const stream = await openStream(await sessionCookie());
    await stream.waitFor((t) => t.includes('hello'));
    const mcp = mcpClient(app, await createToken(owner));
    await mcp.ok('get_next_work', { project: 'SHOP' });
    await mcp.ok('create_work_items', { project: 'SHOP', items: [{ title: 'From Claude' }] });
    const text = await stream.waitFor((t) => t.includes('agent.presence') && t.includes('From Claude'));
    expect(text).toContain('"createdByAgent":true');
  });

  it('does not leak events of other projects', async () => {
    const otherWs = (await owner.post('/api/workspaces').send({ name: 'Other' }).expect(201)).body.id;
    const other = await createProject(owner, otherWs, 'OTH');
    const stream = await openStream(await sessionCookie());
    await stream.waitFor((t) => t.includes('hello'));
    await owner.post(`/api/projects/${other.id}/tasks`).send({ title: 'Elsewhere' }).expect(201);
    await owner.post(`/api/projects/${project.id}/tasks`).send({ title: 'Here' }).expect(201);
    const text = await stream.waitFor((t) => t.includes('Here'));
    expect(text).not.toContain('Elsewhere');
  });

  it('requires a session and project access', async () => {
    const anon = await fetch(`${base}/api/projects/${project.id}/events`);
    expect(anon.status).toBe(401);
    await createUser(app, owner, 'stranger@example.com');
    const stranger = await fetch(`${base}/api/projects/${project.id}/events`, {
      headers: { cookie: await sessionCookie('stranger@example.com') },
    });
    expect(stranger.status).toBe(404);
  });
});
