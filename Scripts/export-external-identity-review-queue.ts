import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  loadAflTradeExternalIdentityReviewQueue,
  type AflTradeExternalIdentityReviewDependencies,
} from '../src/server/aflTradeIntelligence/source/externalIdentityReviewService';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '../src/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { PostgresAflTradeExternalIdentityReviewRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';

type QueueResult = Awaited<ReturnType<typeof loadAflTradeExternalIdentityReviewQueue>>;

interface CommandConnection {
  loadQueue(input: { completionId: string }): Promise<QueueResult>;
  close(): Promise<void>;
}

interface CommandDependencies {
  connect(databaseUrl: string): Promise<CommandConnection>;
  writeOutput(line: string): void;
}

const commandSchema = z
  .tuple([
    z.literal('--completion'),
    z.string().regex(/^external-historical-capture-completion:[a-f0-9]{64}$/),
  ])
  .transform(([, completionId]) => ({ completionId }));

function parseCommand(argv: readonly string[]) {
  const parsed = commandSchema.safeParse(argv);
  if (!parsed.success) {
    throw new TypeError(
      'The command requires --completion <external-historical-capture-completion ID>.'
    );
  }
  return parsed.data;
}

function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  return value;
}

async function connectPostgres(url: string): Promise<CommandConnection> {
  const pool = new Pool({ connectionString: url });
  const client = createPgAflOutcomeSqlClient(pool);
  const dependencies: AflTradeExternalIdentityReviewDependencies = {
    source: new PostgresAflTradeExternalHistoricalReconciliationSource(client),
    reviewRepository: new PostgresAflTradeExternalIdentityReviewRepository(client),
  };
  return {
    loadQueue: (input) => loadAflTradeExternalIdentityReviewQueue(input, dependencies),
    close: () => pool.end(),
  };
}

const defaultDependencies: CommandDependencies = {
  connect: connectPostgres,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradeExportExternalIdentityReviewQueueCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: CommandDependencies = defaultDependencies
): Promise<QueueResult> {
  const command = parseCommand(input.argv);
  const connection = await dependencies.connect(databaseUrl(input.env));
  try {
    const queue = await connection.loadQueue(command);
    dependencies.writeOutput(JSON.stringify(queue));
    return queue;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeExportExternalIdentityReviewQueueCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'External AFL identity review queue export failed; no decision, reconciliation, promotion, release, or publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
