import { describe, expect, it, vi } from 'vitest';

import {
  runDisposableAflTradeOutcomesTests,
  type AflTradeOutcomesHarnessCommand,
} from '@/server/aflTradeIntelligence/development/disposablePostgresHarness';

const firstContainerId = 'a'.repeat(64);
const secondContainerId = 'b'.repeat(64);
const harnessPaths = {
  nodeExecutable: '/test/node',
  safeWorkingDirectory: '/tmp/statly-afl-outcomes-test',
  workspaceRoot: '/workspace',
};

describe('disposable AFL outcomes PostgreSQL harness', () => {
  it('runs the outcomes checks against a loopback-only temporary PostgreSQL container', async () => {
    const commands: AflTradeOutcomesHarnessCommand[] = [];
    const execute = vi.fn(async (command: AflTradeOutcomesHarnessCommand) => {
      commands.push(command);
      if (command.command === 'docker' && command.args[0] === 'run') {
        return { stdout: `${firstContainerId}\n` };
      }
      if (command.command === 'docker' && command.args[0] === 'port') {
        return { stdout: '127.0.0.1:49152\n' };
      }
      return { stdout: '' };
    });

    await runDisposableAflTradeOutcomesTests({
      ...harnessPaths,
      execute,
      environment: {
        PATH: '/test/bin',
        UNRELATED_RUNTIME_VALUE: ['not', 'forwarded'].join('-'),
        AFL_OUTCOMES_DATABASE_URL: 'postgresql://shared.example.test/outcomes',
        AFL_OUTCOMES_TEST_DATABASE_URL: 'postgresql://shared.example.test/outcomes_test',
      },
      processId: 4242,
      randomId: () => 'abcdef123456',
      sleep: async () => undefined,
    });

    expect(commands[0]).toEqual({
      command: 'docker',
      args: ['version', '--format', '{{.Server.Version}}'],
      output: 'pipe',
      timeoutMs: 15_000,
    });

    expect(commands[1]).toEqual({
      command: 'docker',
      args: [
        'run',
        '--detach',
        '--rm',
        '--label',
        'com.statly.afl-outcomes-harness=statly-afl-outcomes-test-4242-abcdef123456',
        '--name',
        'statly-afl-outcomes-test-4242-abcdef123456',
        '--publish',
        '127.0.0.1::5432',
        '--tmpfs',
        '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g',
        '--env',
        'POSTGRES_DB=statly_outcomes_test',
        '--env',
        'POSTGRES_USER=statly_test',
        '--env',
        'POSTGRES_PASSWORD=statly_test',
        'postgres:16-alpine',
        'postgres',
        '-c',
        'max_wal_size=128MB',
        '-c',
        'min_wal_size=32MB',
        '-c',
        'checkpoint_timeout=30s',
        '-c',
        'checkpoint_completion_target=0.9',
      ],
      output: 'pipe',
      timeoutMs: 60_000,
    });

    const childEnvironment = expect.objectContaining({
      PATH: '/test/bin',
      AFL_OUTCOMES_DATABASE_URL:
        'postgresql://statly_test:statly_test@127.0.0.1:49152/statly_outcomes_test',
      AFL_OUTCOMES_TEST_DATABASE_URL:
        'postgresql://statly_test:statly_test@127.0.0.1:49152/statly_outcomes_test',
      AFL_OUTCOMES_TEST_CONTAINER_ID: firstContainerId,
    });
    expect(commands.filter((command) => command.command === '/test/node')).toEqual([
      {
        command: '/test/node',
        args: [
          '/workspace/node_modules/prisma/build/index.js',
          'validate',
          '--schema',
          '/workspace/prisma/afl-trade-outcomes/schema.prisma',
        ],
        environment: childEnvironment,
        output: 'inherit',
        workingDirectory: '/tmp/statly-afl-outcomes-test',
      },
      {
        command: '/test/node',
        args: [
          '/workspace/node_modules/prisma/build/index.js',
          'generate',
          '--schema',
          '/workspace/prisma/afl-trade-outcomes/schema.prisma',
        ],
        environment: childEnvironment,
        output: 'inherit',
        workingDirectory: '/tmp/statly-afl-outcomes-test',
      },
      {
        command: '/test/node',
        args: [
          '/workspace/node_modules/vitest/vitest.mjs',
          'run',
          '--config',
          '/workspace/vitest.config.outcomes-int.ts',
        ],
        environment: childEnvironment,
        output: 'inherit',
        workingDirectory: '/workspace',
      },
    ]);
    expect(
      commands.filter((command) => command.command === '/test/node')[0]?.environment
    ).not.toHaveProperty('UNRELATED_RUNTIME_VALUE');
    expect(commands.find((command) => command.args[0] === 'port')).toEqual({
      command: 'docker',
      args: ['port', firstContainerId, '5432/tcp'],
      output: 'pipe',
      timeoutMs: 15_000,
    });
    expect(commands.find((command) => command.args.includes('pg_isready'))).toEqual({
      command: 'docker',
      args: [
        'exec',
        firstContainerId,
        'pg_isready',
        '--username',
        'statly_test',
        '--dbname',
        'statly_outcomes_test',
      ],
      output: 'pipe',
      timeoutMs: 5_000,
    });
    expect(commands.at(-1)).toEqual({
      command: 'docker',
      args: ['rm', '--force', firstContainerId],
      output: 'pipe',
      timeoutMs: 15_000,
    });
  });

  it('removes only its generated container when a child check fails', async () => {
    const commands: AflTradeOutcomesHarnessCommand[] = [];
    const execute = vi.fn(async (command: AflTradeOutcomesHarnessCommand) => {
      commands.push(command);
      if (command.command === 'docker' && command.args[0] === 'run') {
        return { stdout: `${secondContainerId}\n` };
      }
      if (command.command === 'docker' && command.args[0] === 'port') {
        return { stdout: '127.0.0.1:49153\n' };
      }
      if (command.command === '/test/node' && command.args.includes('generate')) {
        throw new Error('generation failed');
      }
      return { stdout: '' };
    });

    await expect(
      runDisposableAflTradeOutcomesTests({
        ...harnessPaths,
        execute,
        processId: 4343,
        randomId: () => '123456abcdef',
        sleep: async () => undefined,
      })
    ).rejects.toThrow('generation failed');

    expect(commands.at(-1)).toEqual({
      command: 'docker',
      args: ['rm', '--force', secondContainerId],
      output: 'pipe',
      timeoutMs: 15_000,
    });
    expect(
      commands.filter((command) => command.command === 'docker' && command.args[0] === 'rm')
    ).toHaveLength(1);
  });

  it('fails closed and cleans up before Prisma can read a schema-adjacent environment file', async () => {
    const commands: AflTradeOutcomesHarnessCommand[] = [];
    const execute = vi.fn(async (command: AflTradeOutcomesHarnessCommand) => {
      commands.push(command);
      if (command.command === 'docker' && command.args[0] === 'run') {
        return { stdout: `${firstContainerId}\n` };
      }
      if (command.command === 'docker' && command.args[0] === 'port') {
        return { stdout: '127.0.0.1:49156\n' };
      }
      return { stdout: '' };
    });

    await expect(
      runDisposableAflTradeOutcomesTests({
        ...harnessPaths,
        execute,
        processId: 4949,
        randomId: () => 'abcdef987654',
        schemaEnvironmentFileExists: (path) => path === '/workspace/prisma/afl-trade-outcomes/.env',
        sleep: async () => undefined,
      })
    ).rejects.toThrow('protected schema-adjacent environment file');

    expect(commands.some((command) => command.command === '/test/node')).toBe(false);
    expect(commands.at(-1)).toEqual({
      command: 'docker',
      args: ['rm', '--force', firstContainerId],
      output: 'pipe',
      timeoutMs: 15_000,
    });
  });

  it('does not start Docker when the requested run is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const execute = vi.fn(async () => ({ stdout: '' }));

    await expect(
      runDisposableAflTradeOutcomesTests({
        ...harnessPaths,
        execute,
        signal: controller.signal,
      })
    ).rejects.toThrow('cancelled');
    expect(execute).not.toHaveBeenCalled();
  });

  it('captures and removes the immutable container id when cancellation arrives during creation', async () => {
    const controller = new AbortController();
    const commands: AflTradeOutcomesHarnessCommand[] = [];
    const execute = vi.fn(async (command: AflTradeOutcomesHarnessCommand) => {
      commands.push(command);
      if (command.command === 'docker' && command.args[0] === 'run') {
        controller.abort(new Error('cancelled during creation'));
        if (command.signal?.aborted) throw new Error('creation was interrupted before id capture');
        return { stdout: `${firstContainerId}\n` };
      }
      return { stdout: '' };
    });

    await expect(
      runDisposableAflTradeOutcomesTests({
        ...harnessPaths,
        execute,
        processId: 4747,
        randomId: () => 'abcdef123456',
        signal: controller.signal,
      })
    ).rejects.toThrow('cancelled during creation');
    expect(commands.at(-1)).toEqual({
      command: 'docker',
      args: ['rm', '--force', firstContainerId],
      output: 'pipe',
      timeoutMs: 15_000,
    });
  });

  it('recovers and removes the owned immutable container id when creation output is lost', async () => {
    const commands: AflTradeOutcomesHarnessCommand[] = [];
    const execute = vi.fn(async (command: AflTradeOutcomesHarnessCommand) => {
      commands.push(command);
      if (command.command === 'docker' && command.args[0] === 'run') {
        throw new Error('docker run timed out after container creation');
      }
      if (command.command === 'docker' && command.args[0] === 'ps') {
        return { stdout: `${secondContainerId}\n` };
      }
      return { stdout: '' };
    });

    await expect(
      runDisposableAflTradeOutcomesTests({
        ...harnessPaths,
        execute,
        processId: 4848,
        randomId: () => '654321abcdef',
      })
    ).rejects.toThrow('docker run timed out after container creation');

    expect(commands[2]).toEqual({
      command: 'docker',
      args: [
        'ps',
        '--all',
        '--no-trunc',
        '--filter',
        'label=com.statly.afl-outcomes-harness=statly-afl-outcomes-test-4848-654321abcdef',
        '--format',
        '{{.ID}}',
      ],
      output: 'pipe',
      timeoutMs: 15_000,
    });
    expect(commands.at(-1)).toEqual({
      command: 'docker',
      args: ['rm', '--force', secondContainerId],
      output: 'pipe',
      timeoutMs: 15_000,
    });
  });

  it('does not remove a same-named container when Docker refuses to create this run', async () => {
    const execute = vi.fn(async (command: AflTradeOutcomesHarnessCommand) => {
      if (command.command === 'docker' && command.args[0] === 'run') {
        throw new Error('container name is already in use');
      }
      return { stdout: '' };
    });

    await expect(
      runDisposableAflTradeOutcomesTests({
        ...harnessPaths,
        execute,
        processId: 4444,
        randomId: () => 'abcdef654321',
      })
    ).rejects.toThrow('container name is already in use');
    expect(execute.mock.calls.some(([command]) => command.args[0] === 'rm')).toBe(false);
  });

  it('reports both the child failure and an exact-container cleanup failure', async () => {
    const execute = vi.fn(async (command: AflTradeOutcomesHarnessCommand) => {
      if (command.command === 'docker' && command.args[0] === 'run') {
        return { stdout: `${firstContainerId}\n` };
      }
      if (command.command === 'docker' && command.args[0] === 'port') {
        return { stdout: '127.0.0.1:49154\n' };
      }
      if (command.command === '/test/node' && command.args.includes('generate')) {
        throw new Error('generation failed');
      }
      if (command.command === 'docker' && command.args[0] === 'rm') {
        throw new Error('cleanup failed');
      }
      return { stdout: '' };
    });

    const failure = await runDisposableAflTradeOutcomesTests({
      ...harnessPaths,
      execute,
      processId: 4545,
      randomId: () => 'fedcba123456',
      sleep: async () => undefined,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({ message: 'generation failed' }),
      expect.objectContaining({ message: 'cleanup failed' }),
    ]);
  });

  it('reports cancellation requested while the exact container is being removed', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async (command: AflTradeOutcomesHarnessCommand) => {
      if (command.command === 'docker' && command.args[0] === 'run') {
        return { stdout: `${firstContainerId}\n` };
      }
      if (command.command === 'docker' && command.args[0] === 'port') {
        return { stdout: '127.0.0.1:49155\n' };
      }
      if (command.command === 'docker' && command.args[0] === 'rm') {
        controller.abort(new Error('late cancellation'));
      }
      return { stdout: '' };
    });

    await expect(
      runDisposableAflTradeOutcomesTests({
        ...harnessPaths,
        execute,
        processId: 4646,
        randomId: () => '123456fedcba',
        signal: controller.signal,
        sleep: async () => undefined,
      })
    ).rejects.toThrow('late cancellation');
  });
});
