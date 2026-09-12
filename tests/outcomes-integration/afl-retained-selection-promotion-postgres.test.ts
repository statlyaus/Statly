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
import { PostgresAflTradeExternalCanonicalPromotionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';
import { createAflTradeExternalCanonicalPromotionProposal } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { createAflTradeExternalCanonicalPromotionReviewDecision } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewContracts';
import { parseAflTradeExternalEvidenceBatch } from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { createRetainedExternalCaptureFixture } from '../testUtils/retainedExternalCaptureFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `retained_selection_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const sql = createPgAflOutcomeSqlClient(pool);
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
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
}, 120000);
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

it('promotes all retained dated selections through public reconciliation without inventing pick ancestry', async () => {
  const draft = await createRetainedExternalCaptureFixture(sql, false, 'test_fixture', 27);
  const official = await createRetainedExternalCaptureFixture(sql, true);
  const plannedAt = (
    await pool.query<{ at: string }>(
      `SELECT to_char(
         date_trunc('milliseconds',GREATEST(clock_timestamp(),max(finalized_at)))+interval '1 millisecond',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
       FROM outcome_external_evidence_batch WHERE batch_id=ANY($1::text[])`,
      [[draft.target.evidenceBatchId, official.target.evidenceBatchId]]
    )
  ).rows[0]!.at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const plan = createAflTradeRetainedExternalCapturePlan({
    environment: 'test_fixture',
    competition: 'AFLM',
    plannedAt,
    scopeEvidence: [...draft.scopeEvidence, ...official.scopeEvidence].sort((a, b) =>
      a.artifactId.localeCompare(b.artifactId)
    ),
    targets: [draft.target, official.target].sort((a, b) => a.captureId.localeCompare(b.captureId)),
  });
  await new PostgresAflTradeExternalDiscoveryRepository(sql).persistRetainedPlan(plan, {
    read: async (ref) => {
      for (const repo of [draft.raw, draft.metadata, official.raw, official.metadata]) {
        const value = await repo.loadExact(ref, 2097152);
        if (value) return value.bytes;
      }
      throw new Error('Missing retained fixture bytes');
    },
  });
  const completion = await new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
    sql
  ).completeRetainedPlan(plan.planId);
  const source = new PostgresAflTradeExternalHistoricalReconciliationSource(sql);
  const reviewRepository = new PostgresAflTradeExternalIdentityReviewRepository(sql);
  const actor = 'synthetic-retained-selection-reviewer';
  async function authority(role: string, provider: string, capabilityId: string) {
    const at = await databaseInstant();
    const document = {
      evidenceKind: 'reviewer_authority_evidence',
      environment: 'test_fixture',
      principalRef: actor,
      role,
      provider,
      capabilityId,
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
        `INSERT INTO outcome_operational_principal_authority(authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,valid_from_season,valid_through_season,valid_from,valid_through) VALUES($1,$2,$3,'public-afl-draft-trade-outcomes',$4,$5,'AFLM',2024,2024,$6,NULL)`,
        [referenceId, actor, role, provider, capabilityId, at]
      );
    });
    return referenceId;
  }
  const identityAuthority = await authority(
    'afl_trade_external_identity_reviewer',
    'draftguru',
    'external_identity_resolution'
  );
  const promoterAuthority = await authority(
    'afl_trade_canonical_promoter',
    'multi_source',
    'external_candidate_promotion'
  );
  const queue = await loadAflTradeExternalIdentityReviewQueue(
    { completionId: completion.completionId },
    { source, reviewRepository }
  );
  expect(queue.items).toHaveLength(28);
  const identityReviewedAt = await databaseInstant();
  for (const [index, item] of queue.items.entries()) {
    const canonicalId = `synthetic-selection-${item.entityKind}-${index}`;
    // Canonical targets are synthetic fixture setup; decisions use the public owner.
    if (item.entityKind === 'player')
      await pool.query(
        `INSERT INTO outcome_player(player_id,display_name,status) VALUES($1,$2,'approved')`,
        [canonicalId, item.observedNames[0]]
      );
    else
      await pool.query(
        `INSERT INTO outcome_club(club_id,current_name,status) VALUES($1,$2,'approved')`,
        [canonicalId, item.observedNames[0]]
      );
    await recordAflTradeExternalIdentityReviewDecision(
      {
        completionId: completion.completionId,
        subjectId: item.subjectId,
        decision: 'approved',
        canonicalId,
        rationale: 'Synthetic exact native identity',
        authorityEvidenceId: identityAuthority,
        decidedBy: actor,
        decidedAt: identityReviewedAt,
      },
      { source, reviewRepository }
    );
  }
  const candidateRepository = new PostgresAflTradeExternalReconciliationRepository(sql);
  const prepared = await prepareAflTradeHistoricalReconciliation(
    { completionId: completion.completionId },
    { source, identityReviewRepository: reviewRepository, candidateRepository }
  );
  const reviews = new PostgresAflTradeExternalCanonicalPromotionReviewRepository(sql);
  const candidate = await reviews.loadCandidate(prepared.candidateId);
  expect(candidate.content.draftSelections).toHaveLength(27);
  expect(candidate.content.draftSelections.every((s) => s.status === 'single_source')).toBe(true);
  expect(candidate.content.pickCustody).toEqual([]);
  expect(candidate.content.pickLineage).toEqual([]);
  const batches = (await source.load(completion.completionId)).sourceBatches.map(
    parseAflTradeExternalEvidenceBatch
  );
  const session = batches
    .flatMap((b) => b.content.evidence)
    .find((e) => e.content.claim.kind === 'draft_session')!;
  if (session.content.claim.kind !== 'draft_session') throw new Error('Session missing');
  const { kind: _kind, selectionNumbers: _numbers, ...date } = session.content.claim;
  const proposal = createAflTradeExternalCanonicalPromotionProposal({
    schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v2',
    candidateId: candidate.candidateId,
    candidateSha256: candidate.candidateId.split(':')[1]!,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2024,
    draftEventCoverage: [
      {
        ...date,
        expectedSelectionCount: 27,
        selectionIds: candidate.content.draftSelections.map((s) => s.selectionId).sort(),
        evidenceIds: [session.evidenceId],
        status: 'complete',
      },
    ],
    transactionDateCoverage: [],
    proposedAt: await databaseInstant(),
    publicationEligible: false,
  });
  const decision = createAflTradeExternalCanonicalPromotionReviewDecision({
    candidateId: candidate.candidateId,
    proposalId: proposal.proposalId,
    proposalSha256: proposal.proposalId.split(':')[1]!,
    proposal,
    revision: 1,
    supersedesDecisionId: null,
    decision: 'approved',
    rationale: 'Synthetic complete dated selections; prior pick ownership remains unknown',
    authorityEvidenceId: promoterAuthority,
    decidedBy: actor,
    decidedAt: await databaseInstant(),
  });
  await reviews.persistDecision({ candidate, proposal, decision });
  const promotions = new PostgresAflTradeExternalCanonicalPromotionRepository(sql);
  const input = { candidateId: candidate.candidateId, approvalDecisionId: decision.decisionId };
  const result = await promotions.promote(input);
  expect(result).toMatchObject({
    status: 'finalized',
    draftSelectionCount: 27,
    draftPlayerAssetCount: 27,
    pickCustodyCount: 0,
    pickRealizationCount: 0,
    idempotentReplay: false,
  });
  expect(await promotions.promote(input)).toEqual({ ...result, idempotentReplay: true });
  expect((await reviews.loadCandidate(candidate.candidateId)).content.pickCustody).toEqual([]);
  // Check the externally persisted unknown, in addition to the public receipt.
  expect(
    (await pool.query('SELECT DISTINCT original_club_id FROM outcome_draft_pick')).rows
  ).toEqual([{ original_club_id: null }]);
});
