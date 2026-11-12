#!/usr/bin/env node

// Decides which CI suites a pull request's changed files can affect. The workflow's `changes` job
// pipes `git diff --name-only -z` into this script and each heavy job runs only when its suite is
// on. tests/unit/ciChangedSuites.test.ts checks these lists against the import graph and the paths
// tests read, so a new import cannot silently drop a suite. See docs/development/testing.md,
// "Path-filtered jobs".

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SUITES = ['root', 'fantasy_app', 'outcomes', 'etl', 'functions'];

// CI itself and this classifier: run everything so a change to the rules is tested by the rules' old
// and new consumers alike.
const EVERYTHING = [/^\.github\/workflows\/ci\.yml$/, /^Scripts\/ci\/changed-suites\.mjs$/];

// Markdown that unit tests read or copy, so a change to it is not documentation-only.
const DOCS_READ_BY_UNIT_TESTS = [
  /^\.agents\//,
  /^AGENTS\.md$/,
  /^README\.md$/,
  /^etl\/README\.md$/,
  /^docs\/agents\//,
  /^docs\/development\/(delivery|dependency-overrides|setup)\.md$/,
  /^docs\/domain\/draft-and-waivers\.md$/,
];

// The AFL Draft and Trade Outcomes boundary. No fantasy page, route, server, worker, integration
// test or browser test imports these, so they never need the fantasy suites.
const OUTCOMES_BOUNDARY = [
  /^src\/server\/aflTradeIntelligence\//,
  /^src\/types\/aflTradeIntelligence(\/|\.ts$)/,
  /^src\/types\/aflDraftTradeOutcomes\.ts$/,
  /^src\/lib\/draftTrades\//,
  /^src\/app\/\(public\)\/draft\//,
  /^src\/app\/api\/draft-trades\//,
  /^src\/app\/(api\/)?dev\/afl-trade-/,
  /^src\/components\/aflTradeStory\//,
  /^src\/components\/draft\/(Afl|Development|DraftClub|DraftHub|DraftTrade|draftHub)/,
  /^prisma\/afl-trade-outcomes\//,
  /^tests\/(outcomes-integration|workbook-integration|testUtils|fixtures|helpers)\//,
  /^vitest\.config\.outcomes-[\w-]+\.ts$/,
  /^Scripts\//,
];

// Files outside the boundary that the outcomes tests import or read, and the root install and
// compiler configuration.
const OUTCOMES_INPUTS = [
  /^package(-lock)?\.json$/,
  /^\.nvmrc$/,
  /^tsconfig[\w.-]*\.json$/,
  /^src\/lib\/(apiResponse|logger|teamLogos|utils)\.ts$/,
  /^src\/components\/ui\/controlStyles\.ts$/,
  /^etl\/afl-trade-intelligence\//,
];

// Run only in the unit suite.
const UNIT_ONLY = [
  /^tests\/unit\//,
  /^tests\/setup\/unit\./,
  /^vitest\.config\.unit\.ts$/,
  /^src\/.*(\/__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$)/,
];

const matches = (patterns, file) => patterns.some((pattern) => pattern.test(file));
const isDocumentation = (file) => file.startsWith('docs/') || file.endsWith('.md');

/** The suites one changed path can affect. `root` is lint, typecheck, unit tests and build. */
export function suitesForFile(file) {
  if (matches(EVERYTHING, file)) return [...SUITES];
  if (matches(DOCS_READ_BY_UNIT_TESTS, file)) return ['root'];
  if (isDocumentation(file)) return [];

  // Root unit tests import ETL modules and read both nested manifests, so nested packages also run
  // the root suite.
  const suites = ['root'];
  if (file.startsWith('functions/')) return [...suites, 'functions'];
  if (file.startsWith('etl/')) suites.push('etl');
  if (matches(OUTCOMES_BOUNDARY, file) || matches(OUTCOMES_INPUTS, file)) suites.push('outcomes');
  if (!file.startsWith('etl/') && !matches(OUTCOMES_BOUNDARY, file) && !matches(UNIT_ONLY, file)) {
    suites.push('fantasy_app');
  }
  return suites;
}

/** Workflow outputs for a pull request's changed paths. */
export function classifyChangedFiles(files) {
  const on = new Set(files.flatMap(suitesForFile));
  return {
    docs_only: files.every((file) => suitesForFile(file).length === 0),
    ...Object.fromEntries(SUITES.map((suite) => [suite, on.has(suite)])),
  };
}

export function everySuite() {
  return { docs_only: false, ...Object.fromEntries(SUITES.map((suite) => [suite, true])) };
}

// Usage: `node Scripts/ci/changed-suites.mjs --all`, or NUL-separated paths on stdin. Writes
// `key=value` lines for $GITHUB_OUTPUT to stdout and the per-file decision to stderr for the log.
function main() {
  if (process.argv.includes('--all')) {
    printOutputs(everySuite());
    return;
  }
  const files = readFileSync(0, 'utf8').split('\0').filter(Boolean);
  for (const file of files) {
    console.error(`${file}: ${suitesForFile(file).join(', ') || 'documentation only'}`);
  }
  printOutputs(classifyChangedFiles(files));
}

function printOutputs(outputs) {
  for (const [key, value] of Object.entries(outputs)) console.log(`${key}=${value}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
