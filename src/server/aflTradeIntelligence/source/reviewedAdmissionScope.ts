import { buildReviewedRookieCorrection } from './reviewedRookieCorrection';
import { buildReviewedSpecialCorrection } from './reviewedSpecialCorrection';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from './postgresExternalHistoricalReconciliationSource';
import {
  buildReviewedOrdinaryCorrection,
  type ReviewedMovementEvidence,
} from './reviewedOrdinaryCorrection';
import { parseAflTradeExternalEvidenceEnvelope } from './externalDraftTradeEvidenceContracts';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  createAflTradeExternalReconciliationCandidate,
  parseAflTradeExternalReconciliationCandidate,
} from './externalReconciliationCandidateContracts';
import { bindReviewedPickLineage } from './reviewedPickLineage';
import { reviewedPickLineageRegistrationSchema } from './reviewedPickLineageRegistrationContracts';
import { bindRegisteredLineageForPromotion } from './reviewedPickLineagePromotionBinding';

/** Deterministic pre-correction scope. Whole trades and every relevant issue remain intact. */
export function buildReviewedAdmissionScope(input: {
  sourceCandidate: unknown;
  originalCandidate: unknown;
  registration: unknown;
}) {
  const source = parseAflTradeExternalReconciliationCandidate(input.sourceCandidate);
  const original = parseAflTradeExternalReconciliationCandidate(input.originalCandidate);
  const registration = reviewedPickLineageRegistrationSchema.parse(input.registration);
  if (
    source.content.reviewedScope ||
    source.content.pickCustody.length ||
    source.content.pickLineage.length
  )
    throw new TypeError('Admission scoping requires an unscoped pre-correction source candidate.');
  if (
    registration.content.candidateId !== original.candidateId ||
    registration.content.environment !== source.content.environment ||
    original.content.environment !== source.content.environment ||
    original.content.competition !== source.content.competition
  )
    throw new TypeError(
      'Admission scope must preserve registered candidate environment and competition.'
    );
  const { records } = bindReviewedPickLineage(original, registration.content.records);
  const roots = new Set(
    records.map(
      (r) => original.content.transfers.find((t) => t.transferId === r.transferId)!.transactionId
    )
  );
  const transactions = source.content.transactions.filter((t) => roots.has(t.transactionId));
  const transfers = source.content.transfers.filter((t) => roots.has(t.transactionId));
  for (const transaction of original.content.transactions.filter((t) =>
    roots.has(t.transactionId)
  )) {
    if (
      canonicalizeAflTradeJson(
        transactions.find((t) => t.transactionId === transaction.transactionId)
      ) !== canonicalizeAflTradeJson(transaction)
    )
      throw new TypeError('Scoped original transaction changed.');
  }
  for (const transfer of original.content.transfers.filter((t) => roots.has(t.transactionId))) {
    if (
      canonicalizeAflTradeJson(transfers.find((t) => t.transferId === transfer.transferId)) !==
      canonicalizeAflTradeJson(transfer)
    )
      throw new TypeError('Scoped original transfer changed.');
  }
  const selectionIds = new Set<string>();
  for (const record of records) {
    const endpoint = record.endpoint;
    if (endpoint.kind !== 'selected') continue;
    const matches = source.content.draftSelections.filter(
      (s) =>
        s.playerId === endpoint.playerId &&
        s.clubId === endpoint.exercisingClubId &&
        s.draftYear === endpoint.draftYear &&
        s.draftType === endpoint.draftType &&
        s.selectionNumber === endpoint.livePick
    );
    if (matches.length !== 1)
      throw new TypeError('Scoped selected endpoint requires one exact retained selection.');
    selectionIds.add(matches[0].selectionId);
  }
  const draftSelections = source.content.draftSelections.filter((s) =>
    selectionIds.has(s.selectionId)
  );
  const activeEvidence = new Set(
    [...transactions, ...transfers, ...draftSelections].flatMap((r) => r.evidenceIds)
  );
  const transferIds = new Set(transfers.map((t) => t.transferId));
  // Empty/ambiguous evidence stays blocking; shared evidence cannot be classified as unrelated.
  const retainedIssues = new Set<number>();
  let grew = true;
  while (grew) {
    grew = false;
    source.content.issues.forEach((issue, index) => {
      if (retainedIssues.has(index)) return;
      if (
        issue.evidenceIds.length === 0 ||
        issue.evidenceIds.some((id) => activeEvidence.has(id)) ||
        (issue.subjectKey.startsWith('lineage:') &&
          transferIds.has(issue.subjectKey.slice('lineage:'.length)))
      ) {
        retainedIssues.add(index);
        for (const id of issue.evidenceIds) activeEvidence.add(id);
        grew = true;
      }
    });
  }
  const issues = source.content.issues.filter((_, index) => retainedIssues.has(index));
  const allEvidence = new Set(
    [
      ...source.content.transactions,
      ...source.content.transfers,
      ...source.content.draftSelections,
      ...source.content.issues,
    ].flatMap((r) => r.evidenceIds)
  );
  const deferredEvidenceIds = [...allEvidence].filter((id) => !activeEvidence.has(id)).sort();
  return createAflTradeExternalReconciliationCandidate({
    ...source.content,
    transactions,
    transfers,
    draftSelections,
    issues,
    reviewedScope: {
      sourceCandidateId: source.candidateId,
      registrationId: registration.registrationId,
      deferredEvidenceIds,
    },
  });
}

/** Repeat under the same transaction as persistence/promotion, including current review and sources. */
export async function authenticateReviewedAdmissionScope(
  transaction: AflOutcomeSqlTransaction,
  candidate: ReturnType<typeof parseAflTradeExternalReconciliationCandidate>
) {
  if (candidate.content.reviewedRookieCorrection) {
    const expected = await prepareReviewedRookieCorrection(transaction, {
      parentCandidateId: candidate.content.reviewedRookieCorrection.parentCandidateId,
      environment: candidate.content.environment,
    });
    if (canonicalizeAflTradeJson(expected.candidate) !== canonicalizeAflTradeJson(candidate))
      throw new TypeError('Rookie correction differs from its authenticated parent, review or retained evidence.');
    return;
  }
  if (candidate.content.reviewedSpecialCorrection) {
    const correction = candidate.content.reviewedSpecialCorrection;
    const authority = candidate.content.sourceAuthority;
    if (authority?.kind !== 'historical_plan_completion')
      throw new TypeError('Special correction requires its retained completion.');
    const expected = await prepareReviewedSpecialCorrection(transaction, {
      parentCandidateId: correction.parentCandidateId,
      completionId: authority.completionId,
      entitlementIds: [...new Set(correction.bindings.map((b) => b.entitlementId))],
      environment: candidate.content.environment,
    });
    if (canonicalizeAflTradeJson(expected.candidate) !== canonicalizeAflTradeJson(candidate))
      throw new TypeError(
        'Special correction differs from its authenticated parent, registered awards or exact completion.'
      );
    return;
  }
  if (candidate.content.reviewedCorrection) {
    const expected = await prepareReviewedOrdinaryCorrection(transaction, {
      scopeCandidateId: candidate.content.reviewedCorrection.scopeCandidateId,
      environment: candidate.content.environment,
    });
    if (canonicalizeAflTradeJson(expected.candidate) !== canonicalizeAflTradeJson(candidate))
      throw new TypeError(
        'Reviewed correction differs from its exact registered custody, endpoints and retained evidence.'
      );
    return;
  }
  const scope = candidate.content.reviewedScope;
  if (!scope) return;
  const stored = await transaction.query<{ registration: unknown }>(
    'SELECT read_outcome_reviewed_pick_lineage($1) AS registration',
    [scope.registrationId]
  );
  const registration = reviewedPickLineageRegistrationSchema.parse(stored.rows[0]?.registration);
  if (candidate.content.environment === 'production')
    throw new TypeError('Reviewed scope is restricted to private environments.');
  await bindRegisteredLineageForPromotion(transaction, {
    registrationId: scope.registrationId,
    candidateId: registration.content.candidateId,
    environment: candidate.content.environment,
  });
  const inputs = await transaction.query<{
    candidate_id: string;
    candidate_json: unknown;
    current: boolean;
  }>(
    `SELECT candidate_id,candidate_json,outcome_external_candidate_retained_sources_current(candidate_id,clock_timestamp()) AS current FROM outcome_external_reconciliation_candidate WHERE candidate_id=ANY($1::text[]) FOR SHARE`,
    [[scope.sourceCandidateId, registration.content.candidateId]]
  );
  const source = inputs.rows.find((r) => r.candidate_id === scope.sourceCandidateId);
  const original = inputs.rows.find((r) => r.candidate_id === registration.content.candidateId);
  if (!source?.current || !original?.current)
    throw new TypeError('Scoped source candidates require current source authority.');
  const expected = buildReviewedAdmissionScope({
    sourceCandidate: source.candidate_json,
    originalCandidate: original.candidate_json,
    registration,
  });
  if (canonicalizeAflTradeJson(expected) !== canonicalizeAflTradeJson(candidate))
    throw new TypeError(
      'Reviewed admission scope differs from its exact retained records and issues.'
    );
}

/** Assemble only from finalized parents and current registered authority in the caller's transaction. */
export async function prepareReviewedOrdinaryCorrection(
  transaction: AflOutcomeSqlTransaction,
  input: { scopeCandidateId: string; environment: string }
) {
  const loaded = await transaction.query<{ candidate_json: unknown; current: boolean }>(
    `SELECT candidate_json,outcome_external_candidate_retained_sources_current(candidate_id,clock_timestamp()) AS current
     FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1 AND status='finalized' FOR SHARE`,
    [input.scopeCandidateId]
  );
  if (!loaded.rows[0]?.current)
    throw new TypeError('Reviewed correction requires a current finalized scope.');
  const scope = parseAflTradeExternalReconciliationCandidate(loaded.rows[0].candidate_json);
  if (
    !scope.content.reviewedScope ||
    scope.content.reviewedCorrection ||
    scope.content.environment !== input.environment
  )
    throw new TypeError('Reviewed correction requires the original scope and exact environment.');
  await authenticateReviewedAdmissionScope(transaction, scope);
  const stored = await transaction.query<{ registration: unknown }>(
    'SELECT read_outcome_reviewed_pick_lineage($1) AS registration',
    [scope.content.reviewedScope.registrationId]
  );
  const registration = reviewedPickLineageRegistrationSchema.parse(stored.rows[0]?.registration);
  const movementEvidence = await loadReviewedMovementEvidence(transaction, scope);
  return buildReviewedOrdinaryCorrection({ scopeCandidate: scope, registration, movementEvidence });
}

/** Load and authenticate every dependency inside the caller's persistence transaction. */
export async function prepareReviewedSpecialCorrection(
  transaction: AflOutcomeSqlTransaction,
  input: {
    parentCandidateId: string;
    completionId: string;
    entitlementIds: readonly string[];
    environment: string;
  }
) {
  if (
    input.environment === 'production' ||
    !input.entitlementIds.length ||
    new Set(input.entitlementIds).size !== input.entitlementIds.length
  )
    throw new TypeError('Special correction requires unique awards and a private environment.');
  const loaded = await transaction.query<{ candidate_json: unknown; current: boolean }>(
    `SELECT candidate_json,outcome_external_candidate_retained_sources_current(candidate_id,clock_timestamp()) AS current
     FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1 AND status='finalized' FOR SHARE`,
    [input.parentCandidateId]
  );
  if (!loaded.rows[0]?.current)
    throw new TypeError('Special correction requires a current finalized ordinary parent.');
  const parent = parseAflTradeExternalReconciliationCandidate(loaded.rows[0].candidate_json);
  if (
    !parent.content.reviewedCorrection ||
    parent.content.reviewedSpecialCorrection ||
    parent.content.environment !== input.environment
  )
    throw new TypeError('Special correction parent is not the exact ordinary scope.');
  await authenticateReviewedAdmissionScope(transaction, parent);
  const stored = await transaction.query<{ registration: unknown }>(
    'SELECT read_outcome_reviewed_pick_lineage($1) AS registration',
    [parent.content.reviewedCorrection.registrationId]
  );
  const retained = await transaction.query<{ award_json: unknown; approval_decision_id: string }>(
    'SELECT award_json,approval_decision_id FROM outcome_special_entitlement_award WHERE entitlement_id=ANY($1::text[]) FOR SHARE',
    [input.entitlementIds]
  );
  if (retained.rows.length !== input.entitlementIds.length)
    throw new TypeError('Every requested special award must be registered.');
  for (const award of retained.rows)
    await transaction.query('SELECT authenticate_outcome_special_entitlement_award($1::jsonb,$2)', [
      canonicalizeAflTradeJson(award.award_json),
      award.approval_decision_id,
    ]);
  const source = await new PostgresAflTradeExternalHistoricalReconciliationSource({
    query: transaction.query.bind(transaction),
    transaction: (work) => work(transaction),
  }).load(input.completionId);
  if (
    source.environment !== parent.content.environment ||
    source.competition !== parent.content.competition
  )
    throw new TypeError('Special correction completion differs from parent scope.');
  return buildReviewedSpecialCorrection({
    candidate: parent,
    registration: stored.rows[0]?.registration,
    awards: retained.rows.map((a) => ({
      award: a.award_json,
      approvalDecisionId: a.approval_decision_id,
    })),
    sourceAuthority: source.sourceAuthority,
    sourceBatches: source.sourceBatches,
  });
}

async function loadReviewedMovementEvidence(
  transaction: AflOutcomeSqlTransaction,
  scope: ReturnType<typeof parseAflTradeExternalReconciliationCandidate>
): Promise<ReviewedMovementEvidence[]> {
  const parent = await transaction.query<{ candidate_json: unknown }>(
    'SELECT candidate_json FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1 FOR SHARE',
    [scope.content.reviewedScope!.sourceCandidateId]
  );
  const expanded = parseAflTradeExternalReconciliationCandidate(parent.rows[0]?.candidate_json);
  const retained = await transaction.query<{
    artifact_id: string;
    source_url: string;
    evidence_json: unknown;
  }>(
    `SELECT c.source_artifact_id AS artifact_id,c.manifest_json->>'sourceUrl' AS source_url,r.evidence_json
     FROM outcome_external_evidence_row r JOIN outcome_external_evidence_batch b ON b.batch_id=r.batch_id
     JOIN outcome_source_capture c ON c.capture_id=b.capture_id WHERE b.batch_id=ANY($1::text[])`,
    [scope.content.sourceBatchIds]
  );
  const evidence = retained.rows.map((row) => ({
    ...row,
    evidence: parseAflTradeExternalEvidenceEnvelope(row.evidence_json),
  }));
  const movementEvidence: ReviewedMovementEvidence[] = [];
  for (const transfer of expanded.content.transfers) {
    if (transfer.asset.kind !== 'pick_entitlement' && transfer.asset.kind !== 'special_pick')
      continue;
    const event = expanded.content.transactions.find(
      (t) => t.transactionId === transfer.transactionId
    )!;
    for (const row of evidence.filter((r) =>
      transfer.evidenceIds.includes(r.evidence.evidenceId)
    )) {
      const claim = row.evidence.content.claim;
      if (claim.kind !== 'directed_transfer' || claim.nativeEventId !== event.providerEventId)
        continue;
      const asset = transfer.asset;
      const label =
        asset.kind === 'special_pick'
          ? asset.sourceLabel
          : (asset.recordedLabel ??
            (asset.nominalPick !== null
              ? `Pick ${asset.nominalPick}`
              : claim.asset.kind === 'future_pick'
                ? `${claim.asset.draftYear}R${claim.asset.roundNumber} (${claim.asset.originalClub.recordedName})`
                : null));
      if (!transfer.fromClubId || !transfer.toClubId)
        throw new TypeError('Reviewed movement requires resolved directed clubs.');
      movementEvidence.push({
        artifactId: row.artifact_id,
        sourceUrl: row.source_url,
        nativeEventId: claim.nativeEventId,
        transferId: transfer.transferId,
        fromClubId: transfer.fromClubId,
        toClubId: transfer.toClubId,
        retainedAssetLabel: label ?? '',
        evidenceId: row.evidence.evidenceId,
      });
    }
  }
  return movementEvidence;
}

export async function prepareReviewedRookieCorrection(
  transaction: AflOutcomeSqlTransaction,
  input: { parentCandidateId: string; environment: string }
) {
  const loaded = await transaction.query<{ candidate_json: unknown; current: boolean }>(
    `SELECT candidate_json,outcome_external_candidate_retained_sources_current(candidate_id,clock_timestamp()) AS current
     FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1 AND status='finalized' FOR SHARE`,
    [input.parentCandidateId]
  );
  if (!loaded.rows[0]?.current) throw new TypeError('Rookie correction requires a current finalized parent.');
  const parent = parseAflTradeExternalReconciliationCandidate(loaded.rows[0].candidate_json);
  if (!parent.content.reviewedCorrection || parent.content.reviewedRookieCorrection ||
    parent.content.environment !== input.environment || input.environment === 'production')
    throw new TypeError('Rookie correction requires its exact private reviewed parent.');
  await authenticateReviewedAdmissionScope(transaction, parent);
  const stored = await transaction.query<{ registration: unknown }>(
    'SELECT read_outcome_reviewed_pick_lineage($1) AS registration',
    [parent.content.reviewedCorrection.registrationId]
  );
  const registration = reviewedPickLineageRegistrationSchema.parse(stored.rows[0]?.registration);
  const movementEvidence = await loadReviewedMovementEvidence(transaction, parent);
  return buildReviewedRookieCorrection({ candidate: parent, registration, movementEvidence });
}
