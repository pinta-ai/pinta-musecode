#!/usr/bin/env node
// Single source of truth for bumping every embedded version in this package.
//
//   npm run bump <version>      e.g. npm run bump 1.2.3
//
// Updates, in lock-step, every place this package hard-codes its own version:
//   - package.json + package-lock.json   (via `npm version`)
//   - src/core/version.ts ADAPTER_VERSION (the one version literal in src/)
//
// Fails loudly if a target is missing so a drifting file can't slip a release.
// `tests/core/version.test.ts` pins the two together, so a release that
// bypasses this script fails the build.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`usage: npm run bump <version>   (got: ${version ?? '<none>'})`);
  process.exit(1);
}

// Check the source target before touching package.json, so a failure leaves nothing half-bumped.
const file = 'src/core/version.ts';
const re = /(export const ADAPTER_VERSION = ")[^"]+(")/;
const src = readFileSync(file, 'utf8');
if (!re.test(src)) {
  console.error(`bump: no version match in ${file} (pattern ${re}) — aborting before a partial bump`);
  process.exit(1);
}

// package.json + package-lock.json — let npm keep the two in sync.
execSync(`npm version ${version} --no-git-tag-version --allow-same-version`, { stdio: 'inherit' });

writeFileSync(file, src.replace(re, `$1${version}$2`));
console.log(`  bumped ${file}`);

console.log(`\nAll version locations set to ${version}.`);
