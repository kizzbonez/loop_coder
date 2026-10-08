#!/usr/bin/env node
// Adds the secrets Loop Coder needs to .env (creating the file if needed), without printing them:
//   LOOP_SECRETS_KEY    encrypts AI provider API keys (and API agents' tokens) at rest;
//   LOOP_RUNNER_SECRET  lets the runner of API agents talk to the API.
// Keep .env private and back it up apart from the database: without LOOP_SECRETS_KEY the saved
// API keys cannot be read. Values already set are never replaced.
//   npm run secrets-key
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, '.env');
let text = existsSync(path) ? readFileSync(path, 'utf8') : '';

const SECRETS = [
  { name: 'LOOP_SECRETS_KEY', comment: 'Encrypts AI provider API keys at rest. Keep it secret; back it up apart from the database.', keep: '(Replacing it would make the saved API keys unreadable.)' },
  { name: 'LOOP_RUNNER_SECRET', comment: 'Shared by the API and the runner of API agents.', keep: '' },
];

const added = [];
for (const { name, comment, keep } of SECRETS) {
  if (new RegExp(`^${name}=\\S+`, 'm').test(text)) {
    console.log(`${name} is already set in .env: unchanged. ${keep}`.trim());
    continue;
  }
  const line = `${name}=${randomBytes(32).toString('base64url')}`;
  const empty = new RegExp(`^${name}=[ \\t]*$`, 'm');
  text = empty.test(text) ? text.replace(empty, line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}\n# ${comment}\n${line}\n`;
  added.push(name);
}
if (added.length) {
  writeFileSync(path, text, { mode: 0o600 });
  console.log(`Added ${added.join(' and ')} to .env (not shown). Apply with \`npm run up\`, and back up .env apart from the database.`);
}
