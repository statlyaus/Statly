import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { createPostgresAflTradePromotionBackedPublicArchiveReadRepository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedPublicArchiveReadRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import type { AflTradePromotionBackedArchiveSelection } from '@/server/aflTradeIntelligence/outcomes/promotionBackedArchiveSelection';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { AFL_TRADE_PROMOTION_BACKED_PUBLIC_ARCHIVE_RECORD_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/outcomes/promotionBackedPublicArchiveContracts';

it('excludes realizations of corrected draft selections within the selected archive only', async () => {
  const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
  if (!url) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  const pool = new Pool({ connectionString: url });
  const connection = await pool.connect();
  const hash = 'a'.repeat(64);
  const selection = {
    schemaVersion: 'afl-trade-promotion-backed-archive-selection/v1',
    registryRevision: 1,
    scopeKey: 'public-afl-draft-trade-outcomes',
    environment: 'non_production',
    competition: 'AFLM',
    validFromSeason: 2025,
    validThroughSeason: 2025,
    releaseId: `outcome-release:${hash}`,
    projectionId: `outcome-projection:${hash}`,
    publicArchiveId: `public-factual-archive:${hash}`,
    factualCandidateId: `factual-release-candidate:${hash}`,
    corpusId: `corpus:${hash}`,
    lineageId: `corpus-factual-lineage:${hash}`,
    gate2AdmissionId: `corpus-factual-lineage-admission:${hash}`,
    gate2DecisionId: `gate-decision:${hash}`,
    sourceMemberSetSha256: hash,
    canonicalMemberSetSha256: hash,
    publicRecordSetSha256: hash,
    publicRecordCount: 4,
    effectiveThrough: '2025-12-31T00:00:00.000Z',
    publishedAt: '2026-01-01T00:00:00.000Z',
    capturedAt: '2026-01-01T00:01:00.000Z',
  } satisfies AflTradePromotionBackedArchiveSelection;
  const earlier = { ...selection, publicArchiveId: `public-factual-archive:${'b'.repeat(64)}` };
  const realization = {
    recordKind: 'pick_realization' as const,
    recordId: 'realization-1',
    realizationId: 'realization-1',
    pickId: 'pick-1',
    transferAssetVersionId: 'transfer-1',
    draftSelectionId: 'selection-1',
    relationKind: 'exercised_as' as const,
  };
  const envelope = {
    ordinal: 1,
    canonicalRecordSha256: hash,
    recordSha256: sha256AflTradeCanonicalJson({
      schemaVersion: AFL_TRADE_PROMOTION_BACKED_PUBLIC_ARCHIVE_RECORD_SCHEMA_VERSION,
      recordKind: realization.recordKind,
      canonicalRecordSha256: hash,
      record: realization,
    }),
    record: realization,
  };
  try {
    // Only record filtering is under test. Header authority is supplied as an already-selected fixture.
    // The record query runs unchanged in PostgreSQL against a connection-local disposable table.
    await connection.query(`CREATE TEMP TABLE outcome_public_factual_archive_record (
      archive_id text, ordinal integer, record_kind text, season_year integer,
      club_ids text[], player_ids text[], event_version_id text, pick_id text, record_json jsonb)`);
    for (const archive of [selection, earlier]) {
      await connection.query(
        `INSERT INTO outcome_public_factual_archive_record VALUES
        ($1,1,'pick_realization',2025,'{}','{}','unchanged-trade','pick-1',$2),
        ($1,2,'draft_selection',2025,'{}','{}','old-draft','pick-1',$3),
        ($1,3,'draft_event',2025,'{}','{}','old-draft',NULL,$4)`,
        [
          archive.publicArchiveId,
          envelope,
          { record: { selectionId: 'selection-1', eventVersionId: 'old-draft' } },
          { record: { eventVersionId: 'old-draft' } },
        ]
      );
    }
    await connection.query(
      `INSERT INTO outcome_public_factual_archive_record VALUES
      ($1,4,'draft_event',2025,'{}','{}','new-draft',NULL,$2)`,
      [
        selection.publicArchiveId,
        { record: { eventVersionId: 'new-draft', supersedesVersionId: 'old-draft' } },
      ]
    );
    const client = {
      async query(sql: string, params: readonly unknown[] = []) {
        if (sql.includes('FROM outcome_public_factual_archive archive'))
          return {
            rows: [
              {
                archive_id: params[0],
                release_id: selection.releaseId,
                candidate_id: selection.factualCandidateId,
                corpus_id: selection.corpusId,
                environment: selection.environment,
                scope_key: selection.scopeKey,
                competition: selection.competition,
                source_member_set_sha256: hash,
                canonical_member_set_sha256: hash,
                record_count: 4,
                record_set_sha256: hash,
                status: 'approved',
                finalized_at: selection.publishedAt,
              },
            ],
          };
        return connection.query(sql, [...params]);
      },
    } as unknown as AflOutcomeSqlClient;
    const reader = createPostgresAflTradePromotionBackedPublicArchiveReadRepository({
      client,
      pageSize: 1,
    });
    expect(await reader.listAllRecords(earlier, { recordKinds: ['pick_realization'] })).toEqual([
      realization,
    ]);
    expect(await reader.listAllRecords(selection, { recordKinds: ['pick_realization'] })).toEqual(
      []
    );
  } finally {
    await connection.query('DROP TABLE IF EXISTS pg_temp.outcome_public_factual_archive_record');
    connection.release();
    await pool.end();
  }
});
