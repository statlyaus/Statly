#!/usr/bin/env node

// Flaky-test quarantine. tests/quarantine.json lists known flaky tests; each entry names an open
// issue. The blocking CI step runs everything except the listed tests, and a second step runs only
// the listed tests and reports their failure without failing the job. See "Flaky-test quarantine" in
// docs/development/testing.md.
//
//   node Scripts/ci/quarantine.mjs run <suite> blocking|quarantined [-- <runner args>]
//   node Scripts/ci/quarantine.mjs check [--issues]

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const quarantinePath = resolve(root, 'tests/quarantine.json');

// Each suite is the npm script CI already runs for it, so the quarantine step inherits its config.
export const SUITES = {
  unit: { script: 'test:unit', runner: 'vitest' },
  int: { script: 'test:int', runner: 'vitest' },
  'outcomes-int': { script: 'test:outcomes:int:provisioned', runner: 'vitest' },
  e2e: { script: 'test:e2e', runner: 'playwright' },
};

// A vitest or Playwright name is the describe chain plus the test title, space-joined.
export function fullName(entry) {
  return [entry.describe, entry.title].filter(Boolean).join(' ');
}

export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function readQuarantine(path = quarantinePath) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function validateEntries(
  entries,
  {
    fileExists = (file) => existsSync(resolve(root, file)),
    readText = (file) => readFileSync(resolve(root, file), 'utf8'),
  } = {}
) {
  if (!Array.isArray(entries)) return ['tests/quarantine.json must be an array of entries.'];
  const errors = [];
  const seen = new Set();
  entries.forEach((entry, index) => {
    const label = `entry ${index}${entry?.title ? ` (${entry.title})` : ''}`;
    for (const field of ['suite', 'file', 'title', 'added', 'reason']) {
      if (typeof entry?.[field] !== 'string' || entry[field].trim() === '') {
        errors.push(`${label}: "${field}" must be a non-empty string.`);
      }
    }
    if (!Number.isInteger(entry?.issue) || entry.issue <= 0) {
      errors.push(`${label}: "issue" must be the number of an open issue.`);
    }
    if (typeof entry?.added === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(entry.added)) {
      errors.push(`${label}: "added" must be a YYYY-MM-DD date.`);
    }
    if (typeof entry?.suite === 'string' && !SUITES[entry.suite]) {
      errors.push(
        `${label}: unknown suite "${entry.suite}" (known: ${Object.keys(SUITES).join(', ')}).`
      );
    }
    if (entry?.describe !== undefined && typeof entry.describe !== 'string') {
      errors.push(`${label}: "describe" must be a string when present.`);
    }
    const key = `${entry?.suite}\0${entry?.file}\0${entry?.describe}\0${entry?.title}`;
    if (seen.has(key)) errors.push(`${label}: listed twice.`);
    seen.add(key);
    if (typeof entry?.file === 'string' && typeof entry?.title === 'string') {
      if (!fileExists(entry.file)) {
        errors.push(`${label}: file ${entry.file} does not exist; remove the entry.`);
      } else {
        const text = readText(entry.file);
        for (const part of [entry.describe, entry.title].filter(Boolean)) {
          if (!text.includes(part)) {
            errors.push(
              `${label}: "${part}" not found in ${entry.file}; it was renamed or removed.`
            );
          }
        }
      }
    }
  });
  return errors;
}

// A stale name silently stops matching, which is why validateEntries checks that the names still
// exist in the file.
export function runnerArgs(suite, mode, entries) {
  const listed = entries.filter((entry) => entry.suite === suite);
  const names = listed.map((entry) => escapeRegExp(fullName(entry))).join('|');
  const files = [...new Set(listed.map((entry) => entry.file))];
  if (SUITES[suite].runner === 'vitest') {
    return mode === 'blocking'
      ? ['-t', `^(?!(?:${names})$)`]
      : [...files, '-t', `^(?:${names})$`, '--passWithNoTests'];
  }
  // test:e2e already passes --grep-invert @draft-worker and the last --grep-invert wins, so repeat it.
  return mode === 'blocking'
    ? ['--grep-invert', `@draft-worker|${names}`]
    : [...files, '--grep', names, '--pass-with-no-tests'];
}

function report(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
}

function run(suite, mode, extraArgs) {
  if (!SUITES[suite] || !['blocking', 'quarantined'].includes(mode)) {
    console.error('Usage: quarantine.mjs run <suite> blocking|quarantined [-- <runner args>]');
    return 2;
  }
  const entries = readQuarantine();
  const errors = validateEntries(entries);
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    return 1;
  }
  const listed = entries.filter((entry) => entry.suite === suite);
  const npmArgs = ['run', SUITES[suite].script, '--', ...extraArgs];
  if (listed.length === 0) {
    if (mode === 'quarantined') {
      console.log(`No quarantined ${suite} tests.`);
      return 0;
    }
    return spawnSync('npm', npmArgs, { stdio: 'inherit' }).status ?? 1;
  }
  const result = spawnSync('npm', [...npmArgs, ...runnerArgs(suite, mode, entries)], {
    stdio: 'inherit',
  });
  const status = result.status ?? 1;
  if (mode === 'blocking') return status;
  const names = listed.map((entry) => `${fullName(entry)} (#${entry.issue})`).join('; ');
  if (status === 0) {
    report(
      `Quarantined ${suite} tests passed: ${names}. If they keep passing, remove them from tests/quarantine.json.`
    );
  } else {
    console.log(
      `::warning title=Quarantined ${suite} tests failed::${names}. Not blocking; see the linked issue.`
    );
    report(`Quarantined ${suite} tests FAILED (not blocking): ${names}.`);
  }
  return 0;
}

function checkIssues(entries) {
  const errors = [];
  for (const issue of new Set(entries.map((entry) => entry.issue))) {
    const result = spawnSync(
      'gh',
      ['issue', 'view', String(issue), '--json', 'state', '--jq', '.state'],
      {
        encoding: 'utf8',
      }
    );
    const state = result.stdout?.trim();
    if (result.status !== 0)
      errors.push(`#${issue}: could not read the issue (${result.stderr?.trim()}).`);
    else if (state !== 'OPEN')
      errors.push(`#${issue} is ${state}: remove its entries from tests/quarantine.json.`);
  }
  return errors;
}

function check(withIssues) {
  const entries = readQuarantine();
  const errors = validateEntries(entries);
  if (errors.length === 0 && withIssues) errors.push(...checkIssues(entries));
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    return 1;
  }
  console.log(`tests/quarantine.json: ${entries.length} entries, all valid.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const separator = rest.indexOf('--');
  const head = separator === -1 ? rest : rest.slice(0, separator);
  const tail = separator === -1 ? [] : rest.slice(separator + 1);
  if (command === 'run') process.exit(run(head[0], head[1], tail));
  else if (command === 'check') process.exit(check(head.includes('--issues')));
  else {
    console.error('Usage: quarantine.mjs run <suite> blocking|quarantined | check [--issues]');
    process.exit(2);
  }
}
