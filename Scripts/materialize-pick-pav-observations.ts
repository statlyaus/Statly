import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createPostgresAflTradePickPavObservationRepository,
  type PostgresAflTradePickPavObservationRepository,
} from '../src/server/aflTradeIntelligence/modeling/postgresPickPavObservationRepository';

const addressed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}:[a-f0-9]{64}$`));

const commandSchema = z
  .tuple([
    z.literal('--environment'),
    z.enum(['test_fixture', 'non_production', 'production']),
    z.literal('--release-id'),
    addressed('outcome-release'),
    z.literal('--policy-id'),
    addressed('pick-pav-policy'),
    z.literal('--knowledge-cutoff-at'),
    z.iso.datetime({ offset: true }),
  ])
  .transform(([, environment, , releaseId, , policyId, , knowledgeCutoffAt]) => ({
    environment,
    competition: 'AFLM' as const,
    releaseId,
    policyId,
    knowledgeCutoffAt,
  }));

export interface AflTradePickPavObservationMaterializationSummary {
  readonly environment: 'test_fixture' | 'non_production' | 'production';
  readonly competition: 'AFLM';
  readonly releaseId: string;
  readonly policyId: string;
  readonly knowledgeCutoffAt: string;
  readonly observationSetId: string;
  readonly observationCount: number;
  readonly draftClassCount: number;
  readonly calculationCount: number;
  readonly idempotentReplay: boolean;
}

interface PickPavObservationConnection {
  materialize(input: {
    environment: 'test_fixture' | 'non_production' | 'production';
    competition: 'AFLM';
    releaseId: string;
    policyId: string;
    knowledgeCutoffAt: string;
  }): Promise<AflTradePickPavObservationMaterializationSummary>;
  close(): Promise<void>;
}

interface PickPavObservationCommandDependencies {
  connect(databaseUrl: string): Promise<PickPavObservationConnection>;
  writeOutput(line: string): void;
}

function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  return value;
}

function summarize(
  input: ReturnType<typeof commandSchema.parse>,
  result: Awaited<ReturnType<PostgresAflTradePickPavObservationRepository['materializeAndPersist']>>
): AflTradePickPavObservationMaterializationSummary {
  const observationSet = result.observationSet;
  return {
    environment: input.environment,
    competition: input.competition,
    releaseId: input.releaseId,
    policyId: input.policyId,
    knowledgeCutoffAt: input.knowledgeCutoffAt,
    observationSetId: observationSet.observationSetId,
    observationCount: observationSet.content.observations.length,
    draftClassCount: observationSet.content.draftClasses.length,
    calculationCount: observationSet.content.calculations.length,
    idempotentReplay: result.idempotentReplay,
  };
}

async function connectPostgres(databaseUrlValue: string): Promise<PickPavObservationConnection> {
  const pool = new Pool({ connectionString: databaseUrlValue });
  const repository = createPostgresAflTradePickPavObservationRepository(
    createPgAflOutcomeSqlClient(pool)
  );
  return {
    async materialize(input) {
      const persisted = await repository.materializeAndPersist(input, {
        environment: input.environment,
      });
      return summarize(input, persisted);
    },
    close: () => pool.end(),
  };
}

const defaultDependencies: PickPavObservationCommandDependencies = {
  connect: connectPostgres,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradeMaterializePickPavObservationsCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: PickPavObservationCommandDependencies = defaultDependencies
): Promise<AflTradePickPavObservationMaterializationSummary> {
  const command = commandSchema.parse(input.argv);
  const connection = await dependencies.connect(databaseUrl(input.env));
  try {
    const result = await connection.materialize(command);
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeMaterializePickPavObservationsCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'AFL pick-PAV observation materialization failed; no model fit, Gate approval, or valuation publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
