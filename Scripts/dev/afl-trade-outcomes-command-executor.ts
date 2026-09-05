import { spawn } from 'node:child_process';

import type {
  AflTradeOutcomesHarnessCommand,
  AflTradeOutcomesHarnessCommandResult,
} from '../../src/server/aflTradeIntelligence/development/disposablePostgresHarness';

const maximumCapturedBytes = 1024 * 1024;

export function executeAflTradeOutcomesHarnessCommand(
  command: AflTradeOutcomesHarnessCommand
): Promise<AflTradeOutcomesHarnessCommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const inheritOutput = command.output === 'inherit';
    const child = spawn(command.command, command.args, {
      cwd: command.workingDirectory,
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
