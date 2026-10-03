import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { assertNoSchemaAdjacentPrismaEnvironmentFile } from './prismaEnvironmentGuard';

export interface AflTradeOutcomesHarnessCommand {
  command: string;
  args: string[];
  environment?: NodeJS.ProcessEnv;
  output: 'inherit' | 'pipe';
  signal?: AbortSignal;
  timeoutMs?: number;
  workingDirectory?: string;
}

export interface AflTradeOutcomesHarnessCommandResult {
  stdout: string;
}

export type AflTradeOutcomesHarnessExecutor = (
  command: AflTradeOutcomesHarnessCommand
) => Promise<AflTradeOutcomesHarnessCommandResult>;

export interface DisposableAflTradeOutcomesTestOptions {
  execute: AflTradeOutcomesHarnessExecutor;
  safeWorkingDirectory: string;
  workspaceRoot: string;
  environment?: NodeJS.ProcessEnv;
  nodeExecutable?: string;
  processId?: number;
  randomId?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  readinessAttempts?: number;
  schemaEnvironmentFileExists?: (path: string) => boolean;
  signal?: AbortSignal;
  storage?: { kind: 'owned_disk' };
}

export interface DisposableAflTradeOutcomesRuntime {
  ownedVolumeName?: string;
  containerId: string;
  databaseUrl: string;
  environment: NodeJS.ProcessEnv;
  safeWorkingDirectory: string;
  schemaPath: string;
  workspaceRoot: string;
}

const POSTGRES_IMAGE = 'postgres:16-alpine';
const POSTGRES_DATABASE = 'statly_outcomes_test';
const POSTGRES_USER = 'statly_test';
const POSTGRES_PASSWORD = 'statly_test';
const POSTGRES_CONTAINER_PORT = 5432;

function createContainerName(processId: number, randomId: string): string {
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    throw new Error('The disposable PostgreSQL harness requires a positive process identifier.');
  }
  if (!/^[a-z0-9]{12}$/.test(randomId)) {
    throw new Error('The disposable PostgreSQL harness generated an unsafe container identifier.');
  }
  return `statly-afl-outcomes-test-${processId}-${randomId}`;
}

function parseLoopbackPort(stdout: string): number {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) {
    throw new Error('Docker did not return exactly one loopback PostgreSQL port binding.');
  }
  const match = /^127\.0\.0\.1:(\d{1,5})$/u.exec(lines[0] ?? '');
  const port = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Docker returned an invalid loopback PostgreSQL port binding.');
  }
  return port;
}

function parseContainerId(stdout: string): string {
  const containerId = stdout.trim();
  if (!/^[a-f0-9]{64}$/u.test(containerId)) {
    throw new Error('Docker did not return a valid immutable PostgreSQL container identifier.');
  }
  return containerId;
}

function parseRecoveredContainerId(stdout: string): string | undefined {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  if (lines.length !== 1) {
    throw new Error(
      'Docker returned multiple containers for one disposable harness ownership label.'
    );
  }
  return parseContainerId(lines[0] ?? '');
}

function createTestEnvironment(
  environment: NodeJS.ProcessEnv,
  databaseUrl: string,
  containerId: string
): NodeJS.ProcessEnv {
  const allowedKeys = [
    'CI',
    'FORCE_COLOR',
    'LANG',
    'LC_ALL',
    'NO_COLOR',
    'PATH',
    'TEMP',
    'TERM',
    'TMP',
    'TMPDIR',
  ];
  const allowedEnvironment: Partial<NodeJS.ProcessEnv> = {};
  for (const key of allowedKeys) {
    if (environment[key] !== undefined) allowedEnvironment[key] = environment[key];
  }
  return {
    ...allowedEnvironment,
    AFL_OUTCOMES_DATABASE_URL: databaseUrl,
    AFL_OUTCOMES_TEST_CONTAINER_ID: containerId,
    AFL_OUTCOMES_TEST_DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
  };
}

async function waitForPostgres(options: {
  execute: AflTradeOutcomesHarnessExecutor;
  containerId: string;
  sleep: (milliseconds: number) => Promise<void>;
  attempts: number;
  signal?: AbortSignal;
}): Promise<void> {
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    options.signal?.throwIfAborted();
    try {
      await options.execute({
        command: 'docker',
        args: [
          'exec',
          options.containerId,
          'pg_isready',
          // The image's temporary initialization server accepts sockets only.
          '--host',
          '127.0.0.1',
          '--username',
          POSTGRES_USER,
          '--dbname',
          POSTGRES_DATABASE,
        ],
        output: 'pipe',
        timeoutMs: 5_000,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      return;
    } catch (error) {
      if (attempt === options.attempts) {
        throw new Error('Disposable PostgreSQL did not become ready in time.', { cause: error });
      }
      await options.sleep(500);
    }
  }
}

export async function withDisposableAflTradeOutcomesPostgres<Result>(
  options: DisposableAflTradeOutcomesTestOptions,
  workflow: (runtime: DisposableAflTradeOutcomesRuntime) => Promise<Result>
): Promise<Result> {
  if (
    options.storage !== undefined &&
    (options.storage === null ||
      typeof options.storage !== 'object' ||
      options.storage.kind !== 'owned_disk' ||
      Object.keys(options.storage).length !== 1)
  ) {
    throw new Error('Unsupported disposable PostgreSQL storage option.');
  }
  const environment = options.environment ?? process.env;
  const processId = options.processId ?? process.pid;
  const randomId = options.randomId?.() ?? randomBytes(6).toString('hex');
  const sleep =
    options.sleep ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const readinessAttempts = options.readinessAttempts ?? 120;
  const containerName = createContainerName(processId, randomId);
  const ownershipLabel = `com.statly.afl-outcomes-harness=${containerName}`;
  const volumeName = options.storage ? `${containerName}-data` : undefined;
  const volumeToken = volumeName ? randomBytes(24).toString('hex') : undefined;
  let volumeCreationAttempted = false;
  const inspectOwnedVolume = async () => {
    const inspected = await options.execute({
      command: 'docker',
      args: [
        'volume',
        'inspect',
        '--format',
        '{"Name":{{json .Name}},"Labels":{{json .Labels}}}',
        volumeName!,
      ],
      output: 'pipe',
      timeoutMs: 15_000,
    });
    const value = JSON.parse(inspected.stdout) as {
      Name?: unknown;
      Labels?: Record<string, unknown>;
    };
    if (
      value.Name !== volumeName ||
      value.Labels?.['com.statly.afl-outcomes-harness'] !== containerName ||
      value.Labels?.['com.statly.afl-outcomes-volume-token'] !== volumeToken
    ) {
      throw new Error(`Refusing access or deletion of unverified PostgreSQL volume ${volumeName}.`);
    }
  };
  let containerId: string | undefined;
  let failure: unknown;
  let result: Result | undefined;

  try {
    options.signal?.throwIfAborted();
    await options.execute({
      command: 'docker',
      args: ['version', '--format', '{{.Server.Version}}'],
      output: 'pipe',
      timeoutMs: 15_000,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    options.signal?.throwIfAborted();
    if (volumeName !== undefined) {
      const existing = await options.execute({
        command: 'docker',
        args: ['volume', 'ls', '--filter', `name=^${volumeName}$`, '--format', '{{.Name}}'],
        output: 'pipe',
        timeoutMs: 15_000,
      });
      if (existing.stdout.trim() !== '')
        throw new Error(`Refusing pre-existing PostgreSQL volume ${volumeName}.`);
      volumeCreationAttempted = true;
      await options.execute({
        command: 'docker',
        args: [
          'volume',
          'create',
          '--label',
          ownershipLabel,
          '--label',
          `com.statly.afl-outcomes-volume-token=${volumeToken}`,
          volumeName,
        ],
        output: 'pipe',
        timeoutMs: 15_000,
      });
      await inspectOwnedVolume();
    }
    options.signal?.throwIfAborted();
    let creationFailure: unknown;
    try {
      const runResult = await options.execute({
        command: 'docker',
        args: [
          'run',
          '--detach',
          '--rm',
          '--label',
          ownershipLabel,
          '--name',
          containerName,
          '--publish',
          `127.0.0.1::${POSTGRES_CONTAINER_PORT}`,
          ...(volumeName === undefined
            ? ['--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g']
            : ['--mount', `type=volume,source=${volumeName},target=/var/lib/postgresql/data`]),
          '--env',
          `POSTGRES_DB=${POSTGRES_DATABASE}`,
          '--env',
          `POSTGRES_USER=${POSTGRES_USER}`,
          '--env',
          `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
          POSTGRES_IMAGE,
          'postgres',
          '-c',
          'max_wal_size=128MB',
          '-c',
          'min_wal_size=32MB',
          '-c',
          'checkpoint_timeout=30s',
          '-c',
          'checkpoint_completion_target=0.9',
          // Each suite schema holds the complete ordered migration history, about 1,200 relations, and
          // DROP SCHEMA ... CASCADE has to lock every one of them. The default ceiling of 64 fails that
          // teardown with "out of shared memory", which surfaces as a lock-space error or a misleading
          // per-test timeout once several suites run together.
          '-c',
          'max_locks_per_transaction=2048',
        ],
        output: 'pipe',
        timeoutMs: 60_000,
      });
      containerId = parseContainerId(runResult.stdout);
    } catch (error) {
      creationFailure = error;
    }
    if (containerId === undefined) {
      try {
        const recovery = await options.execute({
          command: 'docker',
          args: [
            'ps',
            '--all',
            '--no-trunc',
            '--filter',
            `label=${ownershipLabel}`,
            '--format',
            '{{.ID}}',
          ],
          output: 'pipe',
          timeoutMs: 15_000,
        });
        containerId = parseRecoveredContainerId(recovery.stdout);
      } catch (recoveryError) {
        throw new AggregateError(
          [creationFailure, recoveryError].filter((error) => error !== undefined),
          `Docker container creation failed and ownership recovery for ${containerName} also failed.`
        );
      }
    }
    if (creationFailure !== undefined) throw creationFailure;
    if (containerId === undefined) {
      throw new Error(`Docker did not create a container owned by ${containerName}.`);
    }

    options.signal?.throwIfAborted();
    const portResult = await options.execute({
      command: 'docker',
      args: ['port', containerId, `${POSTGRES_CONTAINER_PORT}/tcp`],
      output: 'pipe',
      timeoutMs: 15_000,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const hostPort = parseLoopbackPort(portResult.stdout);
    await waitForPostgres({
      execute: options.execute,
      containerId,
      sleep,
      attempts: readinessAttempts,
      signal: options.signal,
    });

    const databaseUrl = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${hostPort}/${POSTGRES_DATABASE}`;
    const testEnvironment = createTestEnvironment(environment, databaseUrl, containerId);
    const schemaPath = resolve(options.workspaceRoot, 'prisma/afl-trade-outcomes/schema.prisma');
    assertNoSchemaAdjacentPrismaEnvironmentFile(schemaPath, options.schemaEnvironmentFileExists);
    result = await workflow({
      ...(volumeName === undefined ? {} : { ownedVolumeName: volumeName }),
      containerId,
      databaseUrl,
      environment: testEnvironment,
      safeWorkingDirectory: options.safeWorkingDirectory,
      schemaPath,
      workspaceRoot: options.workspaceRoot,
    });
  } catch (error) {
    failure = error;
  }

  let cleanupFailure: unknown;
  if (containerId !== undefined) {
    try {
      await options.execute({
        command: 'docker',
        args: ['rm', '--force', containerId],
        output: 'pipe',
        timeoutMs: 15_000,
      });
    } catch (error) {
      cleanupFailure = error;
    }
  }

  if (volumeCreationAttempted) {
    // A failed workflow may leave this volume as its only recoverable database copy.
    if (failure === undefined && cleanupFailure === undefined && !options.signal?.aborted) {
      try {
        await inspectOwnedVolume();
        options.signal?.throwIfAborted();
        await options.execute({
          command: 'docker',
          args: ['volume', 'rm', volumeName!],
          output: 'pipe',
          timeoutMs: 15_000,
        });
      } catch (error) {
        cleanupFailure = error;
      }
    }
    if (failure !== undefined || cleanupFailure !== undefined || options.signal?.aborted) {
      const causes = [
        failure,
        cleanupFailure,
        options.signal?.aborted ? options.signal.reason : undefined,
      ].filter((error) => error !== undefined);
      throw new AggregateError(
        causes,
        `Disposable PostgreSQL failed. Recovery volume identifier: ${volumeName}. It may remain; verify existence and ownership before recovery. No further deletion was attempted.`,
        { cause: failure ?? cleanupFailure ?? options.signal?.reason }
      );
    }
  }

  if (failure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError(
      [failure, cleanupFailure],
      `AFL outcomes checks failed and disposable container ${containerId ?? 'unknown'} could not be removed.`
    );
  }
  if (cleanupFailure !== undefined) throw cleanupFailure;
  if (failure !== undefined) throw failure;
  options.signal?.throwIfAborted();
  return result as Result;
}

export async function runDisposableAflTradeOutcomesTests(
  options: DisposableAflTradeOutcomesTestOptions
): Promise<void> {
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  await withDisposableAflTradeOutcomesPostgres(options, async (runtime) => {
    const commands = [
      {
        args: [
          resolve(runtime.workspaceRoot, 'node_modules/prisma/build/index.js'),
          'validate',
          '--schema',
          runtime.schemaPath,
        ],
        workingDirectory: runtime.safeWorkingDirectory,
      },
      {
        args: [
          resolve(runtime.workspaceRoot, 'node_modules/prisma/build/index.js'),
          'generate',
          '--schema',
          runtime.schemaPath,
        ],
        workingDirectory: runtime.safeWorkingDirectory,
      },
      {
        args: [
          resolve(runtime.workspaceRoot, 'node_modules/vitest/vitest.mjs'),
          'run',
          '--config',
          resolve(runtime.workspaceRoot, 'vitest.config.outcomes-int.ts'),
        ],
        workingDirectory: runtime.workspaceRoot,
      },
    ];
    for (const command of commands) {
      options.signal?.throwIfAborted();
      await options.execute({
        command: nodeExecutable,
        args: command.args,
        environment: runtime.environment,
        output: 'inherit',
        workingDirectory: command.workingDirectory,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    }
  });
}
