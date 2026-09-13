import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import { parseAflTradeExternalEvidenceBatch } from './externalDraftTradeEvidenceContracts';
import {
  createAflTradeExternalReconciliationCandidate,
  parseAflTradeExternalReconciliationCandidate,
} from './externalReconciliationCandidateContracts';
import { createAflTradeHistoricalCompletionReconciliationAuthority } from './externalReconciliationSourceAuthorityContracts';
import { buildReviewedSpecialCustodyBindings } from './reviewedSpecialCustodyBindings';
import { resolveSpecialEntitlementCustody } from './resolveSpecialEntitlementCustody';

/** Deterministic preparation; the persistence owner must authenticate parent, completion and awards. */
export function buildReviewedSpecialCorrection(input: {
  candidate: unknown;
  registration: unknown;
  awards: readonly { award: unknown; approvalDecisionId: string }[];
  sourceAuthority: Parameters<typeof createAflTradeHistoricalCompletionReconciliationAuthority>[0];
  sourceBatches: readonly unknown[];
}) {
  const parent = parseAflTradeExternalReconciliationCandidate(input.candidate);
  if (
    !parent.content.reviewedCorrection ||
    parent.content.reviewedSpecialCorrection ||
    !parent.content.reviewedScope
  )
    throw new TypeError('Special correction requires an ordinary-correction parent.');
  const prepared = buildReviewedSpecialCustodyBindings(input);
  const authority = createAflTradeHistoricalCompletionReconciliationAuthority(
    input.sourceAuthority
  );
  const batches = input.sourceBatches.map(parseAflTradeExternalEvidenceBatch);
  const ids = batches.map((b) => b.batchId).sort();
  if (
    new Set(ids).size !== ids.length ||
    authority.candidateSourceBatchSetSha256 !== sha256AflTradeCanonicalJson(ids) ||
    authority.completionSourceBatchSetSha256 !== sha256AflTradeCanonicalJson(ids)
  )
    throw new TypeError('Special correction requires the exact completed source batch set.');
  const wanted = new Set(parent.content.sourceBatchIds);
  const awards = [
    ...new Map(prepared.bindings.map((b) => [b.award.entitlementId, b.award])).values(),
  ];
  for (const award of awards)
    for (const reference of award.content.evidence) {
      const matches = batches.filter((b) => b.content.captureId === reference.captureId);
      if (
        matches.length !== 1 ||
        !matches[0].content.evidence.every(
          (e) =>
            e.content.capture.contentSha256 === reference.contentSha256 &&
            e.content.capture.sourceUrl === reference.sourceUrl
        )
      )
        throw new TypeError(
          'Every award needs its exact retained source capture in the completion.'
        );
      wanted.add(matches[0].batchId);
    }
  if (canonicalizeAflTradeJson([...wanted].sort()) !== canonicalizeAflTradeJson(ids))
    throw new TypeError(
      'Special correction source set must preserve its parent and add only award evidence.'
    );
  const added = batches.filter((b) => !parent.content.sourceBatchIds.includes(b.batchId));
  for (const batch of added) {
    if (
      batch.content.provider !== 'official_afl' ||
      batch.content.evidence.some((e) => e.content.claim.kind !== 'issuing_award_reference')
    )
      throw new TypeError(
        'Additional special correction batches must contain only issuing references.'
      );
    const affected = awards.filter((a) =>
      a.content.evidence.some((e) => e.captureId === batch.content.captureId)
    );
    if (
      batch.content.evidence.some((e) => {
        const claim = e.content.claim;
        return (
          claim.kind === 'issuing_award_reference' &&
          affected.some((a) => a.content.awardYear !== claim.grantYear)
        );
      })
    )
      throw new TypeError('Issuing reference year differs from its registered award.');
  }
  const resolved = resolveSpecialEntitlementCustody({
    candidate: parent,
    bindings: prepared.bindings,
    reconciledAt: authority.completedAt,
  });
  const bindings = prepared.bindings
    .map((b) => ({
      transferId: b.transferId,
      entitlementId: b.award.entitlementId,
      awardApprovalDecisionId: b.awardApprovalDecisionId,
      predecessorTransferId: b.predecessorTransferId,
    }))
    .sort((a, b) => a.transferId.localeCompare(b.transferId));
  return {
    candidate: createAflTradeExternalReconciliationCandidate({
      ...resolved.content,
      sourceBatchIds: ids,
      sourceAuthority: authority,
      reviewedScope: {
        ...parent.content.reviewedScope,
        deferredEvidenceIds: [
          ...new Set([
            ...parent.content.reviewedScope.deferredEvidenceIds,
            ...added.flatMap((b) => b.content.evidence.map((e) => e.evidenceId)),
          ]),
        ].sort(),
      },
      reviewedSpecialCorrection: {
        schemaVersion: 'afl-trade-reviewed-special-correction/v1',
        parentCandidateId: parent.candidateId,
        registrationId: parent.content.reviewedCorrection.registrationId,
        correctionGraphId: parent.content.reviewedCorrection.correctionGraphId,
        bindings,
      },
    }),
    historyCount: prepared.historyCount,
    transferCount: bindings.length,
    persisted: false as const,
    canonicalAdmission: false as const,
  };
}
