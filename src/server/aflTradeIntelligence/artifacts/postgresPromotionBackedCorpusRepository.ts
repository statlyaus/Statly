import { z } from 'zod';

import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import { canonicalizeAflTradeJson } from './contentAddress';
import {
  buildAflTradePromotionBackedCorpus,
  type AflTradeCanonicalPromotionSnapshot,
} from './promotionBackedCorpusBuilder';
import {
  parseAflTradePromotionBackedCorpus,
  type AflTradePromotionBackedCorpus,
} from './promotionBackedCorpusContracts';

const exactUtcInstantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(z.iso.datetime({ offset: true }));
const buildRequestSchema = z
  .object({
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.string().trim().min(1).max(40),
    knowledgeCutoffAt: exactUtcInstantSchema,
    createdAt: exactUtcInstantSchema,
  })
  .strict();

type BuildRequest = z.infer<typeof buildRequestSchema>;

export interface PersistedAflTradePromotionBackedCorpus {
  readonly corpusId: string;
  readonly status: 'finalized';
  readonly idempotentReplay: boolean;
  readonly promotionCount: number;
  readonly memberCount: number;
  readonly memberSetSha256: string;
}

export class AflTradePromotionBackedCorpusPersistenceError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'NO_PROMOTIONS' | 'PROMOTION_INCOMPLETE' | 'CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradePromotionBackedCorpusPersistenceError';
  }
}

interface PromotionRow extends Record<string, unknown> {
  promotion_id: string;
  receipt_sha256: string;
  environment: BuildRequest['environment'];
  competition: string;
  anchor_season_year: number | string;
  status: string;
  finalized_at: Date | string | null;
  promotion_record_count: number | string;
}

interface PromotionRecordRow extends Record<string, unknown> {
  promotion_id: string;
  ordinal: number | string;
  record_kind: AflTradeCanonicalPromotionSnapshot['records'][number]['recordKind'];
  source_record_id: string;
  canonical_record_id: string;
  record_sha256: string;
}

interface CorpusReplayRow extends Record<string, unknown> {
  status: string;
  corpus_json: unknown;
}

function exactUtcInstant(value: Date | string): string {
  const instant = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant)) {
    throw new TypeError('Expected an exact UTC millisecond instant.');
  }
  return instant;
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

function resultFromCorpus(
  corpus: AflTradePromotionBackedCorpus,
  idempotentReplay: boolean
): PersistedAflTradePromotionBackedCorpus {
  return {
    corpusId: corpus.corpusId,
    status: 'finalized',
    idempotentReplay,
    promotionCount: corpus.content.promotionCount,
    memberCount: corpus.content.memberCount,
    memberSetSha256: corpus.content.memberSetSha256,
  };
}

async function loadCompletePromotions(
  transaction: AflOutcomeSqlTransaction,
  request: BuildRequest
): Promise<AflTradeCanonicalPromotionSnapshot[]> {
  const promotionResult = await transaction.query<PromotionRow>(
    `SELECT promotion.promotion_id,promotion.receipt_sha256,promotion.environment,
            promotion.competition,promotion.anchor_season_year,promotion.status,
            promotion.finalized_at,promotion.promotion_record_count
       FROM outcome_external_canonical_promotion promotion
      WHERE promotion.environment=$1::"OutcomeEnvironment"
        AND promotion.competition=$2
        AND promotion.status='finalized'
        AND promotion.finalized_at IS NOT NULL
        AND promotion.finalized_at <= $3
      ORDER BY promotion.promotion_id
      FOR SHARE OF promotion`,
    [request.environment, request.competition, request.knowledgeCutoffAt]
  );
  if (promotionResult.rows.length === 0) {
    throw new AflTradePromotionBackedCorpusPersistenceError(
      'NO_PROMOTIONS',
      'No finalized canonical promotions exist in the requested scope at the knowledge cutoff.'
    );
  }

  const promotionIds = promotionResult.rows.map(({ promotion_id }) => promotion_id);
  const recordResult = await transaction.query<PromotionRecordRow>(
    `SELECT record.promotion_id,record.ordinal,record.record_kind,record.source_record_id,
            record.canonical_record_id,record.record_sha256
       FROM outcome_external_canonical_promotion_record record
      WHERE record.promotion_id = ANY($1::text[])
      ORDER BY record.promotion_id,record.ordinal
      FOR SHARE OF record`,
    [promotionIds]
  );
  const recordsByPromotion = new Map<string, PromotionRecordRow[]>();
  recordResult.rows.forEach((row) => {
    const records = recordsByPromotion.get(row.promotion_id) ?? [];
    records.push(row);
    recordsByPromotion.set(row.promotion_id, records);
  });

  return promotionResult.rows.map((row) => {
    const records = recordsByPromotion.get(row.promotion_id) ?? [];
    const expectedCount = Number(row.promotion_record_count);
    if (
      row.status !== 'finalized' ||
      row.finalized_at === null ||
      !Number.isSafeInteger(expectedCount) ||
      expectedCount <= 0 ||
      records.length !== expectedCount ||
      records.some(({ ordinal }, index) => Number(ordinal) !== index + 1)
    ) {
      throw new AflTradePromotionBackedCorpusPersistenceError(
        'PROMOTION_INCOMPLETE',
        `Canonical promotion ${row.promotion_id} does not have its exact finalized record set.`
      );
    }
    return {
      promotionId: row.promotion_id,
      receiptSha256: row.receipt_sha256,
      environment: row.environment,
      competition: row.competition,
      anchorSeasonYear: Number(row.anchor_season_year),
      status: 'finalized' as const,
      finalizedAt: exactUtcInstant(row.finalized_at),
      promotionRecordCount: expectedCount,
      records: records.map((record) => ({
        recordKind: record.record_kind,
        sourceRecordId: record.source_record_id,
        canonicalRecordId: record.canonical_record_id,
        recordSha256: record.record_sha256,
      })),
    };
  });
}

async function persistCorpus(
  transaction: AflOutcomeSqlTransaction,
  corpus: AflTradePromotionBackedCorpus
): Promise<void> {
  const corpusCanonical = canonicalizeAflTradeJson(corpus.content);
  const corpusJson = canonicalizeAflTradeJson(corpus);
  const memberSetCanonical = canonicalizeAflTradeJson(
    corpus.content.members.map(
      ({ promotionId, recordKind, sourceRecordId, canonicalRecordId, recordSha256 }) => ({
        promotionId,
        recordKind,
        sourceRecordId,
        canonicalRecordId,
        recordSha256,
      })
    )
  );
  const corpusSha256 = corpus.corpusId.slice('corpus:'.length);
  await transaction.query(
    `INSERT INTO outcome_promotion_backed_corpus
      (corpus_id,environment,competition,anchor_season_from,anchor_season_through,created_at,
       knowledge_cutoff_at,promotion_count,member_count,member_set_sha256,record_counts_json,
       corpus_sha256,corpus_canonical_json,member_set_canonical_json,corpus_json,status,finalized_at)
     VALUES ($1,$2::"OutcomeEnvironment",$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,
             $15::jsonb,'open',NULL)`,
    [
      corpus.corpusId,
      corpus.content.environment,
      corpus.content.competition,
      corpus.content.anchorSeasonRange.from,
      corpus.content.anchorSeasonRange.through,
      corpus.content.createdAt,
      corpus.content.knowledgeCutoffAt,
      corpus.content.promotionCount,
      corpus.content.memberCount,
      corpus.content.memberSetSha256,
      canonicalizeAflTradeJson(corpus.content.recordCounts),
      corpusSha256,
      corpusCanonical,
      memberSetCanonical,
      corpusJson,
    ]
  );

  for (const [index, promotion] of corpus.content.promotions.entries()) {
    await transaction.query(
      `INSERT INTO outcome_promotion_backed_corpus_promotion
        (corpus_id,ordinal,promotion_id,promotion_sha256,anchor_season_year,finalized_at,
         promotion_record_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        corpus.corpusId,
        index + 1,
        promotion.promotionId,
        promotion.promotionSha256,
        promotion.anchorSeasonYear,
        promotion.finalizedAt,
        promotion.promotionRecordCount,
      ]
    );
  }
  for (const member of corpus.content.members) {
    await transaction.query(
      `INSERT INTO outcome_promotion_backed_corpus_member
        (corpus_id,ordinal,promotion_id,record_kind,source_record_id,canonical_record_id,
         record_sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        corpus.corpusId,
        member.ordinal,
        member.promotionId,
        member.recordKind,
        member.sourceRecordId,
        member.canonicalRecordId,
        member.recordSha256,
      ]
    );
  }
  const finalized = await transaction.query(
    `UPDATE outcome_promotion_backed_corpus SET status='finalized',finalized_at=created_at
      WHERE corpus_id=$1 AND status='open' AND finalized_at IS NULL`,
    [corpus.corpusId]
  );
  if (finalized.rowCount !== 1) {
    throw new AflTradePromotionBackedCorpusPersistenceError(
      'CONFLICT',
      'Canonical corpus could not be finalized exactly once.'
    );
  }
}

export class PostgresAflTradePromotionBackedCorpusRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async build(unparsedRequest: unknown): Promise<PersistedAflTradePromotionBackedCorpus> {
    let request: BuildRequest;
    try {
      request = buildRequestSchema.parse(unparsedRequest);
    } catch (error) {
      throw new AflTradePromotionBackedCorpusPersistenceError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Canonical corpus request is invalid.'
      );
    }

    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-promotion-corpus-scope:${request.environment}:${request.competition}`,
      ]);
      const promotions = await loadCompletePromotions(transaction, request);
      let corpus: AflTradePromotionBackedCorpus;
      try {
        corpus = buildAflTradePromotionBackedCorpus({ ...request, promotions });
      } catch (error) {
        if (error instanceof AflTradePromotionBackedCorpusPersistenceError) throw error;
        throw new AflTradePromotionBackedCorpusPersistenceError(
          'PROMOTION_INCOMPLETE',
          error instanceof Error ? error.message : 'Canonical promotion set is invalid.'
        );
      }

      const replay = await transaction.query<CorpusReplayRow>(
        `SELECT status,corpus_json
           FROM outcome_promotion_backed_corpus
          WHERE corpus_id=$1
          FOR SHARE`,
        [corpus.corpusId]
      );
      if (replay.rows.length > 0) {
        const row = replay.rows[0];
        if (
          replay.rows.length !== 1 ||
          row?.status !== 'finalized' ||
          !exactJson(row.corpus_json, corpus)
        ) {
          throw new AflTradePromotionBackedCorpusPersistenceError(
            'CONFLICT',
            'Canonical corpus identity already has different or incomplete persisted content.'
          );
        }
        try {
          return resultFromCorpus(parseAflTradePromotionBackedCorpus(row.corpus_json), true);
        } catch (error) {
          throw new AflTradePromotionBackedCorpusPersistenceError(
            'CONFLICT',
            error instanceof Error ? error.message : 'Persisted canonical corpus is invalid.'
          );
        }
      }

      await persistCorpus(transaction, corpus);
      return resultFromCorpus(corpus, false);
    });
  }
}
