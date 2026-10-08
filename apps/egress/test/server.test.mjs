import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

const port = 30000 + Math.floor(Math.random() * 20000);
const dir = mkdtempSync(join(tmpdir(), 'egress-server-'));
const allowlist = join(dir, 'allowlist.json');
let child;

/** Send a CONNECT through the gateway and return the status it answers with. */
const connect = (target) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: target });
    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on('response', (res) => resolve(res.statusCode));
    req.on('error', reject);
    req.end();
  });
const get = (path) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path }, (res) => { let body = ''; res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode, body })); }).on('error', reject));

before(async () => {
  writeFileSync(allowlist, JSON.stringify({ hosts: ['api.anthropic.com'] }));
  child = spawn(process.execPath, ['src/server.mjs'], { env: { ...process.env, PORT: String(port), EGRESS_ALLOWLIST_PATH: allowlist }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => child.stdout.once('data', resolve));
});
after(() => child.kill());

describe('egress gateway', () => {
  it('reports health and how many hosts are allowed', async () => {
    const res = await get('/healthz');
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).hosts, 1);
  });

  it('never forwards plain HTTP', async () => {
    assert.equal((await get('http://example.com/')).status, 405);
  });

  it('refuses hosts that are not allowed, other ports and addresses', async () => {
    assert.equal(await connect('example.com:443'), 403);
    assert.equal(await connect('api.anthropic.com:80'), 403);
    assert.equal(await connect('169.254.169.254:443'), 403);
    assert.equal(await connect('10.0.0.1:443'), 403);
  });

  it('picks up a changed allow list without a restart', async () => {
    writeFileSync(allowlist, JSON.stringify({ hosts: [] }));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(JSON.parse((await get('/healthz')).body).hosts, 0);
    assert.equal(await connect('api.anthropic.com:443'), 403);
  });
});
