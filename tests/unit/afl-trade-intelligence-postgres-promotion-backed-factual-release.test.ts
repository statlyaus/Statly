import { describe, expect, it } from 'vitest';

import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeExternalCaptureExecutionReceipt } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { createAflTradePromotionBackedCorpus } from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusContracts';
import {
  AflTradePromotionBackedFactualReleasePersistenceError,
  PostgresAflTradePromotionBackedFactualReleaseRepository,
} from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedFactualReleaseRepository';

const sha = (value: string) => value.repeat(64);
const promotionId = `external-canonical-promotion:${sha('a')}`;
const transactionId = `event-version:${sha('1')}`;
const selectionId = `draft-selection:${sha('2')}`;

const corpus = createAflTradePromotionBackedCorpus({
  environment: 'test_fixture',
  competition: 'AFLM',
  createdAt: '2026-08-10T00:00:04.000Z',
  knowledgeCutoffAt: '2026-08-10T00:00:03.000Z',
  promotions: [
    {
      promotionId,
      promotionSha256: sha('a'),
      anchorSeasonYear: 2025,
      finalizedAt: '2026-08-10T00:00:02.000Z',
      promotionRecordCount: 2,
    },
  ],
  members: [
    {
      promotionId,
      recordKind: 'transaction',
      sourceRecordId: 'trade:2025:1',
      canonicalRecordId: transactionId,
      recordSha256: sha('3'),
    },
    {
      promotionId,
      recordKind: 'draft_selection',
      sourceRecordId: 'selection:2025:national:14',
      canonicalRecordId: selectionId,
      recordSha256: sha('4'),
    },
  ],
});

function executionReceipt(suffix: string) {
  return createAflTradeExternalCaptureExecutionReceipt({
    schemaVersion: 'afl-trade-external-capture-execution/v1',
    rightsArtifactId: `source-rights:${sha(suffix)}`,
    gateDecisionId: `gate-decision:${sha(suffix)}`,
    gateDecisionKey: `fixture:${suffix}`,
    ledgerRevision: 1,
    evaluatedAt: '2026-08-10T00:00:00.000Z',
    provider: 'draftguru',
    capabilityId: 'draftguru-trade-detail',
    parserVersion: 'draftguru/v1',
    fieldManifestSha256: sha('f'),
    upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
    cacheSeconds: 86_400,
    rawRetentionDays: 365,
    egressPolicyEvidenceId: `artifact:${sha('e')}`,
  });
}

const captureRows = [
  {
    promotion_id: promotionId,
    capture_id: 'capture:trade-2025-1',
    source_snapshot_id: `source-snapshot:${sha('5')}`,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchor_season_year: 2025,
    captured_at: '2026-08-10T00:00:01.000Z',
    manifest_json: {
      sourceUrl: 'https://example.test/trades/1',
      executionReceipt: executionReceipt('6'),
    },
  },
  {
    promotion_id: promotionId,
    capture_id: 'capture:draft-2025',
    source_snapshot_id: `source-snapshot:${sha('7')}`,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchor_season_year: 2025,
    captured_at: '2026-08-10T00:00:02.000Z',
    manifest_json: {
      sourceUrl: 'https://example.test/years/2025',
      executionReceipt: executionReceipt('8'),
    },
  },
];

const canonicalRows = [
  {
    record_kind: 'draft_selection',
    canonical_record_id: selectionId,
    canonical_record_json: {
      selectionId,
      eventVersionId: `event-version:${sha('b')}`,
      selectionNumber: 14,
      pickId: 'pick:2025:national:14',
      playerId: 'player:harry-kyle',
      playerName: 'Harry Kyle',
      clubId: 'club:western-bulldogs',
      status: 'approved',
    },
  },
  {
    record_kind: 'transaction',
    canonical_record_id: transactionId,
    canonical_record_json: {
      eventVersionId: transactionId,
      eventId: `event:${sha('9')}`,
      competition: 'AFLM',
      seasonYear: 2025,
      kind: 'trade',
      eventDate: '2025-10-10',
      parties: [
        { ordinal: 1, clubId: 'club:gws', role: 'party' },
        { ordinal: 2, clubId: 'club:western-bulldogs', role: 'party' },
      ],
      status: 'approved',
    },
  },
];

class ReleaseSql implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  storedCandidate: unknown = null;
  storedRelease: unknown = null;
  writes: string[] = [];
  captures = structuredClone(captureRows);
  canonical = structuredClone(canonicalRows);

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>) {
    return work(this);
  }

  async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
    const result = (rows: T[], rowCount = rows.length) => ({ rows, rowCount });
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (sql.includes('FROM outcome_promotion_backed_corpus corpus')) {
      return result([{ status: 'finalized', corpus_json: corpus }] as T[]);
    }
    if (sql.includes('FROM outcome_promotion_backed_corpus_promotion corpus_promotion')) {
      return result(this.captures as T[]);
    }
    if (sql.includes('WITH requested_member')) return result(this.canonical as T[]);
    if (sql.includes('FROM outcome_factual_release_candidate') && sql.includes('candidate_id=$1')) {
      return result(
        (this.storedCandidate
          ? [
              {
                status: 'approved',
                finalized_at: '2026-08-10T00:00:05.000Z',
                candidate_json: this.storedCandidate,
              },
            ]
          : []) as T[]
      );
    }
    if (normalized.startsWith('INSERT INTO outcome_release_manifest')) {
      this.writes.push('release');
      this.storedRelease = JSON.parse(String(params[6]));
      return result([] as T[], 1);
    }
    if (normalized.startsWith('INSERT INTO outcome_factual_release_candidate')) {
      this.writes.push('candidate');
      this.storedCandidate = JSON.parse(String(params[19]));
      return result([] as T[], 1);
    }
    if (sql.includes('INSERT INTO outcome_release_source_capture')) {
      this.writes.push('source');
      return result([] as T[], 1);
    }
    if (sql.includes('INSERT INTO outcome_release_event_version')) {
      this.writes.push('event');
      return result([] as T[], 1);
    }
    if (sql.includes('INSERT INTO outcome_release_event_asset')) {
      this.writes.push('asset');
      return result([] as T[], 1);
    }
    if (sql.includes('INSERT INTO outcome_release_draft_selection')) {
      this.writes.push('selection');
      return result([] as T[], 1);
    }
    if (sql.includes('INSERT INTO outcome_release_pick_custody')) {
      this.writes.push('custody');
      return result([] as T[], 1);
    }
    if (sql.includes('INSERT INTO outcome_release_pick_realization')) {
      this.writes.push('realization');
      return result([] as T[], 1);
    }
    if (sql.includes("UPDATE outcome_factual_release_candidate SET status='approved'")) {
      this.writes.push('finalize');
      return result([] as T[], 1);
    }
    return result([] as T[]);
  }
}

const request = {
  corpusId: corpus.corpusId,
  scopeKey: 'afl-draft-trade-public-outcomes',
  createdAt: '2026-08-10T00:00:05.000Z',
};

describe('PostgresAflTradePromotionBackedFactualReleaseRepository', () => {
  it('derives and atomically finalizes the exact source and canonical release memberships', async () => {
    const sql = new ReleaseSql();
    const repository = new PostgresAflTradePromotionBackedFactualReleaseRepository(sql);

    const persisted = await repository.build(request);

    expect(persisted).toMatchObject({
      corpusId: corpus.corpusId,
      canonicalMemberCount: 2,
      idempotentReplay: false,
      status: 'finalized',
    });
    expect(persisted.releaseId).toMatch(/^outcome-release:[a-f0-9]{64}$/);
    expect(persisted.candidateId).toMatch(/^factual-release-candidate:[a-f0-9]{64}$/);
    expect(persisted.canonicalMemberSetSha256).not.toBe(corpus.content.memberSetSha256);
    expect(sql.writes).toEqual([
      'release',
      'candidate',
      'source',
      'source',
      'selection',
      'event',
      'finalize',
    ]);
  });

  it('returns an exact finalized replay without mutating membership', async () => {
    const sql = new ReleaseSql();
    const repository = new PostgresAflTradePromotionBackedFactualReleaseRepository(sql);
    const first = await repository.build(request);
    sql.writes = [];

    await expect(repository.build(request)).resolves.toEqual({ ...first, idempotentReplay: true });
    expect(sql.writes).toEqual([]);
  });

  it('rejects a source capture whose authenticated execution authority is malformed', async () => {
    const sql = new ReleaseSql();
    sql.captures[0]!.manifest_json = { executionReceipt: { forged: true } } as never;
    const repository = new PostgresAflTradePromotionBackedFactualReleaseRepository(sql);

    await expect(repository.build(request)).rejects.toMatchObject({
      code: 'SOURCE_AUTHORITY_MISMATCH',
    } satisfies Partial<AflTradePromotionBackedFactualReleasePersistenceError>);
    expect(sql.writes).toEqual([]);
  });

  it('rejects omitted or substituted canonical rows before any release write', async () => {
    const sql = new ReleaseSql();
    sql.canonical = sql.canonical.slice(0, 1);
    const repository = new PostgresAflTradePromotionBackedFactualReleaseRepository(sql);

    await expect(repository.build(request)).rejects.toMatchObject({
      code: 'CORPUS_INCOMPLETE',
    } satisfies Partial<AflTradePromotionBackedFactualReleasePersistenceError>);
    expect(sql.writes).toEqual([]);
  });

  it('rejects invalid chronology before opening durable work', async () => {
    const sql = new ReleaseSql();
    const repository = new PostgresAflTradePromotionBackedFactualReleaseRepository(sql);

    await expect(
      repository.build({ ...request, createdAt: '2026-08-10T10:00:05+10:00' })
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(sql.writes).toEqual([]);
  });

  it('uses canonical stored row bytes rather than source promotion digests', async () => {
    const originalSql = new ReleaseSql();
    const correctedSql = new ReleaseSql();
    const correctedSelection = correctedSql.canonical[0]!.canonical_record_json as {
      playerName: string;
    };
    correctedSelection.playerName = 'Harry O. Kyle';

    const original = await new PostgresAflTradePromotionBackedFactualReleaseRepository(
      originalSql
    ).build(request);
    const corrected = await new PostgresAflTradePromotionBackedFactualReleaseRepository(
      correctedSql
    ).build(request);

    expect(corrected.canonicalMemberSetSha256).not.toBe(original.canonicalMemberSetSha256);
    expect(corrected.releaseId).not.toBe(original.releaseId);
    expect(corrected.sourceMemberSetSha256).toBe(original.sourceMemberSetSha256);
  });
});
