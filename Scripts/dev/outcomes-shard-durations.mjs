#!/usr/bin/env node

// Rewrites tests/testUtils/outcomesFileDurations.json from a CI run's log, so the outcomes shard
// split follows the latest measured file durations. Usage:
//   gh run view <run-id> --repo statlyaus/Statly --log | node Scripts/dev/outcomes-shard-durations.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const OUTPUT = 'tests/testUtils/outcomesFileDurations.json';
// The default reporter's per-file line, for example
//   ✓  outcomes-postgres-integration  tests/outcomes-integration/x.test.ts (8 tests) 3859ms
// A file whose tests were all skipped has no duration and costs nothing in CI.
const FILE_LINE =
  /[✓✗×↓]\s+outcomes-postgres-integration\s+(\S+\.test\.ts)\s+\([^)]*\)(?:\s+(\d+(?:\.\d+)?)(ms|s)\b)?/;

const log = readFileSync(0, 'utf8').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
const seconds = {};
for (const line of log.split('\n')) {
  const match = FILE_LINE.exec(line);
  if (!match) continue;
  const [, file, value, unit] = match;
  seconds[file] = value ? Math.round(Number(value) / (unit === 'ms' ? 1000 : 1)) : 0;
}

const files = Object.keys(seconds).sort();
if (files.length === 0) {
  console.error('No outcomes integration file durations found in the log.');
  process.exit(1);
}
const sorted = Object.fromEntries(files.map((file) => [file, seconds[file]]));
writeFileSync(OUTPUT, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`Wrote ${files.length} file durations to ${OUTPUT}.`);
