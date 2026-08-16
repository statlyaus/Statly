import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeWorkbookTransactionReviewRepository } from '../../src/server/aflTradeIntelligence/source/postgresWorkbookTransactionReviewRepository';
import type { AflTradeWorkbookTransactionReviewDecision } from '../../src/server/aflTradeIntelligence/source/workbookTransactionReviewDecision';
import type { AflTradeWorkbookTransactionReviewAssessment } from '../../src/server/aflTradeIntelligence/source/workbookTransactionReviewDecision';
import type { AflTradeWorkbookTransactionReviewSet } from '../../src/server/aflTradeIntelligence/source/workbookTransactionReviewSet';

interface CommandConnection {
  loadReviewSet(reviewSetId: string): Promise<AflTradeWorkbookTransactionReviewSet | null>;
  loadCurrentDecisions(
    reviewSetId: string
  ): Promise<readonly AflTradeWorkbookTransactionReviewDecision[]>;
  assess(reviewSetId: string): Promise<AflTradeWorkbookTransactionReviewAssessment | null>;
  close(): Promise<void>;
}

interface CommandDependencies {
  connect(databaseUrl: string, runtimeNonce: string): Promise<CommandConnection>;
  loadRuntimeNonce(configuredNonce: string | undefined): Promise<string>;
  writeOutput(line: string): void;
}

const commandSchema = z
  .tuple([
    z.literal('--review-set'),
    z.string().regex(/^workbook-transaction-review-set:[a-f0-9]{64}$/),
  ])
  .transform(([, reviewSetId]) => ({ reviewSetId }));
const root = resolve(import.meta.dirname, '../..');

function parseCommand(argv: readonly string[]) {
  const parsed = commandSchema.safeParse(argv);
  if (!parsed.success) {
    throw new TypeError(
      'The command requires --review-set <workbook transaction review set content address>.'
    );
  }
  return parsed.data;
}

function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  const parsed = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !new Set(['127.0.0.1', 'localhost', '::1']).has(parsed.hostname) ||
    parsed.pathname !== '/statly_outcomes_test'
  ) {
    throw new TypeError('The workbook review requires loopback statly_outcomes_test.');
  }
  return value;
}

async function loadRuntimeNonce(configuredNonce: string | undefined): Promise<string> {
  const nonce = (
    configuredNonce ??
    (await readFile(resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce'), 'utf8'))
  ).trim();
  if (!/^[a-f0-9]{64}$/.test(nonce)) {
    throw new TypeError('STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE is invalid.');
  }
  return nonce;
}

async function connectPostgres(url: string, runtimeNonce: string): Promise<CommandConnection> {
  const pool = new Pool({ connectionString: url, max: 1, statement_timeout: 120_000 });
  try {
    await assertLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce);
  } catch (error) {
    await pool.end();
    throw error;
  }
  const repository = new PostgresAflTradeWorkbookTransactionReviewRepository(
    createPgAflOutcomeSqlClient(pool)
  );
  return {
    loadReviewSet: (reviewSetId) => repository.loadReviewSet(reviewSetId),
    loadCurrentDecisions: (reviewSetId) => repository.loadCurrentDecisions(reviewSetId),
    assess: (reviewSetId) => repository.assess(reviewSetId),
    close: () => pool.end(),
  };
}

const defaultDependencies: CommandDependencies = {
  connect: connectPostgres,
  loadRuntimeNonce,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runInspectLocalAflTradeWorkbookTransactionReviewCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: Partial<CommandDependencies> &
    Pick<CommandDependencies, 'connect' | 'writeOutput'> = defaultDependencies
) {
  const command = parseCommand(input.argv);
  const url = databaseUrl(input.env);
  const loadNonce = dependencies.loadRuntimeNonce ?? defaultDependencies.loadRuntimeNonce;
  const runtimeNonce = await loadNonce(input.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE);
  const connection = await dependencies.connect(url, runtimeNonce);
  try {
    const reviewSet = await connection.loadReviewSet(command.reviewSetId);
    if (!reviewSet)
      throw new TypeError('The exact workbook transaction review set is unavailable.');
    const currentDecisions = await connection.loadCurrentDecisions(command.reviewSetId);
    const assessment = await connection.assess(command.reviewSetId);
    if (!assessment) {
      throw new TypeError('The exact workbook transaction review assessment is unavailable.');
    }
    const decisionsBySubject = new Map(
      currentDecisions.map((decision) => [decision.content.reviewSubjectId, decision])
    );
    const result = {
      mode: 'private_local_workbook_transaction_review_inspection',
      productionAuthority: 'none',
      publicationAuthority: 'none',
      assessment,
      subjects: reviewSet.content.transactions.map((subject) => {
        const decision = decisionsBySubject.get(subject.reviewSubjectId);
        return {
          reviewSubjectId: subject.reviewSubjectId,
          seasonYear: subject.seasonYear,
          sourceTitle: subject.sourceTitle,
          parties: subject.parties.map(({ clubLabel, assetText }) => ({ clubLabel, assetText })),
          currentDecision: decision
            ? {
                decisionId: decision.decisionId,
                outcome: decision.content.outcome,
                revision: decision.content.revision,
                canonicalClubIds: decision.content.canonicalClubIds,
                transferDirection: decision.content.transferDirection,
                reviewerId: decision.content.reviewerId,
                rationale: decision.content.rationale,
                decidedAt: decision.content.decidedAt,
              }
            : null,
        };
      }),
    };
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runInspectLocalAflTradeWorkbookTransactionReviewCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'Local workbook transaction review inspection failed; no approval, release, publication, or activation was assumed.\n'
    );
    process.exitCode = 1;
  });
}
