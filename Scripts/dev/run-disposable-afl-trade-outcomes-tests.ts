import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runDisposableAflTradeOutcomesTests } from '../../src/server/aflTradeIntelligence/development/disposablePostgresHarness';
import { executeAflTradeOutcomesHarnessCommand } from './afl-trade-outcomes-command-executor';

const root = resolve(import.meta.dirname, '../..');

const controller = new AbortController();
let requestedExitCode: number | undefined;
const handleSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
  requestedExitCode = signal === 'SIGINT' ? 130 : 143;
  process.exitCode = requestedExitCode;
  controller.abort(new Error(`Disposable PostgreSQL test run cancelled by ${signal}.`));
};
const handleSigint = (): void => handleSignal('SIGINT');
const handleSigterm = (): void => handleSignal('SIGTERM');
process.once('SIGINT', handleSigint);
process.once('SIGTERM', handleSigterm);

async function runHarness(): Promise<void> {
  const safeWorkingDirectory = await mkdtemp(join(tmpdir(), 'statly-afl-outcomes-tests-'));
  let failure: unknown;
  try {
    await runDisposableAflTradeOutcomesTests({
      execute: executeAflTradeOutcomesHarnessCommand,
      environment: process.env,
      safeWorkingDirectory,
      signal: controller.signal,
      workspaceRoot: root,
    });
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
    throw new AggregateError(
      [failure, cleanupFailure],
      'The harness and temporary-directory cleanup both failed.'
    );
  }
  if (cleanupFailure !== undefined) throw cleanupFailure;
  if (failure !== undefined) throw failure;
}

function errorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    const details = error.errors.map((entry) => errorMessage(entry)).join('; ');
    return `${error.message} ${details}`;
  }
  return error instanceof Error ? error.message : 'Unknown disposable PostgreSQL failure.';
}

try {
  await runHarness();
} catch (error) {
  const message = errorMessage(error);
  process.stderr.write(`AFL outcomes PostgreSQL integration harness failed: ${message}\n`);
  process.exitCode = requestedExitCode ?? 1;
} finally {
  process.removeListener('SIGINT', handleSigint);
  process.removeListener('SIGTERM', handleSigterm);
}
