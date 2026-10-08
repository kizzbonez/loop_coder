import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isHostName, isPublicAddress, parseAllowlist, parseTarget, readAllowlist } from '../src/policy.mjs';

describe('egress policy', () => {
  it('accepts only host names on port 443', () => {
    assert.deepEqual(parseTarget('api.anthropic.com:443'), { host: 'api.anthropic.com', port: 443 });
    assert.deepEqual(parseTarget('API.OpenAI.com.:443'), { host: 'api.openai.com', port: 443 });
    for (const bad of ['api.anthropic.com:80', 'api.anthropic.com:22', '10.0.0.5:443', '[::1]:443', '169.254.169.254:443', 'localhost:443', 'evil.com:443:443', 'a b.com:443', '', null, 'api.anthropic.com']) {
      assert.equal(parseTarget(bad), null, String(bad));
    }
    assert.equal(isHostName('dashscope-intl.aliyuncs.com'), true);
    assert.equal(isHostName('-bad.com'), false);
  });

  it('treats only internet addresses as public', () => {
    for (const ip of ['8.8.8.8', '104.18.0.1', '2606:4700::1111', '::ffff:1.1.1.1']) assert.equal(isPublicAddress(ip), true, ip);
    for (const ip of ['10.1.2.3', '172.20.0.5', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '2001:db8::1', 'not-an-ip']) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
  });

  it('reads the allow list written by the API, and allows nothing when it is missing or broken', () => {
    assert.deepEqual([...parseAllowlist('{"hosts":["api.anthropic.com","API.OPENAI.COM","10.0.0.1","bad host"]}')], ['api.anthropic.com', 'api.openai.com']);
    assert.equal(parseAllowlist('not json').size, 0);
    assert.equal(parseAllowlist('{"hosts":"api.anthropic.com"}').size, 0);
    const dir = mkdtempSync(join(tmpdir(), 'egress-'));
    writeFileSync(join(dir, 'allowlist.json'), '{"hosts":["generativelanguage.googleapis.com"]}');
    assert.deepEqual([...readAllowlist(join(dir, 'allowlist.json'))], ['generativelanguage.googleapis.com']);
    assert.equal(readAllowlist(join(dir, 'missing.json')).size, 0);
  });
});
