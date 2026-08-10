import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  prepareAflTradeHistoricalReconciliation,
  type PreparedAflTradeHistoricalReconciliation,
} from '../src/server/aflTradeIntelligence/source/externalHistoricalReconciliationPreparation';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '../src/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { PostgresAflTradeExternalIdentityReviewRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import { PostgresAflTradeExternalReconciliationRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';

interface CommandConnection {
  prepare(input: { completionId: string }): Promise<PreparedAflTradeHistoricalReconciliation>;
  close(): Promise<void>;
}

interface CommandDependencies {
  connect(databaseUrl: string): Promise<CommandConnection>;
  writeOutput(line: string): void;
}

function parseArguments(argv: readonly string[]): { completionId: string } {
  if (argv.length !== 2) {
    throw new TypeError('Invalid arguments: use --completion <id>.');
  }
  if (argv[0] !== '--completion' || argv[1]?.trim() === '') {
    throw new TypeError('Invalid arguments: use --completion <id>.');
  }
  return { completionId: argv[1] };
}

function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  return value;
}

async function connectPostgres(url: string): Promise<CommandConnection> {
  const pool = new Pool({ connectionString: url });
  const client = createPgAflOutcomeSqlClient(pool);
  const source = new PostgresAflTradeExternalHistoricalReconciliationSource(client);
  const identityReviewRepository = new PostgresAflTradeExternalIdentityReviewRepository(client);
  const candidateRepository = new PostgresAflTradeExternalReconciliationRepository(client);
  return {
    prepare: (input) =>
      prepareAflTradeHistoricalReconciliation(input, {
        source,
        identityReviewRepository,
        candidateRepository,
      }),
    close: () => pool.end(),
  };
}

const defaultDependencies: CommandDependencies = {
  connect: connectPostgres,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradePrepareExternalHistoricalReconciliationCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: CommandDependencies = defaultDependencies
): Promise<PreparedAflTradeHistoricalReconciliation> {
  const args = parseArguments(input.argv);
  const connection = await dependencies.connect(databaseUrl(input.env));
  try {
    const result = await connection.prepare({ completionId: args.completionId });
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradePrepareExternalHistoricalReconciliationCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'Historical AFL draft/trade reconciliation preparation failed; no promotion, release, or publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
