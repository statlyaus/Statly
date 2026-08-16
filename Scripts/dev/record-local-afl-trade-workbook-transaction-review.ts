import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  PostgresAflTradeWorkbookTransactionReviewRepository,
  type RecordAflTradeWorkbookTransactionReviewDecisionInput,
} from '../../src/server/aflTradeIntelligence/source/postgresWorkbookTransactionReviewRepository';
import type { AflTradeWorkbookTransactionReviewDecision } from '../../src/server/aflTradeIntelligence/source/workbookTransactionReviewDecision';

interface CommandConnection {
  recordDecision(
    input: RecordAflTradeWorkbookTransactionReviewDecisionInput
  ): Promise<AflTradeWorkbookTransactionReviewDecision>;
  close(): Promise<void>;
}

interface CommandDependencies {
  connect(databaseUrl: string, runtimeNonce: string): Promise<CommandConnection>;
  loadRuntimeNonce(configuredNonce: string | undefined): Promise<string>;
  writeOutput(line: string): void;
}

const root = resolve(import.meta.dirname, '../..');
const reviewSetIdSchema = z.string().regex(/^workbook-transaction-review-set:[a-f0-9]{64}$/);
const subjectIdSchema = z.string().regex(/^workbook-transaction-review-subject:[a-f0-9]{64}$/);
const decisionIdSchema = z.string().regex(/^workbook-transaction-review-decision:[a-f0-9]{64}$/);

function parseFlags(argv: readonly string[]): Map<string, string> {
  if (argv.length === 0 || argv.length % 2 !== 0) {
    throw new TypeError('Every workbook review option requires one value.');
  }
  const allowed = new Set([
    '--review-set',
    '--subject',
    '--expected-current',
    '--decision',
    '--canonical-clubs',
    '--direction',
    '--reviewer',
    '--rationale',
  ]);
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]!;
    const value = argv[index + 1]!;
    if (!allowed.has(name) || flags.has(name) || !value.trim()) {
      throw new TypeError(`Invalid or duplicate workbook review option: ${name}.`);
    }
    flags.set(name, value.trim());
  }
  return flags;
}

function parseCommand(
  argv: readonly string[]
): RecordAflTradeWorkbookTransactionReviewDecisionInput {
  const flags = parseFlags(argv);
  const reviewSetId = reviewSetIdSchema.parse(flags.get('--review-set'));
  const reviewSubjectId = subjectIdSchema.parse(flags.get('--subject'));
  const expected = flags.get('--expected-current');
  const expectedCurrentDecisionId = expected === 'none' ? null : decisionIdSchema.parse(expected);
  const outcome = z.enum(['approved', 'rejected']).parse(flags.get('--decision'));
  const reviewerId = z.string().trim().min(1).max(240).parse(flags.get('--reviewer'));
  const rationale = z.string().trim().min(1).max(2_000).parse(flags.get('--rationale'));
  const canonicalClubs = flags.get('--canonical-clubs');
  const direction = flags.get('--direction');
  if (outcome === 'rejected') {
    if (canonicalClubs !== undefined || direction !== undefined) {
      throw new TypeError('Rejected reviews must not supply canonical clubs or direction.');
    }
    return {
      reviewSetId,
      reviewSubjectId,
      expectedCurrentDecisionId,
      outcome,
      reviewerId,
      rationale,
    };
  }
  if (direction !== 'listed-club-received-assets') {
    throw new TypeError('Approved reviews require --direction listed-club-received-assets.');
  }
  const canonicalClubIds = (canonicalClubs ?? '')
    .split(',')
    .map((clubId) => clubId.trim())
    .filter(Boolean);
  if (canonicalClubIds.length < 2 || new Set(canonicalClubIds).size !== canonicalClubIds.length) {
    throw new TypeError('Approved reviews require distinct --canonical-clubs in party order.');
  }
  return {
    reviewSetId,
    reviewSubjectId,
    expectedCurrentDecisionId,
    outcome,
    canonicalClubIds,
    transferDirection: 'listed_club_received_assets',
    reviewerId,
    rationale,
  };
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
    recordDecision: (input) => repository.recordDecision(input),
    close: () => pool.end(),
  };
}

const defaultDependencies: CommandDependencies = {
  connect: connectPostgres,
  loadRuntimeNonce,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runRecordLocalAflTradeWorkbookTransactionReviewCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: Partial<CommandDependencies> &
    Pick<CommandDependencies, 'connect' | 'writeOutput'> = defaultDependencies
): Promise<AflTradeWorkbookTransactionReviewDecision> {
  const command = parseCommand(input.argv);
  const url = databaseUrl(input.env);
  const loadNonce = dependencies.loadRuntimeNonce ?? defaultDependencies.loadRuntimeNonce;
  const runtimeNonce = await loadNonce(input.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE);
  const connection = await dependencies.connect(url, runtimeNonce);
  try {
    const decision = await connection.recordDecision(command);
    dependencies.writeOutput(
      JSON.stringify({
        mode: 'private_local_workbook_transaction_review_decision',
        productionAuthority: 'none',
        publicationAuthority: 'none',
        reviewSetId: decision.content.reviewSetId,
        reviewSubjectId: decision.content.reviewSubjectId,
        decisionId: decision.decisionId,
        outcome: decision.content.outcome,
        revision: decision.content.revision,
        decidedAt: decision.content.decidedAt,
      })
    );
    return decision;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runRecordLocalAflTradeWorkbookTransactionReviewCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'Local workbook transaction review decision failed; no approval, release, publication, or activation was assumed.\n'
    );
    process.exitCode = 1;
  });
}
