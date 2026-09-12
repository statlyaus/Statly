import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeAflTradeOutcomesHarnessCommand } from '../../Scripts/dev/afl-trade-outcomes-command-executor';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'statly-command-executor-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe('AFL trade outcomes command executor', () => {
  it('waits for an aborted child to close before rejecting', async () => {
    const directory = await createTemporaryDirectory();
    const pidPath = join(directory, 'pid');
    const controller = new AbortController();
    const execution = executeAflTradeOutcomesHarnessCommand({
      command: process.execPath,
      args: [
        '-e',
        [
          "const fs = require('node:fs');",
          `fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
          "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 250));",
          'setInterval(() => {}, 1_000);',
        ].join(''),
      ],
      workingDirectory: directory,
      environment: process.env,
      signal: controller.signal,
      output: 'pipe',
    });
    const rejection = expect(execution).rejects.toMatchObject({ name: 'AbortError' });

    await waitForFile(pidPath);
    const pid = Number.parseInt(await readFile(pidPath, 'utf8'), 10);
    const abortedAt = Date.now();
    controller.abort();

    await rejection;
    expect(Date.now() - abortedAt).toBeGreaterThanOrEqual(200);
    expect(processExists(pid)).toBe(false);
  });

  it('waits for an output-overflow child to close before rejecting', async () => {
    const directory = await createTemporaryDirectory();
    const pidPath = join(directory, 'pid');
    const execution = executeAflTradeOutcomesHarnessCommand({
      command: process.execPath,
      args: [
        '-e',
        [
          "const fs = require('node:fs');",
          `fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
          "process.stdout.write(Buffer.alloc(1024 * 1024 + 1, 'x'));",
          'setInterval(() => {}, 1_000);',
        ].join(''),
      ],
      workingDirectory: directory,
      environment: process.env,
      output: 'pipe',
    });
    const rejection = expect(execution).rejects.toThrow('exceeded its output limit');

    await waitForFile(pidPath);
    const pid = Number.parseInt(await readFile(pidPath, 'utf8'), 10);

    await rejection;
    expect(processExists(pid)).toBe(false);
  });
});
