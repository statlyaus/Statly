import { realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import {
  createLocalDraftguruTradeCaptureTargets,
  runLocalDraftguruTradeCapture,
  type LocalDraftguruTradeCaptureOptions,
  type LocalDraftguruTradeCaptureResult,
  type LocalDraftguruTradeCaptureTarget,
} from '../src/server/aflTradeIntelligence/development/localDraftguruTradeCaptureRunner';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';

/**
 * Captures Draftguru trade pages on the owner's machine under the recorded issue-579 narrow Gate 0A
 * decisions, with local raw custody and local provider pacing. See the operations runbook section
 * "Capturing Draftguru trade pages locally".
 *
 * Usage:
 *   npm run outcomes:sources:capture-local-draftguru-trades -- \
 *     --artifact-root <durable-absolute-dir> --capability draftguru-trade-detail \
 *     --url https://www.draftguru.com.au/trades/2020-jeremy-cameron [--url ...]
 *   npm run outcomes:sources:capture-local-draftguru-trades -- \
 *     --artifact-root <durable-absolute-dir> --capability draftguru-trade-index \
 *     --season 2020 [--from-season 2011]
 */

export interface LocalDraftguruTradeCaptureArguments {
  databaseUrl: string;
  userAgent: string;
  artifactRootDirectory: string;
  targets: LocalDraftguruTradeCaptureTarget[];
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function usage(message: string): never {
  throw new TypeError(`${message} See the runbook for the local Draftguru capture command.`);
}

function season(value: string | undefined, name: string): number {
  if (value === undefined || !/^\d{4}$/.test(value)) usage(`${name} must be a four-digit season.`);
  return Number(value);
}

/** Rejects temporary locations: retained custody must outlive the process and the machine's cleanup. */
export function requireDurableArtifactRoot(
  path: string,
  temporaryDirectories: readonly string[] = [tmpdir(), '/tmp', '/var/tmp', '/var/folders']
): string {
  if (!isAbsolute(path)) usage('--artifact-root must be an absolute path.');
  let canonical: string;
  try {
    canonical = realpathSync(resolve(path));
  } catch {
    usage('--artifact-root must be an existing directory.');
  }
  if (!statSync(canonical).isDirectory()) usage('--artifact-root must be a directory.');
  for (const temporary of temporaryDirectories) {
    let canonicalTemporary: string;
    try {
      canonicalTemporary = realpathSync(temporary);
    } catch {
      continue;
    }
    const inside = relative(canonicalTemporary, canonical);
    if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
      usage('--artifact-root must be durable; temporary directories are refused.');
    }
  }
  return canonical;
}

export function parseLocalDraftguruTradeCaptureArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  temporaryDirectories?: readonly string[]
): LocalDraftguruTradeCaptureArguments {
  const values = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !['--artifact-root', '--capability', '--season', '--from-season', '--url'].includes(
        name ?? ''
      ) ||
      value === undefined ||
      value.startsWith('--')
    ) {
      usage(`Unexpected argument ${name ?? ''}.`);
    }
    values.set(name!, [...(values.get(name!) ?? []), value]);
  }
  const single = (name: string) => {
    const entries = values.get(name) ?? [];
    if (entries.length > 1) usage(`${name} may be given once.`);
    return entries[0];
  };
  const databaseUrl = env.AFL_OUTCOMES_DATABASE_URL?.trim() ?? '';
  let host = '';
  try {
    const parsed = new URL(databaseUrl);
    host =
      parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:' ? parsed.hostname : '';
  } catch {
    host = '';
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    usage('AFL_OUTCOMES_DATABASE_URL must name a loopback PostgreSQL outcomes database.');
  }
  const userAgent = env.AFL_TRADE_EXTERNAL_USER_AGENT?.trim() ?? '';
  if (userAgent.length < 20 || !/contact\s*:/i.test(userAgent)) {
    usage('AFL_TRADE_EXTERNAL_USER_AGENT must identify Statly and include "contact:".');
  }
  const root = single('--artifact-root');
  if (root === undefined) usage('--artifact-root is required.');
  const artifactRootDirectory = requireDurableArtifactRoot(root, temporaryDirectories);
  const capability = single('--capability');
  let targets: LocalDraftguruTradeCaptureTarget[];
  if (capability === 'draftguru-trade-index') {
    if (values.has('--url')) usage('The trade index takes --season, not --url.');
    const through = season(single('--season'), '--season');
    const fromValue = single('--from-season');
    targets = createLocalDraftguruTradeCaptureTargets({
      capabilityId: capability,
      season: through,
      ...(fromValue === undefined ? {} : { fromSeason: season(fromValue, '--from-season') }),
    });
  } else if (capability === 'draftguru-trade-detail') {
    if (values.has('--season') || values.has('--from-season')) {
      usage('Trade-detail seasons come from each --url.');
    }
    targets = createLocalDraftguruTradeCaptureTargets({
      capabilityId: capability,
      urls: values.get('--url') ?? [],
    });
  } else {
    usage('--capability must be draftguru-trade-index or draftguru-trade-detail.');
  }
  return { databaseUrl, userAgent, artifactRootDirectory, targets };
}

function summary(result: LocalDraftguruTradeCaptureResult) {
  return result.status === 'not_modified'
    ? { sourceUrl: result.sourceUrl, status: result.status, attemptId: result.attemptId }
    : {
        sourceUrl: result.sourceUrl,
        status: result.status,
        captureId: result.captureId,
        artifactId: result.artifactId,
        batchId: result.batchId,
        evidenceCount: result.evidenceCount,
        issueCount: result.issueCount,
        idempotentReplay: result.idempotentReplay,
      };
}

export async function runLocalDraftguruTradeCaptureCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
  fetchImpl?: LocalDraftguruTradeCaptureOptions['fetchImpl'];
}) {
  const parsed = parseLocalDraftguruTradeCaptureArguments(input.argv, input.env);
  const write = input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    return await runLocalDraftguruTradeCapture(
      {
        sql: createPgAflOutcomeSqlClient(pool),
        artifactRootDirectory: parsed.artifactRootDirectory,
        userAgent: parsed.userAgent,
        ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
      },
      parsed.targets,
      (result) => write(JSON.stringify(summary(result)))
    );
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runLocalDraftguruTradeCaptureCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(
        `Local Draftguru trade capture stopped; later targets were not attempted. ${message}\n`
      );
      process.exitCode = 1;
    }
  );
}
