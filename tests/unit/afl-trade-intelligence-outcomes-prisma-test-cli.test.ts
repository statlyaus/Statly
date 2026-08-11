import { describe, expect, it, vi } from 'vitest';

import {
  runOutcomesPrismaTestCommand,
  type OutcomesPrismaTestCommand,
} from '../outcomes-integration/outcomesPrismaTestCli';

describe('outcomes integration Prisma test CLI', () => {
  it('runs from an isolated directory with absolute trusted paths and an allowlisted environment', () => {
    const commands: OutcomesPrismaTestCommand[] = [];
    const execute = vi.fn((command: OutcomesPrismaTestCommand) => {
      commands.push(command);
      return 'migration output';
    });
    const removeSafeWorkingDirectory = vi.fn();

    const output = runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
      databaseUrl: 'postgresql://statly_test:statly_test@127.0.0.1:49152/outcomes',
      dependencies: {
        createSafeWorkingDirectory: () => '/tmp/statly-outcomes-prisma-test',
        environment: {
          PATH: '/test/bin',
          CI: 'true',
          AFL_TRADE_FITZROY_EGRESS_BEARER_TOKEN: 'must-not-be-forwarded',
        },
        execute,
        nodeExecutable: '/test/node',
        removeSafeWorkingDirectory,
        workspaceRoot: '/workspace',
      },
    });

    expect(output).toBe('migration output');
    expect(commands).toEqual([
      {
        command: '/test/node',
        args: [
          '/workspace/node_modules/prisma/build/index.js',
          'migrate',
          'deploy',
          '--schema',
          '/workspace/prisma/afl-trade-outcomes/schema.prisma',
        ],
        environment: {
          PATH: '/test/bin',
          CI: 'true',
          AFL_OUTCOMES_DATABASE_URL:
            'postgresql://statly_test:statly_test@127.0.0.1:49152/outcomes',
          PRISMA_HIDE_UPDATE_MESSAGE: '1',
        },
        workingDirectory: '/tmp/statly-outcomes-prisma-test',
      },
    ]);
    expect(removeSafeWorkingDirectory).toHaveBeenCalledExactlyOnceWith(
      '/tmp/statly-outcomes-prisma-test'
    );
  });

  it('removes the exact isolated directory when Prisma fails', () => {
    const removeSafeWorkingDirectory = vi.fn();

    expect(() =>
      runOutcomesPrismaTestCommand(['validate'], {
        databaseUrl: 'postgresql://statly_test:statly_test@127.0.0.1:49152/outcomes',
        dependencies: {
          createSafeWorkingDirectory: () => '/tmp/statly-outcomes-prisma-failure',
          execute: () => {
            throw new Error('Prisma failed');
          },
          removeSafeWorkingDirectory,
          workspaceRoot: '/workspace',
        },
      })
    ).toThrow('Prisma failed');
    expect(removeSafeWorkingDirectory).toHaveBeenCalledExactlyOnceWith(
      '/tmp/statly-outcomes-prisma-failure'
    );
  });

  it('fails closed before execution when Prisma could load a schema-adjacent environment file', () => {
    const execute = vi.fn(() => 'not reached');

    expect(() =>
      runOutcomesPrismaTestCommand(['validate'], {
        databaseUrl: 'postgresql://statly_test:statly_test@127.0.0.1:49152/outcomes',
        dependencies: {
          createSafeWorkingDirectory: () => '/tmp/statly-outcomes-prisma-env-guard',
          execute,
          removeSafeWorkingDirectory: vi.fn(),
          schemaEnvironmentFileExists: (path) =>
            path === '/workspace/prisma/afl-trade-outcomes/.env',
          workspaceRoot: '/workspace',
        },
      })
    ).toThrow('protected schema-adjacent environment file');
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports both Prisma and exact-directory cleanup failures', () => {
    const failure = (() => {
      try {
        runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
          databaseUrl: 'postgresql://statly_test:statly_test@127.0.0.1:49152/outcomes',
          dependencies: {
            createSafeWorkingDirectory: () => '/tmp/statly-outcomes-prisma-dual-failure',
            execute: () => {
              throw new Error('Prisma failed');
            },
            removeSafeWorkingDirectory: () => {
              throw new Error('directory was not empty');
            },
            workspaceRoot: '/workspace',
          },
        });
      } catch (error) {
        return error;
      }
      return undefined;
    })();

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({ message: 'Prisma failed' }),
      expect.objectContaining({ message: 'directory was not empty' }),
    ]);
  });
});
