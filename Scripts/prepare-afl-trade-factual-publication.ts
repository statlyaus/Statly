import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import {
  PostgresAflTradePromotionBackedCorpusRepository,
  type PersistedAflTradePromotionBackedCorpus,
} from '../src/server/aflTradeIntelligence/artifacts/postgresPromotionBackedCorpusRepository';
import { AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE } from '../src/server/aflTradeIntelligence/outcomes/outcomeReadService';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePromotionBackedFactualReleaseRepository } from '../src/server/aflTradeIntelligence/outcomes/postgresPromotionBackedFactualReleaseRepository';
import { PostgresAflTradePromotionBackedGate2Repository } from '../src/server/aflTradeIntelligence/outcomes/postgresPromotionBackedGate2Repository';
import { PostgresAflTradePromotionBackedPublicArchiveRepository } from '../src/server/aflTradeIntelligence/outcomes/postgresPromotionBackedPublicArchiveRepository';
import {
  prepareAflTradePromotionBackedFactualPublication,
  type AflTradePromotionBackedFactualPublicationPreparation,
} from '../src/server/aflTradeIntelligence/outcomes/preparePromotionBackedFactualPublication';

const commandSchema = z
  .tuple([
    z.literal('--competition'),
    z.string().trim().min(1).max(40),
    z.literal('--as-of'),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      .pipe(z.iso.datetime({ offset: true })),
  ])
  .transform(([, competition, , asOf]) => ({ competition, asOf }));

interface FactualPublicationPreparationResult {
  readonly environment: 'production';
  readonly competition: string;
  readonly asOf: string;
  readonly corpus: PersistedAflTradePromotionBackedCorpus;
  readonly preparation: AflTradePromotionBackedFactualPublicationPreparation;
}

interface FactualPublicationPreparationConnection {
  prepare(input: {
    competition: string;
    asOf: string;
  }): Promise<FactualPublicationPreparationResult>;
  close(): Promise<void>;
}

interface FactualPublicationPreparationCommandDependencies {
  connect(databaseUrl: string): Promise<FactualPublicationPreparationConnection>;
  writeOutput(line: string): void;
}

function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  return value;
}

async function connectPostgres(
  databaseUrlValue: string
): Promise<FactualPublicationPreparationConnection> {
  const pool = new Pool({ connectionString: databaseUrlValue });
  const client = createPgAflOutcomeSqlClient(pool);
  const corpusRepository = new PostgresAflTradePromotionBackedCorpusRepository(client);
  const releaseRepository = new PostgresAflTradePromotionBackedFactualReleaseRepository(client);
  const gate2Repository = new PostgresAflTradePromotionBackedGate2Repository(client);
  const archiveRepository = new PostgresAflTradePromotionBackedPublicArchiveRepository(client);
  return {
    async prepare({ competition, asOf }) {
      const corpus = await corpusRepository.build({
        environment: 'production',
        competition,
        knowledgeCutoffAt: asOf,
        createdAt: asOf,
      });
      const preparation = await prepareAflTradePromotionBackedFactualPublication(
        {
          corpusId: corpus.corpusId,
          scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
          releaseCreatedAt: asOf,
          lineageCreatedAt: asOf,
          archiveCreatedAt: asOf,
        },
        { releaseRepository, gate2Repository, archiveRepository }
      );
      return { environment: 'production', competition, asOf, corpus, preparation };
    },
    close: () => pool.end(),
  };
}

const defaultDependencies: FactualPublicationPreparationCommandDependencies = {
  connect: connectPostgres,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradePrepareFactualPublicationCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: FactualPublicationPreparationCommandDependencies = defaultDependencies
): Promise<FactualPublicationPreparationResult> {
  const command = commandSchema.parse(input.argv);
  const connection = await dependencies.connect(databaseUrl(input.env));
  try {
    const result = await connection.prepare(command);
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradePrepareFactualPublicationCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'AFL draft/trade factual publication preparation failed; no Gate decision, registration, activation, or valuation publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
