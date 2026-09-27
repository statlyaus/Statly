import { randomBytes } from 'node:crypto';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Pool } from 'pg';

import { executeAflTradeOutcomesHarnessCommand } from './afl-trade-outcomes-command-executor';
import { withDisposableAflTradeOutcomesPostgres } from '../../src/server/aflTradeIntelligence/development/disposablePostgresHarness';
import {
  composeLocalAflTradePrivateValuationConstruction,
  inspectLocalAflTradePrivateValuationConstruction,
} from '../../src/server/aflTradeIntelligence/development/localPrivateValuationConstruction';
import {
  assertLocalAflTradeOutcomesRuntimeIdentity,
  installLocalAflTradeOutcomesRuntimeIdentity,
  requireLocalAflTradeOutcomesRuntimeNonce,
} from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { createLocalAflTradePrivateValuationRuntime } from '../../src/server/aflTradeIntelligence/development/localPrivateValuationRuntime';

const root = resolve(import.meta.dirname, '../..');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const SUPPORTED_SCOPES = ['afl-men:2025-trades', 'afl-men:2026-trades'] as const;
/** 2 means inspected and blocked by named authority; 1 means the acceptance run itself failed. */
const BLOCKED_EXIT_CODE = 2;

const controller = new AbortController();
let requestedExitCode: number | undefined;
const handleSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
  requestedExitCode = signal === 'SIGINT' ? 130 : 143;
  process.exitCode = requestedExitCode;
  controller.abort(new Error(`Provisioned private valuation acceptance cancelled by ${signal}.`));
};
const handleSigint = (): void => handleSignal('SIGINT');
const handleSigterm = (): void => handleSignal('SIGTERM');
process.once('SIGINT', handleSigint);
process.once('SIGTERM', handleSigterm);

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown acceptance failure.';
  return message.replace(/postgres(?:ql)?:\/\/\S+/giu, '[redacted-database-url]');
}

function parseScope(argv: readonly string[]): (typeof SUPPORTED_SCOPES)[number] {
  const index = argv.indexOf('--scope');
  const value = index === -1 ? 'afl-men:2025-trades' : (argv[index + 1] ?? '');
  if (!(SUPPORTED_SCOPES as readonly string[]).includes(value)) {
    throw new TypeError(`The acceptance command does not support the scope ${value}.`);
  }
  return value as (typeof SUPPORTED_SCOPES)[number];
}

/** Refuse anything that is not the disposable loopback outcomes database, with no URL options. */
function requireDisposableLoopbackOutcomesUrl(databaseUrl: string): string {
  let database: URL;
  try {
    database = new URL(databaseUrl);
  } catch {
    throw new Error('Acceptance requires disposable loopback PostgreSQL without URL options.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !LOOPBACK_HOSTS.has(database.hostname) ||
    database.pathname !== '/statly_outcomes_test' ||
    database.search !== '' ||
    database.hash !== ''
  ) {
    throw new Error('Acceptance requires disposable loopback PostgreSQL without URL options.');
  }
  return databaseUrl;
}

async function runAgainst(input: {
  readonly databaseUrl: string;
  readonly runtimeNonce: string;
  readonly artifactRoot: string;
  readonly scopeKey: (typeof SUPPORTED_SCOPES)[number];
  readonly databaseOrigin: 'new_disposable_database' | 'existing_admitted_local_database';
}): Promise<void> {
  const pool = new Pool({
    connectionString: input.databaseUrl,
    application_name: 'statly-local-private-valuation-provision-and-dispatch',
    connectionTimeoutMillis: 5_000,
    max: 4,
  });
  try {
    await assertLocalAflTradeOutcomesRuntimeIdentity(pool, input.runtimeNonce);
    const report = await inspectLocalAflTradePrivateValuationConstruction({
      pool,
      artifactRoot: input.artifactRoot,
      scopeKey: input.scopeKey,
    });
    write(
      JSON.stringify(
        {
          purpose: 'genuine_composition_acceptance',
          databaseOrigin: input.databaseOrigin,
          scopeKey: input.scopeKey,
          constructionState: report.state,
          qualificationGranted: false,
          blockerCodes: report.blockerCodes,
          blockers: report.blockers,
        },
        null,
        2
      )
    );
    if (report.state === 'blocked') {
      // A blocked verdict is the honest result: name every missing authority and stop.
      process.exitCode = BLOCKED_EXIT_CODE;
      return;
    }
    const composition = await composeLocalAflTradePrivateValuationConstruction({
      pool,
      artifactRoot: input.artifactRoot,
      scopeKey: input.scopeKey,
    });
    if (composition.state !== 'composable') {
      process.exitCode = BLOCKED_EXIT_CODE;
      return;
    }
    const runtime = createLocalAflTradePrivateValuationRuntime({
      pool,
      artifactRoot: input.artifactRoot,
      workerId: 'system:provision-and-dispatch-acceptance',
      construction: composition.construction,
    });
    const requestId = await runtime.enqueueAdHoc({
      scopeKey: input.scopeKey,
      operationKey: 'genuine-composition-acceptance',
    });
    let dispatched: Awaited<ReturnType<typeof runtime.dispatchRequest>>;
    for (;;) {
      dispatched = await runtime.dispatchRequest(requestId);
      if (dispatched.state === 'completed') break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    write(JSON.stringify({ requestId, result: dispatched.result }, null, 2));
    process.exitCode = 0;
  } finally {
    await pool.end();
  }
}

async function deployMigrations(runtime: {
  readonly environment: NodeJS.ProcessEnv;
  readonly safeWorkingDirectory: string;
  readonly schemaPath: string;
}): Promise<void> {
  await executeAflTradeOutcomesHarnessCommand({
    command: process.execPath,
    args: [
      resolve(root, 'node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      runtime.schemaPath,
    ],
    environment: runtime.environment,
    // Piped so stdout carries only the acceptance receipt; a failure still surfaces through the error.
    output: 'pipe',
    signal: controller.signal,
    workingDirectory: runtime.safeWorkingDirectory,
  });
}

async function runAcceptance(): Promise<void> {
  const scopeKey = parseScope(process.argv.slice(2));
  const artifactRoot = resolve(
    process.env.AFL_TRADE_LOCAL_ARTIFACT_ROOT?.trim() ?? '.statly-local/afl-trade-artifacts'
  );
  const requested = process.env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (requested !== undefined && requested.length > 0) {
    // Caller-owned admitted database: require its exact runtime nonce before reading anything.
    await runAgainst({
      databaseUrl: requireDisposableLoopbackOutcomesUrl(requested),
      runtimeNonce: requireLocalAflTradeOutcomesRuntimeNonce(
        process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE?.trim() ?? ''
      ),
      artifactRoot,
      scopeKey,
      databaseOrigin: 'existing_admitted_local_database',
    });
    return;
  }
  const safeWorkingDirectory = await mkdtemp(
    join(tmpdir(), 'statly-afl-private-valuation-acceptance-')
  );
  let failure: unknown;
  try {
    await withDisposableAflTradeOutcomesPostgres(
      {
        execute: executeAflTradeOutcomesHarnessCommand,
        environment: process.env,
        safeWorkingDirectory,
        signal: controller.signal,
        workspaceRoot: root,
      },
      async (runtime) => {
        await deployMigrations(runtime);
        // This run owns the disposable database, so it installs its own identity and never prints it.
        const runtimeNonce = randomBytes(32).toString('hex');
        const identity = new Pool({ connectionString: runtime.databaseUrl, max: 1 });
        try {
          await installLocalAflTradeOutcomesRuntimeIdentity(identity, runtimeNonce, process.pid);
        } finally {
          await identity.end();
        }
        await runAgainst({
          databaseUrl: requireDisposableLoopbackOutcomesUrl(runtime.databaseUrl),
          runtimeNonce,
          artifactRoot,
          scopeKey,
          databaseOrigin: 'new_disposable_database',
        });
      }
    );
  } catch (error) {
    failure = error;
  }
  let cleanupFailure: unknown;
  try {
    await rmdir(safeWorkingDirectory);
  } catch (error) {
    cleanupFailure = error;
  }
  if (failure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError([failure, cleanupFailure], 'Acceptance and cleanup both failed.');
  }
  if (cleanupFailure !== undefined) throw cleanupFailure;
  if (failure !== undefined) throw failure;
}

try {
  await runAcceptance();
} catch (error) {
  process.stderr.write(`Provisioned private valuation acceptance failed: ${safeMessage(error)}\n`);
  process.exitCode = requestedExitCode ?? 1;
} finally {
  process.removeListener('SIGINT', handleSigint);
  process.removeListener('SIGTERM', handleSigterm);
}
