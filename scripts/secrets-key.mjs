#!/usr/bin/env node
// Adds a random LOOP_SECRETS_KEY to .env (creating the file if needed). The key encrypts AI
// provider API keys at rest. It is never printed: keep .env private and back it up separately
// from the database, because without it the saved API keys cannot be read.
//   npm run secrets-key
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, '.env');
const text = existsSync(path) ? readFileSync(path, 'utf8') : '';

if (/^LOOP_SECRETS_KEY=\S+/m.test(text)) {
  console.log('LOOP_SECRETS_KEY is already set in .env: nothing changed. (Replacing it would make the saved API keys unreadable.)');
  process.exit(0);
}

const line = `LOOP_SECRETS_KEY=${randomBytes(32).toString('base64url')}`;
const next = /^LOOP_SECRETS_KEY=[ \t]*$/m.test(text)
  ? text.replace(/^LOOP_SECRETS_KEY=[ \t]*$/m, line)
  : `${text}${text && !text.endsWith('\n') ? '\n' : ''}\n# Encrypts AI provider API keys at rest. Keep it secret; back it up apart from the database.\n${line}\n`;
writeFileSync(path, next, { mode: 0o600 });
console.log('Added LOOP_SECRETS_KEY to .env (not shown). Apply it with `npm run up`, and back up .env apart from the database.');
