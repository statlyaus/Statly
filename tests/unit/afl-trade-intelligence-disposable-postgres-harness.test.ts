import { describe, expect, it, vi } from 'vitest';

import {
  runDisposableAflTradeOutcomesTests,
  withDisposableAflTradeOutcomesPostgres,
  type AflTradeOutcomesHarnessCommand,
  type DisposableAflTradeOutcomesRuntime,
} from '@/server/aflTradeIntelligence/development/disposablePostgresHarness';

const firstContainerId = 'a'.repeat(64);
const secondContainerId = 'b'.repeat(64);
const harnessPaths = {
  nodeExecutable: '/test/node',
  safeWorkingDirectory: '/tmp/statly-afl-outcomes-test',
  workspaceRoot: '/workspace',
};

describe('disposable AFL outcomes PostgreSQL harness', () => {
  it.each([
    'preexisting',
    'foreign_on_mount',
    'foreign_on_cleanup',
    'callback',
    'container_cleanup',
    'callback_and_cleanup',
    'lost_create_response',
    'lost_remove_response',
    'cancel_during_cleanup_inspection',
  ] as const)('preserves disk evidence and rejects unsafe lifecycle: %s', async (scenario) => {
    const commands: string[][] = [];
    const primary = new Error('original failure');
    const cleanup = new Error('cleanup failure');
    const controller = new AbortController();
    let labels: Record<string, string> = {};
    let inspections = 0;
    const volumeName = 'statly-afl-outcomes-test-4141-123456abcdef-data';
    const execute = async (command: AflTradeOutcomesHarnessCommand) => {
      commands.push(command.args);
      const [kind, action] = command.args;
      if (kind === 'volume') {
        if (action === 'ls') return { stdout: scenario === 'preexisting' ? volumeName : '' };
        if (action === 'create') {
          command.args.forEach((arg, index) => {
            if (arg === '--label') {
              const [key, value] = command.args[index + 1]!.split('=');
              labels[key!] = value!;
            }
          });
          if (scenario === 'lost_create_response') throw primary;
          return { stdout: volumeName };
        }
        if (action === 'inspect') {
          inspections++;
          if (scenario === 'cancel_during_cleanup_inspection' && inspections === 2)
            controller.abort(primary);
          if (
            scenario === 'foreign_on_mount' ||
            (scenario === 'foreign_on_cleanup' && inspections === 2)
          )
            labels = {};
          return { stdout: JSON.stringify({ Name: volumeName, Labels: labels }) };
        }
        if (action === 'rm') {
          if (scenario === 'lost_remove_response') throw primary;
          throw new Error('Must never remove retained or foreign evidence');
        }
      }
      if (kind === 'run') return { stdout: firstContainerId };
      if (kind === 'port') return { stdout: '127.0.0.1:49151' };
      if (kind === 'rm' && scenario === 'container_cleanup') throw primary;
      if (kind === 'rm' && scenario === 'callback_and_cleanup') throw cleanup;
      return { stdout: '' };
    };
    const workflow = vi.fn(async () => {
      if (scenario === 'callback' || scenario === 'callback_and_cleanup') throw primary;
    });
    let caught: unknown;
    try {
      await withDisposableAflTradeOutcomesPostgres(
        {
          ...harnessPaths,
          execute,
          storage: { kind: 'owned_disk' },
          signal: controller.signal,
          processId: 4141,
          randomId: () => '123456abcdef',
        },
        workflow
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(volumeName);
    const removalAttempts = commands.filter((args) => args[0] === 'volume' && args[1] === 'rm');
    expect(removalAttempts).toHaveLength(scenario === 'lost_remove_response' ? 1 : 0);
    if (scenario === 'lost_remove_response') {
      expect((caught as Error).message).toContain('may remain');
      expect((caught as Error).message).toContain('verify existence and ownership');
      expect((caught as AggregateError).errors).toContain(primary);
      expect((caught as Error).cause).toBe(primary);
    }
    if (['preexisting', 'foreign_on_mount', 'lost_create_response'].includes(scenario))
      expect(workflow).not.toHaveBeenCalled();
    if (scenario === 'preexisting')
      expect(commands.some((args) => args[1] === 'create')).toBe(false);
    if (
      ['callback', 'callback_and_cleanup', 'container_cleanup', 'lost_create_response'].includes(
        scenario
      )
    ) {
      expect((caught as AggregateError).errors).toContain(primary);
      expect((caught as Error).cause).toBe(primary);
    }
    if (scenario === 'callback_and_cleanup')
      expect((caught as AggregateError).errors).toEqual([primary, cleanup]);
  });

  it('rejects unknown storage configuration before any Docker command', async () => {
    const execute = vi.fn();
    await expect(
      withDisposableAflTradeOutcomesPostgres(
        { ...harnessPaths, execute, storage: { kind: 'shared_disk' } as never },
        async () => undefined
      )
    ).rejects.toThrow('Unsupported');
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses an owned disk volume and removes it only after the successful workflow and container cleanup', async () => {
    const commands: AflTradeOutcomesHarnessCommand[] = [];
    let volume: { Name: string; Labels: Record<string, string> } | undefined;
    let backedUp = false;
    const execute = async (command: AflTradeOutcomesHarnessCommand) => {
      commands.push(command);
      if (command.args[0] === 'volume') {
        if (command.args[1] === 'ls') return { stdout: '' };
        if (command.args[1] === 'create') {
          const labels: Record<string, string> = {};
          command.args.forEach((arg, index) => {
            if (arg === '--label') {
              const [key, value] = command.args[index + 1]!.split('=');
              labels[key!] = value!;
            }
          });
          volume = { Name: command.args.at(-1)!, Labels: labels };
          return { stdout: volume.Name };
        }
        if (command.args[1] === 'inspect') return { stdout: JSON.stringify(volume) };
        if (command.args[1] === 'rm') {
          expect(backedUp).toBe(true);
          expect(commands.at(-3)?.args).toEqual(['rm', '--force', firstContainerId]);
          expect(command.args).toEqual(['volume', 'rm', volume!.Name]);
          return { stdout: volume!.Name };
        }
      }
      if (command.args[0] === 'run') {
        expect(command.args).not.toContain('--tmpfs');
        expect(command.args).toContain(
          `type=volume,source=${volume!.Name},target=/var/lib/postgresql/data`
        );
        return { stdout: firstContainerId };
      }
      if (command.args[0] === 'port') return { stdout: '127.0.0.1:49151' };
      return { stdout: '' };
    };
    const result = await withDisposableAflTradeOutcomesPostgres(
      {
        ...harnessPaths,
        execute,
        storage: { kind: 'owned_disk' },
        processId: 4141,
        randomId: () => '123456abcdef',
      },
      async (runtime) => {
        expect(runtime.ownedVolumeName).toBe('statly-afl-outcomes-test-4141-123456abcdef-data');
        backedUp = true;
        return 'backup-retained';
      }
    );
    expect(result).toBe('backup-retained');
    expect(commands.at(-1)?.args[0]).toBe('volume');
  });

  it('does not expose a socket-only initialization server as a ready workflow database', async () => {
    let tcpReady = false;
    const execute = async (command: AflTradeOutcomesHarnessCommand) => {
      if (command.args[0] === 'run') return { stdout: firstContainerId };
      if (command.args[0] === 'port') return { stdout: '127.0.0.1:49151' };
      if (command.args.includes('pg_isready') && command.args.includes('--host')) {
        expect(command.args[command.args.indexOf('--host') + 1]).toBe('127.0.0.1');
        if (!tcpReady) throw new Error('TCP startup server is not ready');
      }
      // The image's initialization server accepts Unix sockets before TCP starts.
      return { stdout: '' };
    };
    await withDisposableAflTradeOutcomesPostgres(
      {
        ...harnessPaths,
        execute,
        processId: 4141,
        randomId: () => '123456abcdef',
        sleep: async () => {
          tcpReady = true;
        },
      },
      async () => {
        expect(tcpReady).toBe(true);
      }
    );
  });

  it('exposes the isolated runtime to one workflow and removes the exact container afterward', async () => {
    const commands: AflTradeOutcomesHarnessCommand[] = [];
    const execute = vi.fn(async (command: AflTradeOutcomesHarnessCommand) => {
      commands.push(command);
      if (command.command === 'docker' && command.args[0] === 'run') {
        return { stdout: `${firstContainerId}\n` };
      }
      if (command.command === 'docker' && command.args[0] === 'port') {
        return { stdout: '127.0.0.1:49151\n' };
      }
      return { stdout: '' };
    });
    const workflow = vi.fn(async (_runtime: DisposableAflTradeOutcomesRuntime) =>
      Promise.resolve('inventory-complete')
    );

    const result = await withDisposableAflTradeOutcomesPostgres(
      {
        ...harnessPaths,
        execute,
        environment: {
          NODE_ENV: 'test',
          PATH: '/test/bin',
          UNRELATED_RUNTIME_VALUE: 'not-forwarded',
        },
        processId: 4141,
        randomId: () => '123456abcdef',
        sleep: async () => undefined,
      },
      workflow
    );

    expect(result).toBe('inventory-complete');
    expect(workflow).toHaveBeenCalledOnce();
    expect(workflow).toHaveBeenCalledWith({
      containerId: firstContainerId,
      databaseUrl: 'postgresql://statly_test:statly_test@127.0.0.1:49151/statly_outcomes_test',
      environment: expect.objectContaining({
        PATH: '/test/bin',
        AFL_OUTCOMES_TEST_CONTAINER_ID: firstContainerId,
      }),
      safeWorkingDirectory: '/tmp/statly-afl-outcomes-test',
      schemaPath: '/workspace/prisma/afl-trade-outcomes/schema.prisma',
      workspaceRoot: '/workspace',
    });
    expect(workflow.mock.calls[0]?.[0].environment).not.toHaveProperty('UNRELATED_RUNTIME_VALUE');
    expect(commands.at(-1)).toEqual({
      command: 'docker',
      args: ['rm', '--force', firstContainerId],
      output: 'pipe',
      timeoutMs: 15_000,
    });
  });

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
        NODE_ENV: 'test',
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
        '-c',
        'max_locks_per_transaction=2048',
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
        '--host',
        '127.0.0.1',
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
