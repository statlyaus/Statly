import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { assertNoSchemaAdjacentPrismaEnvironmentFile } from '@/server/aflTradeIntelligence/development/prismaEnvironmentGuard';

const DEFAULT_WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUTCOMES_PRISMA_SCHEMA_PATH = join(
  DEFAULT_WORKSPACE_ROOT,
  'prisma',
  'afl-trade-outcomes',
  'schema.prisma'
);
const FORWARDED_ENVIRONMENT_KEYS = [
  'CI',
  'FORCE_COLOR',
  'NO_COLOR',
  'PATH',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
] as const;

export interface OutcomesPrismaTestCommand {
  command: string;
  args: readonly string[];
  environment: NodeJS.ProcessEnv;
  workingDirectory: string;
}

interface OutcomesPrismaTestCommandDependencies {
  createSafeWorkingDirectory?: () => string;
  environment?: NodeJS.ProcessEnv;
  execute?: (command: OutcomesPrismaTestCommand) => string;
  nodeExecutable?: string;
  removeSafeWorkingDirectory?: (workingDirectory: string) => void;
  schemaEnvironmentFileExists?: (path: string) => boolean;
  workspaceRoot?: string;
}

interface RunOutcomesPrismaTestCommandOptions {
  appendSchemaArgument?: boolean;
  databaseUrl: string;
  dependencies?: OutcomesPrismaTestCommandDependencies;
}

function createSafeWorkingDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'statly-afl-outcomes-prisma-'));
}

function removeSafeWorkingDirectory(workingDirectory: string): void {
  rmdirSync(workingDirectory);
}

function execute(command: OutcomesPrismaTestCommand): string {
  return execFileSync(command.command, [...command.args], {
    cwd: command.workingDirectory,
    encoding: 'utf8',
    env: command.environment,
    stdio: 'pipe',
  });
}

function createChildEnvironment(
  environment: NodeJS.ProcessEnv,
  databaseUrl: string
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: environment.NODE_ENV ?? 'test',
    AFL_OUTCOMES_DATABASE_URL: databaseUrl,
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
  };

  for (const key of FORWARDED_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (value !== undefined) childEnvironment[key] = value;
  }

  return childEnvironment;
}

export function runOutcomesPrismaTestCommand(
  args: readonly string[],
  options: RunOutcomesPrismaTestCommandOptions
): string {
  const dependencies = options.dependencies ?? {};
  const workspaceRoot = dependencies.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;
  const schemaPath = join(workspaceRoot, 'prisma', 'afl-trade-outcomes', 'schema.prisma');
  const safeWorkingDirectory = (
    dependencies.createSafeWorkingDirectory ?? createSafeWorkingDirectory
  )();
  let failure: unknown;
  let output: string | undefined;

  try {
    assertNoSchemaAdjacentPrismaEnvironmentFile(
      schemaPath,
      dependencies.schemaEnvironmentFileExists
    );
    output = (dependencies.execute ?? execute)({
      command: dependencies.nodeExecutable ?? process.execPath,
      args: [
        join(workspaceRoot, 'node_modules', 'prisma', 'build', 'index.js'),
        ...args,
        ...(options.appendSchemaArgument === false ? [] : ['--schema', schemaPath]),
      ],
      environment: createChildEnvironment(
        dependencies.environment ?? process.env,
        options.databaseUrl
      ),
      workingDirectory: safeWorkingDirectory,
    });
  } catch (error) {
    failure = error;
  }

  let cleanupFailure: unknown;
  try {
    (dependencies.removeSafeWorkingDirectory ?? removeSafeWorkingDirectory)(safeWorkingDirectory);
  } catch (error) {
    cleanupFailure = error;
  }

  if (failure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError(
      [failure, cleanupFailure],
      'The isolated Prisma command and exact temporary-directory cleanup both failed.'
    );
  }
  if (cleanupFailure !== undefined) throw cleanupFailure;
  if (failure !== undefined) throw failure;
  return output ?? '';
}
