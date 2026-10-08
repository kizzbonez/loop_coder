#!/usr/bin/env node
// Bump the version of every package in the monorepo, roll the CHANGELOG, and sync the
// Docker image tag default.
//   node scripts/release.mjs patch|minor|major|<x.y.z>
// Afterwards: review the diff, commit, `git tag v<x.y.z>`, and rebuild with `npm run up`.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFESTS = ['package.json', 'packages/shared/package.json', 'apps/api/package.json', 'apps/web/package.json', 'apps/egress/package.json', 'e2e/package.json'];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function nextVersion(current, bump) {
  if (SEMVER.test(bump)) return bump;
  const [, ma, mi, pa] = SEMVER.exec(current).map(Number);
  if (bump === 'major') return `${ma + 1}.0.0`;
  if (bump === 'minor') return `${ma}.${mi + 1}.0`;
  if (bump === 'patch') return `${ma}.${mi}.${pa + 1}`;
  throw new Error(`Unknown bump "${bump}". Use patch, minor, major or an explicit x.y.z`);
}

const bump = process.argv[2];
if (!bump) {
  console.error('Usage: node scripts/release.mjs patch|minor|major|<x.y.z>');
  process.exit(1);
}

const rootPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const from = rootPkg.version;
const to = nextVersion(from, bump);
if (to === from) {
  console.error(`Already at ${to}`);
  process.exit(1);
}

for (const file of MANIFESTS) {
  const path = resolve(root, file);
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  pkg.version = to;
  // Workspace packages depend on each other with a caret range; on 0.x a minor bump falls
  // outside it (^0.1.0 excludes 0.2.0), so move those ranges along with the version.
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const name of Object.keys(pkg[field] ?? {})) if (name.startsWith('@loop/')) pkg[field][name] = `^${to}`;
  }
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

// Default image tag in docker-compose.yml.
const composePath = resolve(root, 'docker-compose.yml');
writeFileSync(composePath, readFileSync(composePath, 'utf8').replaceAll(`APP_VERSION:-${from}`, `APP_VERSION:-${to}`));
const envExample = resolve(root, '.env.example');
writeFileSync(envExample, readFileSync(envExample, 'utf8').replace(/^APP_VERSION=.*$/m, `APP_VERSION=${to}`));

// CHANGELOG: turn "Unreleased" into the new version and open a fresh Unreleased section.
const changelogPath = resolve(root, 'CHANGELOG.md');
const today = new Date().toISOString().slice(0, 10);
const changelog = readFileSync(changelogPath, 'utf8');
if (!changelog.includes('## [Unreleased]')) {
  console.warn('CHANGELOG.md has no "## [Unreleased]" section; skipping changelog update');
} else {
  writeFileSync(changelogPath, changelog.replace('## [Unreleased]', `## [Unreleased]\n\n## [${to}] - ${today}`));
}

// Keep package-lock.json in sync with the new workspace versions.
execSync('npm install --package-lock-only --ignore-scripts --no-audit --no-fund', { cwd: root, stdio: 'inherit' });

console.log(`\nReleased ${from} → ${to}\nNext steps:\n  git commit -am "chore(release): v${to}"\n  git tag v${to}\n  npm run up`);
