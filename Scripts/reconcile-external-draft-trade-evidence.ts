import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  buildAndPersistAflTradeExternalReconciliation,
  type AflTradeExternalReconciliationCommandRepository,
  type BuildAflTradeExternalReconciliationResult,
} from '../src/server/aflTradeIntelligence/source/externalReconciliationCommand';
import { PostgresAflTradeExternalReconciliationRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';

interface CommandConnection {
  repository: AflTradeExternalReconciliationCommandRepository;
  close(): Promise<void>;
}

interface CommandDependencies {
  readFile(path: string): Promise<string>;
  connect(databaseUrl: string): Promise<CommandConnection>;
  writeOutput(line: string): void;
}

function inputPath(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--input' || argv[1]?.trim() === '') {
    throw new TypeError('The command requires exactly one --input <reviewed-json-path>.');
  }
  return argv[1];
}

function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  return value;
}

function parseReviewedInput(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (cause) {
    throw new TypeError('The reviewed external reconciliation input is not valid JSON.', {
      cause,
    });
  }
}

async function connectPostgres(url: string): Promise<CommandConnection> {
  const pool = new Pool({ connectionString: url });
  return {
    repository: new PostgresAflTradeExternalReconciliationRepository(
      createPgAflOutcomeSqlClient(pool)
    ),
    close: () => pool.end(),
  };
}

const defaultDependencies: CommandDependencies = {
  readFile: (path) => readFile(path, 'utf8'),
  connect: connectPostgres,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradeExternalReconciliationCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: CommandDependencies = defaultDependencies
): Promise<BuildAflTradeExternalReconciliationResult> {
  const reviewedInput = parseReviewedInput(await dependencies.readFile(inputPath(input.argv)));
  const connection = await dependencies.connect(databaseUrl(input.env));
  try {
    const result = await buildAndPersistAflTradeExternalReconciliation(reviewedInput, {
      repository: connection.repository,
    });
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeExternalReconciliationCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'External AFL draft/trade reconciliation failed; no factual release or publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
