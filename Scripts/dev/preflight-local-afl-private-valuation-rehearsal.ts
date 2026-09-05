import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Pool } from 'pg';

import { executeAflTradeOutcomesHarnessCommand } from './afl-trade-outcomes-command-executor';
import { inspectExactCleanAflTradeCheckout } from '../../src/server/aflTradeIntelligence/development/localAdmittedPlayerRunAttestation';
import { withDisposableAflTradeOutcomesPostgres } from '../../src/server/aflTradeIntelligence/development/disposablePostgresHarness';
import { inspectExact2025AflPrivateValuationRehearsalPreflight } from '../../src/server/aflTradeIntelligence/development/localPrivateValuationRehearsalPreflight';

const root = resolve(import.meta.dirname, '../..');
const controller = new AbortController();
let requestedExitCode: number | undefined;

function handleSignal(signal: 'SIGINT' | 'SIGTERM'): void {
  requestedExitCode = signal === 'SIGINT' ? 130 : 143;
  process.exitCode = requestedExitCode;
  controller.abort(new Error(`Private valuation rehearsal preflight cancelled by ${signal}.`));
}

const handleSigint = (): void => handleSignal('SIGINT');
const handleSigterm = (): void => handleSignal('SIGTERM');
process.once('SIGINT', handleSigint);
process.once('SIGTERM', handleSigterm);

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown preflight failure.';
  return message.replace(/postgres(?:ql)?:\/\/\S+/giu, '[redacted-database-url]');
}

async function runPreflight(): Promise<void> {
  const checkout = await inspectExactCleanAflTradeCheckout(root);
  const safeWorkingDirectory = await mkdtemp(
    join(tmpdir(), 'statly-afl-private-valuation-preflight-')
  );
  let failure: unknown;
  try {
    const report = await withDisposableAflTradeOutcomesPostgres(
      {
        execute: executeAflTradeOutcomesHarnessCommand,
        environment: process.env,
        safeWorkingDirectory,
        signal: controller.signal,
        workspaceRoot: root,
      },
      async (runtime) => {
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
          output: 'inherit',
          signal: controller.signal,
          workingDirectory: runtime.safeWorkingDirectory,
        });
        const pool = new Pool({
          connectionString: runtime.databaseUrl,
          max: 1,
          options: '-c default_transaction_read_only=on',
        });
        try {
          return await inspectExact2025AflPrivateValuationRehearsalPreflight(pool);
        } finally {
          await pool.end();
        }
      }
    );
    const reauthenticated = await inspectExactCleanAflTradeCheckout(root);
    if (
      reauthenticated.canonicalRoot !== checkout.canonicalRoot ||
      reauthenticated.codeCommitSha !== checkout.codeCommitSha
    ) {
      throw new TypeError('The clean rehearsal checkout changed during preflight.');
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          purpose: 'empty_database_bootstrap_smoke',
          databaseOrigin: 'new_disposable_database',
          codeCommitSha: checkout.codeCommitSha,
          bootstrapState: 'passed',
          rehearsalExecuted: false,
          inventory: report,
        },
        null,
        2
      )}\n`
    );
    process.exitCode = 2;
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
    throw new AggregateError([failure, cleanupFailure], 'Preflight and cleanup both failed.');
  }
  if (cleanupFailure !== undefined) throw cleanupFailure;
  if (failure !== undefined) throw failure;
}

try {
  await runPreflight();
} catch (error) {
  process.stderr.write(
    `Private valuation rehearsal preflight failed: ${safeErrorMessage(error)}\n`
  );
  process.exitCode = requestedExitCode ?? 1;
} finally {
  process.removeListener('SIGINT', handleSigint);
  process.removeListener('SIGTERM', handleSigterm);
}
