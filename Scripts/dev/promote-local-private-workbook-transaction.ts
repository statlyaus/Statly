import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';
import { z } from 'zod';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePrivateWorkbookTransactionPromotionRepository } from '../../src/server/aflTradeIntelligence/source/postgresPrivateWorkbookTransactionPromotionRepository';
import { PostgresAflTradeWorkbookTransactionReviewRepository } from '../../src/server/aflTradeIntelligence/source/postgresWorkbookTransactionReviewRepository';

const interpretationSchema = z
  .object({
    reviewSetId: z.string().regex(/^workbook-transaction-review-set:[a-f0-9]{64}$/),
    reviewSubjectId: z.string().regex(/^workbook-transaction-review-subject:[a-f0-9]{64}$/),
    workbookTradeId: z.string().trim().min(1).max(240),
    occurredOn: z.iso.date(),
    occurrencePrecision: z.enum(['date', 'year']),
    parties: z.array(
      z
        .object({
          stagingRowId: z.string().trim().min(1).max(512),
          canonicalClubId: z.string().trim().min(1).max(240),
          assets: z.array(
            z
              .object({
                assetId: z.string().trim().min(1).max(512),
                sourceAssetText: z.string().trim().min(1).max(4_000),
                assetKind: z.enum(['player', 'pick', 'future_pick']),
                sendingClubId: z.string().trim().min(1).max(240),
                receivingClubId: z.string().trim().min(1).max(240),
                canonicalPlayerId: z.string().trim().min(1).max(512).nullable(),
                selection: z
                  .object({
                    seasonYear: z.number().int().min(1897).max(2200),
                    round: z.number().int().positive().nullable(),
                    number: z.number().int().positive().nullable(),
                    originalClubId: z.string().trim().min(1).max(240).nullable(),
                  })
                  .strict()
                  .nullable(),
              })
              .strict()
          ),
        })
        .strict()
    ),
    reviewerId: z.string().trim().min(1).max(240),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required.`);
  return value;
}

function assertDisposableDatabase(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !new Set(['127.0.0.1', 'localhost', '::1']).has(parsed.hostname) ||
    parsed.pathname !== '/statly_outcomes_test'
  ) {
    throw new TypeError('Private workbook transaction promotion requires loopback statly_outcomes_test.');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new TypeError('Private workbook transaction promotion is disabled in production.');
  }
}

async function main(): Promise<void> {
  const [flag, path] = process.argv.slice(2);
  if (flag !== '--interpretation-file' || !path || process.argv.length !== 4) {
    throw new TypeError('Use --interpretation-file <reviewed-json-path>.');
  }
  const interpretation = interpretationSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
  const root = resolve(import.meta.dirname, '../..');
  const databaseUrl = required('AFL_OUTCOMES_DATABASE_URL');
  assertDisposableDatabase(databaseUrl);
  const runtimeNonce = (
    process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE ??
    (await readFile(resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce'), 'utf8'))
  ).trim();
  const pool = new Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 120_000 });
  try {
    await assertLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce);
    const sql = createPgAflOutcomeSqlClient(pool);
    const reviewRepository = new PostgresAflTradeWorkbookTransactionReviewRepository(sql);
    const reviewSet = await reviewRepository.loadReviewSet(interpretation.reviewSetId);
    if (!reviewSet) throw new TypeError('The exact durable workbook review set is unavailable.');
    const decision = await reviewRepository.recordDecisionV2({
      reviewSetId: reviewSet.reviewSetId,
      reviewSubjectId: interpretation.reviewSubjectId,
      expectedCurrentDecisionId: null,
      workbookTradeId: interpretation.workbookTradeId,
      occurredOn: interpretation.occurredOn,
      occurrencePrecision: interpretation.occurrencePrecision,
      parties: interpretation.parties,
      reviewerId: interpretation.reviewerId,
      rationale: interpretation.rationale,
    });
    const receipt = await new PostgresAflTradePrivateWorkbookTransactionPromotionRepository(
      sql
    ).promote({ reviewSet, decision });
    process.stdout.write(
      `${JSON.stringify({ mode: 'private_local_only', productionAuthority: 'none', receipt })}\n`
    );
  } finally {
    await pool.end();
  }
}

if (process.env.STATLY_RUN_PRIVATE_WORKBOOK_TRANSACTION_PROMOTION === '1') {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown private promotion failure.';
    process.stderr.write(
      `Private workbook transaction promotion failed closed: ${message}\nNo calculation or publication was authorized.\n`
    );
    process.exitCode = 1;
  });
}
