import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';
import {
  recordAflTradeExternalCanonicalPromotionReview,
  type AflTradeExternalCanonicalPromotionReviewRepository,
  type PersistedAflTradeExternalCanonicalPromotionReview,
} from '../src/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewService';

interface CommandConnection {
  repository: AflTradeExternalCanonicalPromotionReviewRepository;
  close(): Promise<void>;
}

interface CommandDependencies {
  connect(databaseUrl: string): Promise<CommandConnection>;
  readJson(path: string): Promise<unknown>;
  writeOutput(line: string): void;
}

const commandSchema = z
  .tuple([
    z.literal('--candidate'),
    z.string().regex(/^external-reconciliation:[a-f0-9]{64}$/),
    z.literal('--draft-events'),
    z.string().trim().min(1),
    z.literal('--transaction-dates'),
    z.string().trim().min(1),
    z.literal('--decision'),
    z.enum(['approved', 'rejected', 'withdrawn']),
    z.literal('--rationale'),
    z.string().trim().min(1).max(4_000),
    z.literal('--authority-evidence'),
    z.string().regex(/^reviewer-authority-evidence:[a-f0-9]{64}$/),
    z.literal('--reviewer'),
    z.string().trim().min(1).max(240),
    z.literal('--decided-at'),
    z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  ])
  .transform(
    ([
      ,
      candidateId,
      ,
      draftEventsPath,
      ,
      transactionDatesPath,
      ,
      decision,
      ,
      rationale,
      ,
      authorityEvidenceId,
      ,
      decidedBy,
      ,
      decidedAt,
    ]) => ({
      candidateId,
      draftEventsPath,
      transactionDatesPath,
      decision,
      rationale,
      authorityEvidenceId,
      decidedBy,
      decidedAt,
    })
  );

function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  return value;
}

async function connectPostgres(url: string): Promise<CommandConnection> {
  const pool = new Pool({ connectionString: url });
  return {
    repository: new PostgresAflTradeExternalCanonicalPromotionReviewRepository(
      createPgAflOutcomeSqlClient(pool)
    ),
    close: () => pool.end(),
  };
}

const defaultDependencies: CommandDependencies = {
  connect: connectPostgres,
  readJson: async (path) => JSON.parse(await readFile(path, 'utf8')) as unknown,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradeExternalCanonicalPromotionReviewCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: CommandDependencies = defaultDependencies
): Promise<PersistedAflTradeExternalCanonicalPromotionReview> {
  const parsed = commandSchema.safeParse(input.argv);
  if (!parsed.success) {
    throw new TypeError(
      'The command requires --candidate <ID> --draft-events <JSON path> --transaction-dates <JSON path> --decision <approved|rejected|withdrawn> --rationale <text> --authority-evidence <ID> --reviewer <principal> --decided-at <UTC millisecond instant>.'
    );
  }
  const draftEvents = await dependencies.readJson(parsed.data.draftEventsPath);
  const transactionDates = await dependencies.readJson(parsed.data.transactionDatesPath);
  const connection = await dependencies.connect(databaseUrl(input.env));
  try {
    const result = await recordAflTradeExternalCanonicalPromotionReview(
      {
        candidateId: parsed.data.candidateId,
        proposedAt: parsed.data.decidedAt,
        draftEvents,
        transactionDates,
        decision: parsed.data.decision,
        rationale: parsed.data.rationale,
        authorityEvidenceId: parsed.data.authorityEvidenceId,
        decidedBy: parsed.data.decidedBy,
        decidedAt: parsed.data.decidedAt,
      },
      connection.repository
    );
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeExternalCanonicalPromotionReviewCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'External canonical promotion review failed; no promotion, release, or publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
