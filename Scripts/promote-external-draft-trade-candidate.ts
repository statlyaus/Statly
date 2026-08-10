import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  PostgresAflTradeExternalCanonicalPromotionRepository,
  type PromoteAflTradeExternalCandidateInput,
  type PromotedAflTradeExternalCandidate,
} from '../src/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';

interface PromotionRepository {
  promote(input: PromoteAflTradeExternalCandidateInput): Promise<PromotedAflTradeExternalCandidate>;
}

interface PromotionCommandConnection {
  repository: PromotionRepository;
  close(): Promise<void>;
}

interface PromotionCommandDependencies {
  connect(databaseUrl: string): Promise<PromotionCommandConnection>;
  writeOutput(line: string): void;
}

const commandSchema = z
  .tuple([
    z.literal('--candidate'),
    z.string().regex(/^external-reconciliation:[a-f0-9]{64}$/),
    z.literal('--approval-decision'),
    z.string().regex(/^review-decision:[a-f0-9]{64}$/),
  ])
  .transform(([, candidateId, , approvalDecisionId]) => ({
    candidateId,
    approvalDecisionId,
  }));

function parseCommand(argv: readonly string[]): PromoteAflTradeExternalCandidateInput {
  const parsed = commandSchema.safeParse(argv);
  if (!parsed.success) {
    throw new TypeError(
      'The command requires --candidate <external-reconciliation ID> --approval-decision <review-decision ID>.'
    );
  }
  return parsed.data;
}

function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  return value;
}

async function connectPostgres(url: string): Promise<PromotionCommandConnection> {
  const pool = new Pool({ connectionString: url });
  return {
    repository: new PostgresAflTradeExternalCanonicalPromotionRepository(
      createPgAflOutcomeSqlClient(pool)
    ),
    close: () => pool.end(),
  };
}

const defaultDependencies: PromotionCommandDependencies = {
  connect: connectPostgres,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradeExternalCandidatePromotionCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: PromotionCommandDependencies = defaultDependencies
): Promise<PromotedAflTradeExternalCandidate> {
  const command = parseCommand(input.argv);
  const connection = await dependencies.connect(databaseUrl(input.env));
  try {
    const result = await connection.repository.promote(command);
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeExternalCandidatePromotionCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'External AFL draft/trade candidate promotion failed; no factual release or publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
