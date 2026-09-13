import { specialEntitlementLifecycleSchema } from '@/server/aflTradeIntelligence/source/specialEntitlementLifecycleContracts';
import { createSpecialEntitlementRevision } from '@/server/aflTradeIntelligence/source/specialEntitlementRevisionContracts';
import { Pool } from 'pg';
import { expect } from 'vitest';
import {
  createAflTradeContentAddress as address,
  canonicalizeAflTradeJson as canonical,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createSpecialEntitlementAward } from '@/server/aflTradeIntelligence/source/specialEntitlementAwardContracts';
import { resolveSpecialEntitlementCustody } from '@/server/aflTradeIntelligence/source/resolveSpecialEntitlementCustody';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { deriveAflTradeExternalCanonicalPromotionProposal } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { createAflTradeExternalCanonicalPromotionReviewDecision } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewContracts';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';
import { PostgresAflTradeExternalCanonicalPromotionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';

/** Synthetic custody setup; exercise uses the caller's genuinely persisted fixture window promotion. */
export async function verifyWindowSpecialExercise(
  pool: Pool,
  input: {
    promotionId: string;
    windowCaptureId: string;
    batchId: string;
    authorityId: string;
    actor: string;
  }
) {
  const sql = createPgAflOutcomeSqlClient(pool);
  const repository = new PostgresAflTradeExternalCanonicalPromotionRepository(sql);
  const candidates = new PostgresAflTradeExternalReconciliationRepository(sql);
  const reviews = new PostgresAflTradeExternalCanonicalPromotionReviewRepository(sql);
  const now = async () =>
    (
      await pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
    ).rows[0].at.toISOString() as string;
  const selection = (
    await pool.query<{ selection_id: string; club_id: string; pick_id: string }>(
      `SELECT s.* FROM outcome_draft_selection s
    JOIN outcome_external_canonical_promotion_record r ON r.canonical_record_id=s.selection_id
    WHERE r.promotion_id=$1 AND r.record_kind='draft_selection'`,
      [input.promotionId]
    )
  ).rows[0];
  const source = (
    await pool.query<{
      capture_id: string;
      content_sha256: string;
      url: string;
      evidence_ids: string[];
    }>(
      `SELECT b.capture_id,a.content_sha256,c.manifest_json->>'sourceUrl' AS url,
    (SELECT array_agg(evidence_id ORDER BY evidence_id) FROM outcome_external_evidence_row WHERE batch_id=b.batch_id) AS evidence_ids
    FROM outcome_external_evidence_batch b JOIN outcome_source_capture c USING(capture_id)
    JOIN outcome_artifact_custody a ON a.artifact_id=c.source_artifact_id WHERE b.batch_id=$1`,
      [input.batchId]
    )
  ).rows[0];
  const evidence = [
    { captureId: source.capture_id, contentSha256: source.content_sha256, sourceUrl: source.url },
  ];
  const award = createSpecialEntitlementAward({
    schemaVersion: 'afl-trade-special-entitlement-award/v1',
    environment: 'test_fixture',
    competition: 'AFLM',
    issuingAwardId: 'synthetic-window-compensation',
    component: 'CMP3 (Synthetic window fixture)',
    asset: {
      kind: 'special_pick',
      entitlementType: 'expansion_compensation',
      draftYear: null,
      selectionOrdinal: null,
      sourceLabel: 'CMP3 (Synthetic window fixture)',
    },
    holderClubId: selection.club_id,
    awardYear: 2024,
    awardedOn: null,
    evidence,
  });
  const approve = async (subject: string, id: string, record: unknown, version: string) => {
    const content = {
      schemaVersion: version,
      authorityEvidenceId: input.authorityId,
      ...(subject === 'special_draft_entitlement_award'
        ? { award: record }
        : subject === 'special_draft_entitlement_revision'
          ? { revision: record }
          : { record }),
    };
    const decisionId = address('review-decision', { content, reviewedAt: await now() });
    await pool.query(
      `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
      VALUES($1,$2,$3,'approved','Synthetic window exercise verification',$4::jsonb,$5,$6) ON CONFLICT DO NOTHING`,
      [decisionId, subject, id, canonical(content), input.actor, await now()]
    );
    return decisionId;
  };
  const awardApproval = await approve(
    'special_draft_entitlement_award',
    award.entitlementId,
    award,
    'afl-trade-special-entitlement-award-approval/v1'
  );
  await repository.registerSpecialEntitlementAward({ award, approvalDecisionId: awardApproval });
  const intermediate = 'synthetic-window-custody-club';
  await pool.query(
    "INSERT INTO outcome_club(club_id,current_name,status) VALUES($1,'Synthetic intermediate club','approved')",
    [intermediate]
  );
  const ids = [0, 1].map((i) =>
    address('external-transaction', { windowAward: award.entitlementId, i })
  );
  const transfers = ids.map((transactionId) => address('external-transfer', { transactionId }));
  const sourcePick = address('draft-pick', { windowAward: award.entitlementId });
  const original = createAflTradeExternalReconciliationCandidate({
    schemaVersion: 'afl-trade-external-reconciliation/v1',
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2024,
    sourceBatchIds: [input.batchId],
    identityResolutionIds: [],
    transactions: ids
      .map((transactionId, i) => ({
        transactionId,
        providerEventId: `synthetic-window-custody-${i}`,
        seasonYear: 2024,
        occurredOn: `2024-10-${10 + i}`,
        transactionType: 'trade' as const,
        title: 'Synthetic window right custody',
        parties: [selection.club_id, intermediate].sort(),
        transferIds: [transfers[i]!],
        status: 'single_source' as const,
        evidenceIds: source.evidence_ids,
      }))
      .sort((a, b) => a.transactionId.localeCompare(b.transactionId)),
    transfers: transfers
      .map((transferId, i) => ({
        transferId,
        transactionId: ids[i]!,
        fromClubId: i ? intermediate : selection.club_id,
        toClubId: i ? selection.club_id : intermediate,
        asset: i
          ? {
              kind: 'pick_entitlement' as const,
              pickId: sourcePick,
              draftYear: 2024,
              draftType: 'national',
              nominalRound: 1,
              nominalPick: 27,
              originalClubId: selection.club_id,
              recordedLabel: 'Pick 27',
            }
          : award.content.asset,
        status: 'unresolved' as const,
        evidenceIds: source.evidence_ids,
      }))
      .sort((a, b) => a.transferId.localeCompare(b.transferId)),
    draftSelections: [],
    pickCustody: [],
    pickLineage: [],
    issues: transfers
      .map((id) => ({
        code: 'lineage_unresolved' as const,
        severity: 'blocking' as const,
        subjectKey: `lineage:${id}`,
        detail:
          'Special entitlement requires independently resolved award, activation and custody evidence.',
        evidenceIds: source.evidence_ids,
      }))
      .sort((a, b) => a.subjectKey.localeCompare(b.subjectKey)),
    reconciledAt: await now(),
    publicationEligible: false,
  });
  await candidates.persistCandidate({ candidate: original, identityResolutions: [] });
  const resolved = resolveSpecialEntitlementCustody({
    candidate: original,
    reconciledAt: await now(),
    bindings: transfers.map((transferId, i) => ({
      transferId,
      award,
      awardApprovalDecisionId: awardApproval,
      predecessorTransferId: i ? transfers[0]! : null,
    })),
  });
  await candidates.persistCandidate({ candidate: resolved, identityResolutions: [] });
  const proposal = deriveAflTradeExternalCanonicalPromotionProposal({
    candidate: resolved,
    proposedAt: await now(),
    draftEvents: [],
    transactionDates: resolved.content.transactions.map((t) => ({
      transactionId: t.transactionId,
      occurredOn: t.occurredOn,
    })),
  });
  const decision = createAflTradeExternalCanonicalPromotionReviewDecision({
    candidateId: resolved.candidateId,
    proposalId: proposal.proposalId,
    proposalSha256: proposal.proposalId.split(':')[1]!,
    proposal,
    revision: 1,
    supersedesDecisionId: null,
    decision: 'approved',
    rationale: 'Synthetic window custody',
    authorityEvidenceId: input.authorityId,
    decidedBy: input.actor,
    decidedAt: await now(),
  });
  await reviews.persistDecision({ candidate: resolved, proposal, decision });
  await repository.promote({
    candidateId: resolved.candidateId,
    approvalDecisionId: decision.decisionId,
  });
  const base = {
    schemaVersion: 'afl-trade-special-entitlement-lifecycle/v1',
    entitlementId: award.entitlementId,
    evidence,
  };
  const exercise = {
    ...base,
    kind: 'exercise',
    selectionId: selection.selection_id,
    terminalTransferId: transfers[1]!,
    renumbering: [
      {
        transferId: transfers[1]!,
        sourcePickId: sourcePick,
        targetPickId: selection.pick_id,
        occurredAt: { precision: 'day', date: '2024-11-22' },
        evidenceCaptureIds: [source.capture_id],
      },
    ],
  };
  const reviewed = async (record: typeof exercise | Record<string, unknown>) => ({
    record: specialEntitlementLifecycleSchema.parse(record),
    approvalDecisionId: await approve(
      `special_draft_entitlement_${record.kind}`,
      award.entitlementId,
      record,
      'afl-trade-special-entitlement-lifecycle-approval/v1'
    ),
  });
  const exerciseInput = await reviewed(exercise);
  await expect(repository.registerSpecialEntitlementLifecycle(exerciseInput)).rejects.toThrow(
    /activation/
  );
  await repository.registerSpecialEntitlementLifecycle(
    await reviewed({
      ...base,
      kind: 'activation',
      useYear: 2024,
      noticedOn: '2024-10-01',
      noticeYear: 2024,
      rule: 'deferred_nomination',
      expiresAfterYear: 2029,
    })
  );
  await expect(
    repository.registerSpecialEntitlementLifecycle(
      await reviewed({
        ...exercise,
        renumbering: [
          {
            ...exercise.renumbering[0]!,
            occurredAt: { precision: 'day', date: '2024-11-26' },
          },
        ],
      })
    )
  ).rejects.toThrow(/chronology/);
  const result = await repository.registerSpecialEntitlementLifecycle(exerciseInput);
  expect(result.record).toEqual(exercise);
  expect(await repository.registerSpecialEntitlementLifecycle(exerciseInput)).toMatchObject({
    idempotentReplay: true,
  });
  const originalRevision = await repository.loadSpecialEntitlementRevision(award.entitlementId);
  expect(originalRevision.content.state.exercise!.record).toEqual(exercise);
  const correctedAward = createSpecialEntitlementAward({
    ...award.content,
    awardedOn: '2024-01-01',
  });
  const correctedApproval = await approve(
    'special_draft_entitlement_award',
    award.entitlementId,
    correctedAward,
    'afl-trade-special-entitlement-award-approval/v1'
  );
  const revision = createSpecialEntitlementRevision({
    ...originalRevision.content,
    revision: 2,
    supersedesRevisionId: originalRevision.revisionId,
    reason: 'Synthetic evidenced award day with unchanged window exercise',
    changedFields: ['activation', 'award', 'exercise'],
    proposedAt: await now(),
    state: {
      ...originalRevision.content.state,
      award: { award: correctedAward, approvalDecisionId: correctedApproval },
      activation: await reviewed(originalRevision.content.state.activation!.record),
      exercise: await reviewed(exercise),
    },
  });
  const revisionInput = {
    revision,
    approvalDecisionId: await approve(
      'special_draft_entitlement_revision',
      revision.revisionId,
      revision,
      'afl-trade-special-entitlement-revision-approval/v1'
    ),
  };
  await repository.registerSpecialEntitlementRevision(revisionInput);
  expect(await repository.registerSpecialEntitlementRevision(revisionInput)).toMatchObject({
    idempotentReplay: true,
  });
  expect(await repository.loadSpecialEntitlementRevision(award.entitlementId)).toEqual(revision);
  const currentExercise = revision.content.state.exercise!;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role=replica');
    await client.query("UPDATE outcome_source_capture SET status='rejected' WHERE capture_id=$1", [
      input.windowCaptureId,
    ]);
    await expect(
      client.query(
        'SELECT authenticate_outcome_special_entitlement_revision_lifecycle($1::jsonb,$2,$3::jsonb)',
        [
          canonical(currentExercise.record),
          currentExercise.approvalDecisionId,
          canonical(revision.content.state),
        ]
      )
    ).rejects.toThrow(/selection scope/);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  await pool.query(
    'SELECT authenticate_outcome_special_entitlement_revision_lifecycle($1::jsonb,$2,$3::jsonb)',
    [
      canonical(currentExercise.record),
      currentExercise.approvalDecisionId,
      canonical(revision.content.state),
    ]
  );
  return { exercise, exerciseInput, repository, revisionInput };
}
