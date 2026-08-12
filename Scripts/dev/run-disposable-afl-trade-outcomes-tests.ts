import { spawn } from 'node:child_process';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  runDisposableAflTradeOutcomesTests,
  type AflTradeOutcomesHarnessCommand,
  type AflTradeOutcomesHarnessCommandResult,
} from '../../src/server/aflTradeIntelligence/development/disposablePostgresHarness';

const root = resolve(import.meta.dirname, '../..');
const maximumCapturedBytes = 1024 * 1024;

function executeCommand(
  command: AflTradeOutcomesHarnessCommand
): Promise<AflTradeOutcomesHarnessCommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const inheritOutput = command.output === 'inherit';
    const child = spawn(command.command, command.args, {
      cwd: command.workingDirectory ?? root,
      env: command.environment,
      signal: command.signal,
      stdio: inheritOutput ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let settled = false;
    let timedOut = false;
    const resolveOnce = (result: AflTradeOutcomesHarnessCommandResult): void => {
      if (settled) return;
      settled = true;
      resolveCommand(result);
    };
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      rejectCommand(error);
    };
    const timeout =
      command.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, command.timeoutMs);
    timeout?.unref();

    const capture = (target: Buffer[], chunk: Buffer): void => {
      capturedBytes += chunk.byteLength;
      if (capturedBytes > maximumCapturedBytes) {
        child.kill('SIGKILL');
        rejectOnce(new Error(`Command ${command.command} exceeded its output limit.`));
        return;
      }
      target.push(chunk);
    };

    if (!inheritOutput) {
      child.stdout?.on('data', (chunk: Buffer) => capture(stdoutChunks, chunk));
      child.stderr?.on('data', (chunk: Buffer) => capture(stderrChunks, chunk));
    }
    child.once('error', (error) => rejectOnce(error));
    child.once('close', (code, signal) => {
      if (timeout !== undefined) clearTimeout(timeout);
      if (timedOut) {
        rejectOnce(
          new Error(`Command ${command.command} exceeded its ${command.timeoutMs}ms timeout.`)
        );
        return;
      }
      if (code === 0) {
        resolveOnce({ stdout: Buffer.concat(stdoutChunks).toString('utf8') });
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      const outcome = signal === null ? `exit code ${code ?? 'unknown'}` : `signal ${signal}`;
      rejectOnce(
        new Error(
          `${command.command} ${command.args[0] ?? ''} failed with ${outcome}${stderr === '' ? '' : `: ${stderr}`}`
        )
      );
    });
  });
}

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
      execute: executeCommand,
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
