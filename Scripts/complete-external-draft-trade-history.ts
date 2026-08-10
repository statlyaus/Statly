import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  PostgresAflTradeExternalHistoricalCaptureCompletionRepository,
  type PersistedAflTradeExternalHistoricalCaptureCompletion,
} from '../src/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';

interface HistoricalCompletionRepository {
  completePlan(planId: string): Promise<PersistedAflTradeExternalHistoricalCaptureCompletion>;
}

interface HistoricalCompletionCommandConnection {
  repository: HistoricalCompletionRepository;
  close(): Promise<void>;
}

interface HistoricalCompletionCommandDependencies {
  connect(databaseUrl: string): Promise<HistoricalCompletionCommandConnection>;
  writeOutput(line: string): void;
}

const commandSchema = z
  .tuple([z.literal('--plan'), z.string().regex(/^external-historical-capture-plan:[a-f0-9]{64}$/)])
  .transform(([, planId]) => planId);

function parseCommand(argv: readonly string[]): string {
  const parsed = commandSchema.safeParse(argv);
  if (!parsed.success) {
    throw new TypeError('The command requires --plan <external-historical-capture-plan ID>.');
  }
  return parsed.data;
}

function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  return value;
}

async function connectPostgres(url: string): Promise<HistoricalCompletionCommandConnection> {
  const pool = new Pool({ connectionString: url });
  return {
    repository: new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
      createPgAflOutcomeSqlClient(pool)
    ),
    close: () => pool.end(),
  };
}

const defaultDependencies: HistoricalCompletionCommandDependencies = {
  connect: connectPostgres,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradeExternalHistoricalCompletionCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: HistoricalCompletionCommandDependencies = defaultDependencies
): Promise<PersistedAflTradeExternalHistoricalCaptureCompletion> {
  const planId = parseCommand(input.argv);
  const connection = await dependencies.connect(databaseUrl(input.env));
  try {
    const result = await connection.repository.completePlan(planId);
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeExternalHistoricalCompletionCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'External historical capture completion failed; no reconciliation, promotion, release or publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
