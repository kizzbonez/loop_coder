// What the egress gateway lets through: HTTPS (CONNECT to port 443) to an exact list of host
// names, and only when every address the name resolves to is on the public internet.
import { readFileSync } from 'node:fs';
import net from 'node:net';

/** A DNS host name (no IP literals, no ports, lowercase). */
const HOST = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export const isHostName = (value) => typeof value === 'string' && HOST.test(value) && net.isIP(value) === 0;

/** "api.anthropic.com:443" → { host, port }, or null for anything that is not a host name on port 443. */
export function parseTarget(authority) {
  const match = /^([^:\s]+):(\d{1,5})$/.exec(String(authority ?? '').trim());
  if (!match) return null;
  const host = match[1].toLowerCase().replace(/\.$/, '');
  const port = Number(match[2]);
  if (port !== 443 || !isHostName(host)) return null;
  return { host, port };
}

const v4ToInt = (ip) => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
const inV4 = (ip, cidr) => {
  const [base, bits] = cidr.split('/');
  const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
};
/** Ranges that are never the internet: private, loopback, link-local (cloud metadata), CGNAT, multicast, reserved. */
const BLOCKED_V4 = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'];

export function isPublicAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return !BLOCKED_V4.some((cidr) => inV4(ip, cidr));
  if (family === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicAddress(mapped[1]);
    if (lower === '::' || lower === '::1') return false;
    const first = parseInt(lower.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
    if (lower.startsWith('2001:db8:') || lower.startsWith('64:ff9b:')) return false; // documentation, NAT64
    return true;
  }
  return false;
}

/** The allow list written by the API: {"hosts": ["api.anthropic.com", ...]}. Anything unreadable allows nothing. */
export function parseAllowlist(text) {
  try {
    const hosts = JSON.parse(text)?.hosts;
    return new Set(Array.isArray(hosts) ? hosts.map((h) => String(h).toLowerCase()).filter(isHostName) : []);
  } catch {
    return new Set();
  }
}

export function readAllowlist(path) {
  try {
    return parseAllowlist(readFileSync(path, 'utf8'));
  } catch {
    return new Set();
  }
}
