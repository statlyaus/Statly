import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeContentAddress as address,
  canonicalizeAflTradeJson as canonical,
  sha256AflTradeCanonicalJson as sha,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeRetainedExternalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { PostgresAflTradeExternalIdentityReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import {
  loadAflTradeExternalIdentityReviewQueue,
  recordAflTradeExternalIdentityReviewDecision,
} from '@/server/aflTradeIntelligence/source/externalIdentityReviewService';
import { prepareAflTradeHistoricalReconciliation } from '@/server/aflTradeIntelligence/source/externalHistoricalReconciliationPreparation';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';
import { createRetainedExternalCaptureFixture } from '../testUtils/retainedExternalCaptureFixture';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

/**
 * Migration 0272 (issue 853): finalization conserves the board rows a candidate's Footyinfo board
 * picks cite. Before it, the finalize trigger compared the source rows only with the rows cited by
 * transactions, transfers, selections, custody, lineage, issues and the deferred set, so every
 * board row looked uncited and the whole candidate was refused. A real completion holding a
 * Draftguru year page and a Footyinfo board, prepared through the real repository, so the trigger
 * is the one under test.
 */
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const MIGRATION = '0272_board_pick_evidence_conservation';
const schema = `board_pick_conservation_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const sql = createPgAflOutcomeSqlClient(pool);
let history: Awaited<ReturnType<typeof deployOutcomesHistoryBefore>>;
const databaseInstant = async () =>
  (
    await pool.query<{ at: string }>(
      `SELECT to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
    )
  ).rows[0]!.at;
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
}, 120000);
afterAll(async () => {
  await history?.cleanup();
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

it('conserves the board rows a candidate cites only on its board picks once 0272 is applied', async () => {
  const draft = await createRetainedExternalCaptureFixture(sql, false, 'test_fixture', 1);
  const board = await createRetainedExternalCaptureFixture(
    sql,
    false,
    'test_fixture',
    1,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    { footyinfoBoard: true }
  );
  const plannedAt = (
    await pool.query<{ at: string }>(
      `SELECT to_char(
         date_trunc('milliseconds',GREATEST(clock_timestamp(),max(finalized_at)))+interval '1 millisecond',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
       FROM outcome_external_evidence_batch WHERE batch_id=ANY($1::text[])`,
      [[draft.target.evidenceBatchId, board.target.evidenceBatchId]]
    )
  ).rows[0]!.at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const plan = createAflTradeRetainedExternalCapturePlan({
    environment: 'test_fixture',
    competition: 'AFLM',
    plannedAt,
    scopeEvidence: [...draft.scopeEvidence, ...board.scopeEvidence].sort((a, b) =>
      a.artifactId.localeCompare(b.artifactId)
    ),
    targets: [draft.target, board.target].sort((a, b) => a.captureId.localeCompare(b.captureId)),
  });
  await new PostgresAflTradeExternalDiscoveryRepository(sql).persistRetainedPlan(plan, {
    read: async (ref) => {
      for (const repo of [draft.raw, draft.metadata, board.raw, board.metadata]) {
        const value = await repo.loadExact(ref, 2097152);
        if (value) return value.bytes;
      }
      throw new Error('Missing retained fixture bytes');
    },
  });
  const completion = await new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
    sql
  ).completeRetainedPlan(plan.planId);
  expect(completion).toMatchObject({ targetCount: 2, sourceBatchCount: 2 });

  const source = new PostgresAflTradeExternalHistoricalReconciliationSource(sql);
  const reviewRepository = new PostgresAflTradeExternalIdentityReviewRepository(sql);
  const actor = 'synthetic-board-pick-reviewer';
  // One identity-reviewer grant per provider: a resolution needs an authority for its own provider.
  async function authority(provider: 'draftguru' | 'footyinfo') {
    const at = await databaseInstant();
    const document = {
      evidenceKind: 'reviewer_authority_evidence',
      environment: 'test_fixture',
      principalRef: actor,
      role: 'afl_trade_external_identity_reviewer',
      provider,
      capabilityId: 'external_identity_resolution',
      scopeKey: 'public-afl-draft-trade-outcomes',
      competition: 'AFLM',
      validFromSeason: 2024,
      validThroughSeason: 2024,
    };
    const referenceId = address('reviewer-authority-evidence', document),
      digest = sha(document),
      ref = createAflTradeCanonicalJsonArtifactRef(document, at);
    await draft.metadata.putIfAbsent(ref, new TextEncoder().encode(canonical(document)));
    const approval = address('governed-evidence-approval-decision', { referenceId });
    await sql.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO outcome_artifact_custody(artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json) VALUES($1,$2,$3,$4,$5,'capture_metadata','test_fixture',$6,$6,'{}')`,
        [ref.artifactId, ref.contentSha256, ref.storageUri, ref.mediaType, ref.byteLength, at]
      );
      await tx.query(
        `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at) VALUES($1,'governed_evidence_reference',$2,'approved','Synthetic scoped technical authority',$3::jsonb,$4,$5)`,
        [approval, referenceId, canonical({ referenceSha256: digest }), actor, at]
      );
      await tx.query(
        `INSERT INTO outcome_governed_evidence_reference(reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,approval_decision_id,created_at,evidence_canonical_json,evidence_json) VALUES($1,$2,'reviewer_authority_evidence',$3,'test_fixture','approved',$4,$5,$6::text,($6::text)::jsonb)`,
        [referenceId, digest, ref.artifactId, approval, at, canonical(document)]
      );
      await tx.query(
        `INSERT INTO outcome_operational_principal_authority(authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,valid_from_season,valid_through_season,valid_from,valid_through) VALUES($1,$2,'afl_trade_external_identity_reviewer','public-afl-draft-trade-outcomes',$3,'external_identity_resolution','AFLM',2024,2024,$4,NULL)`,
        [referenceId, actor, provider, at]
      );
    });
    return referenceId;
  }
  const authorities = {
    draftguru: await authority('draftguru'),
    footyinfo: await authority('footyinfo'),
  };
  const queue = await loadAflTradeExternalIdentityReviewQueue(
    { completionId: completion.completionId },
    { source, reviewRepository }
  );
  // The board's club and player are subjects of their own provider; both resolve to the same
  // canonical club and player as the year page's, by the name each provider writes.
  expect(queue.items.map(({ provider, entityKind }) => `${provider}:${entityKind}`).sort()).toEqual(
    ['draftguru:club', 'draftguru:player', 'footyinfo:club', 'footyinfo:player']
  );
  const identityReviewedAt = await databaseInstant();
  for (const item of queue.items) {
    const name = item.observedNames[0]!;
    const canonicalId = `synthetic-${item.entityKind}-${name.toLowerCase().replace(/ /g, '-')}`;
    await pool.query(
      item.entityKind === 'player'
        ? `INSERT INTO outcome_player(player_id,display_name,status) VALUES($1,$2,'approved') ON CONFLICT DO NOTHING`
        : `INSERT INTO outcome_club(club_id,current_name,status) VALUES($1,$2,'approved') ON CONFLICT DO NOTHING`,
      [canonicalId, name]
    );
    await recordAflTradeExternalIdentityReviewDecision(
      {
        completionId: completion.completionId,
        subjectId: item.subjectId,
        decision: 'approved',
        canonicalId,
        rationale: 'Synthetic exact native identity',
        authorityEvidenceId: authorities[item.provider as 'draftguru' | 'footyinfo'],
        decidedBy: actor,
        decidedAt: identityReviewedAt,
      },
      { source, reviewRepository }
    );
  }

  const candidateRepository = new PostgresAflTradeExternalReconciliationRepository(sql);
  const prepare = () =>
    prepareAflTradeHistoricalReconciliation(
      { completionId: completion.completionId },
      { source, identityReviewRepository: reviewRepository, candidateRepository }
    );
  // Before 0272 the three board rows are cited only on board picks, which the trigger never read.
  await expect(prepare()).rejects.toMatchObject({
    code: 'P0001',
    message: 'External reconciliation must conserve the exact source evidence set',
  });
  expect(
    (
      await pool.query(
        `SELECT count(*)::integer AS n FROM outcome_external_reconciliation_candidate`
      )
    ).rows[0]!.n
  ).toBe(0);

  await pool.query(history.migrationSql);

  const prepared = await prepare();
  expect(prepared).toMatchObject({ status: 'finalized', blockingIssueCount: 0 });
  const candidate = await new PostgresAflTradeExternalCanonicalPromotionReviewRepository(
    sql
  ).loadCandidate(prepared.candidateId);
  expect(candidate.content.draftBoardPicks?.map(({ status }) => status).sort()).toEqual([
    'passed',
    'removed',
    'selected',
  ]);
  // The board corroborates the year page's selection across the round difference (#898): the
  // year page writes no round, the board does, and the selection keeps the year page's.
  expect(candidate.content.draftSelections).toEqual([
    expect.objectContaining({
      selectionNumber: 1,
      status: 'corroborated',
      supportingProviders: ['draftguru', 'footyinfo'],
      roundNumber: null,
    }),
  ]);
  // Every source row of both batches is cited by the stored candidate, and only board picks cite
  // the passed and removed rows.
  const cited = new Set([
    ...candidate.content.draftSelections.flatMap(({ evidenceIds }) => evidenceIds),
    ...(candidate.content.draftBoardPicks ?? []).flatMap(({ evidenceIds }) => evidenceIds),
  ]);
  const sourceRows = await pool.query<{ evidence_id: string; claim_kind: string }>(
    `SELECT evidence_id, claim_kind FROM outcome_external_evidence_row WHERE batch_id=ANY($1::text[])`,
    [[draft.target.evidenceBatchId, board.target.evidenceBatchId]]
  );
  expect(sourceRows.rows).toHaveLength(5);
  expect(sourceRows.rows.filter(({ evidence_id }) => !cited.has(evidence_id))).toEqual([]);
  const onlyOnBoardPicks = (candidate.content.draftBoardPicks ?? [])
    .filter(({ status }) => status !== 'selected')
    .flatMap(({ evidenceIds }) => evidenceIds);
  expect(onlyOnBoardPicks).toHaveLength(2);
  for (const evidenceId of onlyOnBoardPicks) {
    expect(
      candidate.content.draftSelections.some(({ evidenceIds }) => evidenceIds.includes(evidenceId))
    ).toBe(false);
  }
});
