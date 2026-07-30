#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_TRACE_PATH = '.next/dev/trace';

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return 0;
  const index = Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1);
  return sortedValues[index];
}

export function summarizeCompileDurations(durationsMicroseconds) {
  const sorted = [...durationsMicroseconds].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 && sorted.length > 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : (sorted[middle] ?? 0);

  return {
    count: sorted.length,
    medianMs: median / 1_000,
    p95Ms: percentile(sorted, 0.95) / 1_000,
    maxMs: (sorted.at(-1) ?? 0) / 1_000,
  };
}

export function collectCompilePaths(traceText, { includeInternal = false } = {}) {
  const durationsByTrigger = new Map();

  for (const line of traceText.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const spans = JSON.parse(trimmed);
    if (!Array.isArray(spans)) continue;

    for (const span of spans) {
      if (span?.name !== 'compile-path' || typeof span.duration !== 'number') continue;
      const trigger = span.tags?.trigger;
      if (typeof trigger !== 'string') continue;
      if (!includeInternal && !trigger.startsWith('/')) continue;

      const durations = durationsByTrigger.get(trigger) ?? [];
      durations.push(span.duration);
      durationsByTrigger.set(trigger, durations);
    }
  }

  return durationsByTrigger;
}

function parseArguments(argumentsList) {
  const tracePaths = [];
  let includeInternal = false;
  let outputJson = false;

  for (const argument of argumentsList) {
    if (argument === '--all') {
      includeInternal = true;
    } else if (argument === '--json') {
      outputJson = true;
    } else if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      tracePaths.push(argument);
    }
  }

  return {
    includeInternal,
    outputJson,
    tracePaths: tracePaths.length > 0 ? tracePaths : [DEFAULT_TRACE_PATH],
  };
}

function formatMilliseconds(value) {
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)}s` : `${value.toFixed(1)}ms`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const combined = new Map();

  for (const tracePath of options.tracePaths) {
    const absolutePath = resolve(tracePath);
    const traceText = await readFile(absolutePath, 'utf8');
    const compilePaths = collectCompilePaths(traceText, options);

    for (const [trigger, durations] of compilePaths) {
      combined.set(trigger, [...(combined.get(trigger) ?? []), ...durations]);
    }
  }

  const report = [...combined.entries()]
    .map(([trigger, durations]) => ({ trigger, ...summarizeCompileDurations(durations) }))
    .sort((left, right) => right.medianMs - left.medianMs || left.trigger.localeCompare(right.trigger));

  if (options.outputJson) {
    process.stdout.write(`${JSON.stringify({ tracePaths: options.tracePaths, routes: report }, null, 2)}\n`);
    return;
  }

  if (report.length === 0) {
    process.stdout.write('No route compile-path spans found. Use --all to include internal triggers.\n');
    return;
  }

  process.stdout.write('Route compilation report (Turbopack compile-path spans)\n');
  process.stdout.write(`Traces: ${options.tracePaths.join(', ')}\n\n`);
  process.stdout.write('median     p95        max        runs  trigger\n');

  for (const row of report) {
    process.stdout.write(
      `${formatMilliseconds(row.medianMs).padEnd(11)}${formatMilliseconds(row.p95Ms).padEnd(11)}` +
        `${formatMilliseconds(row.maxMs).padEnd(11)}${String(row.count).padEnd(6)}${row.trigger}\n`
    );
  }
}

const isMainModule = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
