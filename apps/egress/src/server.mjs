// Loop Coder egress gateway: the only way out of the internal network. The API reaches AI
// providers through it (HTTPS_PROXY); it tunnels HTTPS to the hosts the administrator has
// configured and refuses everything else. It never sees request contents (TLS is end to end).
import { lookup } from 'node:dns/promises';
import { statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { isPublicAddress, parseTarget, readAllowlist } from './policy.mjs';

const PORT = Number(process.env.PORT ?? 3128);
const ALLOWLIST_PATH = process.env.EGRESS_ALLOWLIST_PATH ?? '/egress/allowlist.json';
const MAX_TUNNELS = Number(process.env.EGRESS_MAX_TUNNELS ?? 64);
const CONNECT_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 5 * 60_000;

let cached = { mtimeMs: -1, hosts: new Set() };
/** The allow list, re-read whenever the API rewrites the file. */
function allowlist() {
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(ALLOWLIST_PATH).mtimeMs;
  } catch {
    return new Set();
  }
  if (mtimeMs !== cached.mtimeMs) cached = { mtimeMs, hosts: readAllowlist(ALLOWLIST_PATH) };
  return cached.hosts;
}

const log = (entry) => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
let open = 0;

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', hosts: allowlist().size }));
    return;
  }
  // Plain HTTP is never forwarded: providers are reached over HTTPS only.
  res.writeHead(405, { 'content-type': 'text/plain' }).end('Only HTTPS through CONNECT is allowed\n');
});

server.on('connect', async (req, client, head) => {
  const deny = (reason, status = '403 Forbidden') => {
    log({ event: 'denied', target: String(req.url).slice(0, 300), reason });
    client.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${reason}\n`);
  };
  client.on('error', () => client.destroy());
  const target = parseTarget(req.url);
  if (!target) return deny('only host names on port 443');
  if (!allowlist().has(target.host)) return deny('host not allowed');
  if (open >= MAX_TUNNELS) return deny('too many connections', '503 Service Unavailable');

  let addresses;
  try {
    addresses = await lookup(target.host, { all: true, verbatim: true });
  } catch {
    return deny('host not found', '502 Bad Gateway');
  }
  // Every address must be public, and we connect to the one we checked (no second lookup).
  if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) return deny('host resolves to a private address');

  open++;
  const upstream = net.connect({ host: addresses[0].address, port: target.port, timeout: CONNECT_TIMEOUT_MS });
  const close = () => {
    upstream.destroy();
    client.destroy();
  };
  upstream.once('timeout', () => (upstream.connecting ? deny('upstream timeout', '504 Gateway Timeout') : close()));
  upstream.once('error', () => (upstream.connecting ? deny('upstream unreachable', '502 Bad Gateway') : close()));
  upstream.once('close', () => {
    open--;
    client.destroy();
  });
  upstream.once('connect', () => {
    upstream.setTimeout(IDLE_TIMEOUT_MS);
    client.setTimeout(IDLE_TIMEOUT_MS, close);
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
    log({ event: 'tunnel', host: target.host });
  });
});

server.listen(PORT, '0.0.0.0', () => log({ event: 'listening', port: PORT, allowlist: ALLOWLIST_PATH }));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
