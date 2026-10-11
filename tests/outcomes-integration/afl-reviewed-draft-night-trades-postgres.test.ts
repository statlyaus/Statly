import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradeRetainedExternalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { prepareAflTradeHistoricalReconciliation } from '@/server/aflTradeIntelligence/source/externalHistoricalReconciliationPreparation';
import {
  loadAflTradeExternalIdentityReviewQueue,
  recordAflTradeExternalIdentityReviewDecision,
} from '@/server/aflTradeIntelligence/source/externalIdentityReviewService';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { PostgresAflTradeExternalIdentityReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { createRetainedExternalCaptureFixture } from '../testUtils/retainedExternalCaptureFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

// Own schema: the fixture backdates its Gate decisions by ten seconds, so this file's ledger must
// start empty (see afl-retained-draft-order-capability-postgres.test.ts).
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `reviewed_draft_night_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 4 });
const sql = createPgAflOutcomeSqlClient(pool);
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
}, 120_000);
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

const instant = async () =>
  (
    await pool.query<{ at: string }>(
      `SELECT to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
    )
  ).rows[0]!.at;

// Reviewed draft-night pick trades (statlyaus/Statly#886). A trade-period Draftguru trade delivers
// pick 1 to the synthetic club; the pre-draft order shows the club holding it; the reviewed
// statement says the club traded it on on draft night. Staged through the governed capture
// boundary and reconciled, the draft-night transfer takes the order's pick, so the grader's
// traded-on link (same pick, given by the club the trade period delivered it to) closes.
it('stages a reviewed draft-night statement and links it to the trade-period pick through the order', async () => {
  const fixture = (
    options: Parameters<typeof createRetainedExternalCaptureFixture>[13],
    trade = false
  ) =>
    createRetainedExternalCaptureFixture(
      sql,
      false,
      'test_fixture',
      1,
      false,
      trade,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      options
    );
  const order = await fixture({ draftOrder: true });
  const trade = await fixture({}, true);
  const night = await fixture({ draftNightTrades: true });
  const members = [order, trade, night];

  const staged = await pool.query<{ claim_kind: string; provider: string }>(
    `SELECT row.claim_kind, batch.provider FROM outcome_external_evidence_row row
       JOIN outcome_external_evidence_batch batch ON batch.batch_id=row.batch_id
      WHERE batch.batch_id=$1 ORDER BY row.ordinal`,
    [night.target.evidenceBatchId]
  );
  expect(staged.rows).toEqual(
    [
      'transaction',
      'transaction_party',
      'transaction_party',
      'directed_transfer',
      'directed_transfer',
    ].map((claim_kind) => ({ claim_kind, provider: 'statly_reviewed' }))
  );

  // Migration 0270 admits the capability into a retained plan.
  const plannedAt = (
    await pool.query<{ at: string }>(
      `SELECT to_char(
         date_trunc('milliseconds',GREATEST(clock_timestamp(),max(finalized_at)))+interval '1 millisecond',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
       FROM outcome_external_evidence_batch WHERE batch_id=ANY($1::text[])`,
      [members.map((member) => member.target.evidenceBatchId)]
    )
  ).rows[0]!.at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const plan = createAflTradeRetainedExternalCapturePlan({
    environment: 'test_fixture',
    competition: 'AFLM',
    plannedAt,
    scopeEvidence: members
      .flatMap((member) => member.scopeEvidence)
      .sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    targets: members
      .map((member) => member.target)
      .sort((a, b) => a.captureId.localeCompare(b.captureId)),
  });
  const reader = {
    read: async (reference: Parameters<typeof order.raw.loadExact>[0]) => {
      for (const repository of members.flatMap((member) => [member.raw, member.metadata])) {
        const value = await repository.loadExact(reference, 2097152);
        if (value) return value.bytes;
      }
      throw new Error('Missing retained fixture bytes');
    },
  };
  await new PostgresAflTradeExternalDiscoveryRepository(sql).persistRetainedPlan(plan, reader);
  const completion = await new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
    sql
  ).completeRetainedPlan(plan.planId);
  expect(completion).toMatchObject({ targetCount: 3, sourceBatchCount: 3 });

  // Identity review is provider-scoped: one reviewer authority per provider, one club per name.
  const actor = 'synthetic-draft-night-reviewer';
  async function authority(provider: string) {
    const at = await instant();
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
      validThroughSeason: 2025,
    };
    const referenceId = createAflTradeContentAddress('reviewer-authority-evidence', document);
    const digest = sha256AflTradeCanonicalJson(document);
    const ref = createAflTradeCanonicalJsonArtifactRef(document, at);
    await order.metadata.putIfAbsent(
      ref,
      new TextEncoder().encode(canonicalizeAflTradeJson(document))
    );
    const approval = createAflTradeContentAddress('governed-evidence-approval-decision', {
      referenceId,
    });
    await sql.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO outcome_artifact_custody(artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json) VALUES($1,$2,$3,$4,$5,'capture_metadata','test_fixture',$6,$6,'{}')`,
        [ref.artifactId, ref.contentSha256, ref.storageUri, ref.mediaType, ref.byteLength, at]
      );
      await tx.query(
        `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at) VALUES($1,'governed_evidence_reference',$2,'approved','Synthetic scoped technical authority',$3::jsonb,$4,$5)`,
        [approval, referenceId, canonicalizeAflTradeJson({ referenceSha256: digest }), actor, at]
      );
      await tx.query(
        `INSERT INTO outcome_governed_evidence_reference(reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,approval_decision_id,created_at,evidence_canonical_json,evidence_json) VALUES($1,$2,'reviewer_authority_evidence',$3,'test_fixture','approved',$4,$5,$6::text,($6::text)::jsonb)`,
        [referenceId, digest, ref.artifactId, approval, at, canonicalizeAflTradeJson(document)]
      );
      await tx.query(
        `INSERT INTO outcome_operational_principal_authority(authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,valid_from_season,valid_through_season,valid_from,valid_through) VALUES($1,$2,'afl_trade_external_identity_reviewer','public-afl-draft-trade-outcomes',$3,'external_identity_resolution','AFLM',2024,2025,$4,NULL)`,
        [referenceId, actor, provider, at]
      );
    });
    return referenceId;
  }
  const authorities = new Map<string, string>();
  for (const provider of ['draftguru', 'official_afl', 'statly_reviewed'])
    authorities.set(provider, await authority(provider));
  const source = new PostgresAflTradeExternalHistoricalReconciliationSource(sql);
  const reviewRepository = new PostgresAflTradeExternalIdentityReviewRepository(sql);
  const queue = await loadAflTradeExternalIdentityReviewQueue(
    { completionId: completion.completionId },
    { source, reviewRepository }
  );
  expect(new Set(queue.items.map(({ provider }) => provider))).toEqual(
    new Set(['draftguru', 'official_afl', 'statly_reviewed'])
  );
  const clubIds = new Map<string, string>();
  const decidedAt = await instant();
  for (const item of queue.items) {
    expect(item.entityKind).toBe('club');
    const name = item.observedNames[0]!;
    let clubId = clubIds.get(name);
    if (clubId === undefined) {
      clubId = `synthetic-club-${clubIds.size}`;
      clubIds.set(name, clubId);
      await pool.query(
        `INSERT INTO outcome_club(club_id,current_name,status) VALUES($1,$2,'approved')`,
        [clubId, name]
      );
    }
    await recordAflTradeExternalIdentityReviewDecision(
      {
        completionId: completion.completionId,
        subjectId: item.subjectId,
        decision: 'approved',
        canonicalId: clubId,
        rationale: 'Synthetic exact club name',
        authorityEvidenceId: authorities.get(item.provider)!,
        decidedBy: actor,
        decidedAt,
      },
      { source, reviewRepository }
    );
  }

  const prepared = await prepareAflTradeHistoricalReconciliation(
    { completionId: completion.completionId },
    {
      source,
      identityReviewRepository: reviewRepository,
      candidateRepository: new PostgresAflTradeExternalReconciliationRepository(sql),
    }
  );
  const candidate = (
    await new PostgresAflTradeExternalCanonicalPromotionReviewRepository(sql).loadCandidate(
      prepared.candidateId
    )
  ).content;
  const club = clubIds.get('Synthetic Club')!;
  const orderPick = candidate.pickCustody.find(
    ({ recordedPickNumber }) => recordedPickNumber === 1
  )!;
  expect(orderPick.currentClubId).toBe(club);
  const slotOne = candidate.transfers.filter(
    ({ asset }) => asset.kind === 'pick_entitlement' && asset.nominalPick === 1
  );
  const tradePeriod = slotOne.find(({ toClubId }) => toClubId === club)!;
  const draftNight = slotOne.find(({ fromClubId }) => fromClubId === club)!;
  expect(tradePeriod.asset).toMatchObject({ pickId: orderPick.pickId });
  expect(draftNight).toMatchObject({
    status: 'single_source',
    toClubId: clubIds.get('Synthetic Third Club'),
    asset: { kind: 'pick_entitlement', pickId: orderPick.pickId },
  });
  expect(draftNight.transactionId).not.toBe(tradePeriod.transactionId);
  expect(
    candidate.transactions.find(({ transactionId }) => transactionId === draftNight.transactionId)
  ).toMatchObject({ seasonYear: 2024, occurredOn: '2024-11-20', transactionType: 'trade' });
  // What the reviewed deal gave in return: the third club's 2025 first-round pick.
  expect(
    candidate.transfers.find(
      ({ transactionId, fromClubId }) =>
        transactionId === draftNight.transactionId &&
        fromClubId === clubIds.get('Synthetic Third Club')
    )!.asset
  ).toMatchObject({ kind: 'pick_entitlement', draftYear: 2025, nominalRound: 1 });
}, 300_000);
