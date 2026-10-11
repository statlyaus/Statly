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
import { PostgresAflTradeReconciliationScopeDecisionRepository } from '../src/server/aflTradeIntelligence/source/postgresReconciliationScopeDecisionRepository';

export interface PrepareCommandArguments {
  completionId: string;
  /** `--defer-pick-lineage <review-decision:…>`: the owner's approved reconciliation-scope decision (#869). */
  pickLineageDeferral?: { decisionId: string };
}

interface CommandConnection {
  prepare(input: PrepareCommandArguments): Promise<PreparedAflTradeHistoricalReconciliation>;
  close(): Promise<void>;
}

interface CommandDependencies {
  connect(databaseUrl: string): Promise<CommandConnection>;
  writeOutput(line: string): void;
}

const usage =
  'Invalid arguments: use --completion <id> [--defer-pick-lineage <review-decision:sha256>].';

export function parseAflTradePrepareExternalReconciliationArguments(
  argv: readonly string[]
): PrepareCommandArguments {
  if (argv.length !== 2 && argv.length !== 4) throw new TypeError(usage);
  if (argv[0] !== '--completion' || argv[1] === undefined || argv[1].trim() === '') {
    throw new TypeError(usage);
  }
  if (argv.length === 2) return { completionId: argv[1] };
  const decisionId = argv[3];
  if (
    argv[2] !== '--defer-pick-lineage' ||
    decisionId === undefined ||
    !/^review-decision:[a-f0-9]{64}$/.test(decisionId)
  ) {
    throw new TypeError(usage);
  }
  return { completionId: argv[1], pickLineageDeferral: { decisionId } };
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
  const scopeDecisionRepository = new PostgresAflTradeReconciliationScopeDecisionRepository(client);
  return {
    prepare: (input) =>
      prepareAflTradeHistoricalReconciliation(input, {
        source,
        identityReviewRepository,
        candidateRepository,
        scopeDecisionRepository,
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
  const args = parseAflTradePrepareExternalReconciliationArguments(input.argv);
  const connection = await dependencies.connect(databaseUrl(input.env));
  try {
    const result = await connection.prepare(args);
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
