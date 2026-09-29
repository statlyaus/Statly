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

const OPTION_NAMES = ['--artifact-root', '--capability', '--season', '--from-season', '--url'];

type OptionValues = ReadonlyMap<string, readonly string[]>;

function readOptions(argv: readonly string[]): OptionValues {
  const values = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index] ?? '';
    const value = argv[index + 1];
    if (!OPTION_NAMES.includes(name) || value === undefined || value.startsWith('--')) {
      usage(`Unexpected argument ${name}.`);
    }
    values.set(name, [...(values.get(name) ?? []), value]);
  }
  return values;
}

function single(values: OptionValues, name: string): string | undefined {
  const entries = values.get(name) ?? [];
  if (entries.length > 1) usage(`${name} may be given once.`);
  return entries[0];
}

function requireLoopbackDatabaseUrl(value: string | undefined): string {
  const databaseUrl = value?.trim() ?? '';
  let host = '';
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:')
      host = parsed.hostname;
  } catch {
    host = '';
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    usage('AFL_OUTCOMES_DATABASE_URL must name a loopback PostgreSQL outcomes database.');
  }
  return databaseUrl;
}

function requireIdentifyingUserAgent(value: string | undefined): string {
  const userAgent = value?.trim() ?? '';
  if (userAgent.length < 20 || !/contact\s*:/i.test(userAgent)) {
    usage('AFL_TRADE_EXTERNAL_USER_AGENT must identify Statly and include "contact:".');
  }
  return userAgent;
}

function indexTargets(values: OptionValues): LocalDraftguruTradeCaptureTarget[] {
  if (values.has('--url')) usage('The trade index takes --season, not --url.');
  const fromValue = single(values, '--from-season');
  return createLocalDraftguruTradeCaptureTargets({
    capabilityId: 'draftguru-trade-index',
    season: season(single(values, '--season'), '--season'),
    ...(fromValue === undefined ? {} : { fromSeason: season(fromValue, '--from-season') }),
  });
}

function detailTargets(values: OptionValues): LocalDraftguruTradeCaptureTarget[] {
  if (values.has('--season') || values.has('--from-season')) {
    usage('Trade-detail seasons come from each --url.');
  }
  return createLocalDraftguruTradeCaptureTargets({
    capabilityId: 'draftguru-trade-detail',
    urls: values.get('--url') ?? [],
  });
}

export function parseLocalDraftguruTradeCaptureArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  temporaryDirectories?: readonly string[]
): LocalDraftguruTradeCaptureArguments {
  const values = readOptions(argv);
  const databaseUrl = requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL);
  const userAgent = requireIdentifyingUserAgent(env.AFL_TRADE_EXTERNAL_USER_AGENT);
  const root = single(values, '--artifact-root');
  if (root === undefined) usage('--artifact-root is required.');
  const artifactRootDirectory = requireDurableArtifactRoot(root, temporaryDirectories);
  const capability = single(values, '--capability');
  if (capability !== 'draftguru-trade-index' && capability !== 'draftguru-trade-detail') {
    usage('--capability must be draftguru-trade-index or draftguru-trade-detail.');
  }
  const targets =
    capability === 'draftguru-trade-index' ? indexTargets(values) : detailTargets(values);
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
