import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

// The workspaces root must be configured before the app modules load.
const root = mkdtempSync(join(tmpdir(), 'lc-ws-'));
process.env.WORKSPACES_DIR = root;
const { createProject, createUser, freshApp, setupAdmin } = await import('../helpers');

type Agent = Awaited<ReturnType<typeof setupAdmin>>['agent'];
let owner: Agent;
let stranger: Agent;
let projectId: string;

beforeEach(async () => {
  const app = freshApp();
  const admin = await setupAdmin(app);
  owner = admin.agent;
  ({ agent: stranger } = await createUser(app, owner, 'stranger@example.com'));
  projectId = (await createProject(owner, admin.workspaceId)).id;
  const dir = join(root, 'acme', 'shop');
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# Shop');
  writeFileSync(join(dir, 'src', 'app.ts'), 'console.log(1)');
  writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
  writeFileSync(join(dir, 'big.txt'), 'x'.repeat(600 * 1024));
});

describe('project file browser', () => {
  it('lists the project folder (directories first, .git hidden)', async () => {
    const items = (await owner.get(`/api/projects/${projectId}/files`).expect(200)).body.items;
    expect(items.map((i: { name: string }) => i.name)).toEqual(['src', 'big.txt', 'logo.png', 'README.md']);
    const src = (await owner.get(`/api/projects/${projectId}/files?path=src`).expect(200)).body.items;
    expect(src).toEqual([{ name: 'app.ts', type: 'file', size: 14 }]);
  });

  it('reads text files and flags binary and oversized files', async () => {
    const text = (await owner.get(`/api/projects/${projectId}/files/content?path=README.md`).expect(200)).body;
    expect(text).toMatchObject({ path: 'README.md', content: '# Shop', binary: false, truncated: false });
    const bin = (await owner.get(`/api/projects/${projectId}/files/content?path=logo.png`).expect(200)).body;
    expect(bin).toMatchObject({ binary: true, content: null });
    const big = (await owner.get(`/api/projects/${projectId}/files/content?path=big.txt`).expect(200)).body;
    expect(big.truncated).toBe(true);
    expect(big.content.length).toBe(512 * 1024);
  });

  it('blocks path traversal', async () => {
    for (const p of ['../', '../../etc/passwd', 'src/../../..', '%2e%2e/']) {
      const res = await owner.get(`/api/projects/${projectId}/files/content`).query({ path: p });
      expect([400, 404]).toContain(res.status);
    }
  });

  it('is limited to project members', async () => {
    await stranger.get(`/api/projects/${projectId}/files`).expect(404);
    await stranger.get(`/api/projects/${projectId}/files/content?path=README.md`).expect(404);
  });

  it('returns an empty list when the folder does not exist yet', async () => {
    const other = await createProject(owner, (await owner.get('/api/workspaces').expect(200)).body.items[0].id, 'NEW');
    expect((await owner.get(`/api/projects/${other.id}/files`).expect(200)).body.items).toEqual([]);
  });
});
