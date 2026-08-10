import { describe, expect, it } from 'vitest';

import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  AflTradePromotionBackedCorpusPersistenceError,
  PostgresAflTradePromotionBackedCorpusRepository,
} from '@/server/aflTradeIntelligence/artifacts/postgresPromotionBackedCorpusRepository';

const sha = (value: string) => value.repeat(64);
const promotionId = `external-canonical-promotion:${sha('a')}`;

class CorpusSql implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  promotionRows = [
    {
      promotion_id: promotionId,
      receipt_sha256: sha('a'),
      environment: 'test_fixture',
      competition: 'AFLM',
      anchor_season_year: 2025,
      status: 'finalized',
      finalized_at: '2026-08-10T00:00:01.000Z',
      promotion_record_count: 2,
    },
  ];
  recordRows = [
    {
      promotion_id: promotionId,
      ordinal: 1,
      record_kind: 'transaction',
      source_record_id: 'trade:2025:100',
      canonical_record_id: `event-version:${sha('1')}`,
      record_sha256: sha('1'),
    },
    {
      promotion_id: promotionId,
      ordinal: 2,
      record_kind: 'draft_selection',
      source_record_id: 'selection:2025:national:14',
      canonical_record_id: `draft-selection:${sha('2')}`,
      record_sha256: sha('2'),
    },
  ];
  stored: unknown = null;
  writes: string[] = [];
  corpusInsertParams: readonly unknown[] | null = null;

  async transaction<T>(callback: (transaction: AflOutcomeSqlTransaction) => Promise<T>) {
    return callback(this);
  }

  async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
    const result = (rows: T[], rowCount = rows.length) => ({ rows, rowCount });
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();
    if (sql.includes('FROM outcome_external_canonical_promotion promotion')) {
      return result(this.promotionRows as T[]);
    }
    if (sql.includes('FROM outcome_external_canonical_promotion_record record')) {
      return result(this.recordRows as T[]);
    }
    if (sql.includes('FROM outcome_promotion_backed_corpus') && sql.includes('corpus_id=$1')) {
      return result((this.stored ? [{ status: 'finalized', corpus_json: this.stored }] : []) as T[]);
    }
    if (normalizedSql.startsWith('INSERT INTO outcome_promotion_backed_corpus (')) {
      this.writes.push('corpus');
      this.corpusInsertParams = params;
      this.stored = JSON.parse(String(params[14]));
      return result([] as T[], 1);
    }
    if (sql.includes('INSERT INTO outcome_promotion_backed_corpus_promotion')) {
      this.writes.push('promotion');
      return result([] as T[], 1);
    }
    if (sql.includes('INSERT INTO outcome_promotion_backed_corpus_member')) {
      this.writes.push('member');
      return result([] as T[], 1);
    }
    if (sql.includes("UPDATE outcome_promotion_backed_corpus SET status='finalized'")) {
      this.writes.push('finalize');
      return result([] as T[], 1);
    }
    return result([] as T[]);
  }
}

const request = {
  environment: 'test_fixture' as const,
  competition: 'AFLM',
  knowledgeCutoffAt: '2026-08-10T00:00:02.000Z',
  createdAt: '2026-08-10T00:00:03.000Z',
};

describe('PostgresAflTradePromotionBackedCorpusRepository', () => {
  it('selects the complete promotion set and atomically finalizes its exact members', async () => {
    const sql = new CorpusSql();
    const repository = new PostgresAflTradePromotionBackedCorpusRepository(sql);

    const result = await repository.build(request);

    expect(result).toMatchObject({
      status: 'finalized',
      idempotentReplay: false,
      promotionCount: 1,
      memberCount: 2,
    });
    expect(result.corpusId).toMatch(/^corpus:[a-f0-9]{64}$/);
    expect(sql.writes).toEqual(['corpus', 'promotion', 'member', 'member', 'finalize']);
    const corpusJson = JSON.parse(String(sql.corpusInsertParams?.[14]));
    expect(JSON.parse(String(sql.corpusInsertParams?.[12]))).toEqual(corpusJson.content);
  });

  it('returns an exact finalized replay without writing again', async () => {
    const sql = new CorpusSql();
    const repository = new PostgresAflTradePromotionBackedCorpusRepository(sql);
    const first = await repository.build(request);
    sql.writes = [];

    await expect(repository.build(request)).resolves.toEqual({
      ...first,
      idempotentReplay: true,
    });
    expect(sql.writes).toEqual([]);
  });

  it('fails closed when promotion records are not completely loaded', async () => {
    const sql = new CorpusSql();
    sql.recordRows = sql.recordRows.slice(0, 1);
    const repository = new PostgresAflTradePromotionBackedCorpusRepository(sql);

    await expect(repository.build(request)).rejects.toMatchObject({
      code: 'PROMOTION_INCOMPLETE',
    } satisfies Partial<AflTradePromotionBackedCorpusPersistenceError>);
    expect(sql.writes).toEqual([]);
  });

  it('rejects non-UTC or imprecise command chronology before opening a transaction', async () => {
    const sql = new CorpusSql();
    const repository = new PostgresAflTradePromotionBackedCorpusRepository(sql);

    await expect(
      repository.build({ ...request, createdAt: '2026-08-10T10:00:03+10:00' })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(sql.writes).toEqual([]);
  });
});
