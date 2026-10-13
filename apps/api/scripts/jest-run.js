#!/usr/bin/env node
/**
 * Runs the Jest suite by handing it an explicit list of spec files.
 *
 * Why this exists: when the repository lives under a OneDrive folder, Jest's
 * file crawler reports "No tests found" even though the spec files are there.
 * OneDrive represents synced entries as reparse points, and the crawler skips
 * directory entries whose type is neither a plain file nor a directory, so it
 * walks away with only node_modules. The suite then "passes" because the npm
 * script used --passWithNoTests, which is how four spec files went unrun.
 *
 * Node's own readdir handles those entries fine, so we do the discovery here
 * and pass the result to `jest --runTestsByPath`, which skips the crawl.
 *
 * Exits non-zero when no spec file is found. A test suite that cannot find its
 * tests is a failure, not a pass.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const API_ROOT = path.resolve(__dirname, '..');
const SEARCH_ROOTS = ['test', 'src'];
const SPEC_PATTERN = /\.spec\.ts$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);

/** @returns {string[]} spec file paths relative to the api package root */
function findSpecs(dir) {
  const absolute = path.join(API_ROOT, dir);
  if (!fs.existsSync(absolute)) return [];

  const found = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...findSpecs(path.join(dir, entry.name)));
    } else if (SPEC_PATTERN.test(entry.name)) {
      found.push(path.join(dir, entry.name).split(path.sep).join('/'));
    }
  }
  return found;
}

const specs = SEARCH_ROOTS.flatMap(findSpecs).sort();

if (specs.length === 0) {
  console.error('No *.spec.ts files found under ' + SEARCH_ROOTS.join(', ') + '.');
  console.error('Refusing to report a passing run with zero tests.');
  process.exit(1);
}

console.log('Running ' + specs.length + ' spec file(s):');
for (const spec of specs) console.log('  ' + spec);

const jestBin = path.join(API_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'jest.cmd' : 'jest');
const args = ['--runTestsByPath', ...specs, ...process.argv.slice(2)];

const result = spawnSync(jestBin, args, { cwd: API_ROOT, stdio: 'inherit', shell: process.platform === 'win32' });

process.exit(result.status ?? 1);
