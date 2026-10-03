#!/usr/bin/env node
// Wrapper around `docker compose` that stamps images with the release version, git commit
// and build time (shown in the UI footer, /api/version and Administration → System).
//   node scripts/compose.mjs up -d --build
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function gitSha() {
  try {
    const sha = execSync('git rev-parse --short=12 HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

const env = {
  ...process.env,
  APP_VERSION: process.env.APP_VERSION || version,
  GIT_SHA: process.env.GIT_SHA || gitSha(),
  BUILD_TIME: process.env.BUILD_TIME || new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
};

console.log(`Loop Coder v${env.APP_VERSION} (${env.GIT_SHA})`);
const result = spawnSync('docker', ['compose', ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' });
process.exit(result.status ?? 1);
