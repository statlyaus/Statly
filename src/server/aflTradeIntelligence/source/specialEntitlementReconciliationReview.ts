import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { parseAflTradeExternalEvidenceBatch } from './externalDraftTradeEvidenceContracts';
import { parseAflTradeExternalReconciliationCandidate } from './externalReconciliationCandidateContracts';
import {
  specialEntitlementDateBounds,
  validateSpecialEntitlementLink,
} from './specialEntitlementLinkValidation';

type ReviewBundle = NonNullable<
  ReturnType<typeof validateSpecialEntitlementLink>['link']
>['evidenceBundle'];

/** Read-only diagnostics. Matching supplied evidence is not authentication of its ledger authority. */
export function reviewSpecialEntitlementReconciliation(input: {
  candidate: unknown;
  sourceBatches: readonly unknown[];
  links: readonly unknown[];
}) {
  const candidate = parseAflTradeExternalReconciliationCandidate(input.candidate);
  const batches = input.sourceBatches.map(parseAflTradeExternalEvidenceBatch);
  if (
    JSON.stringify(batches.map((batch) => batch.batchId).sort()) !==
    JSON.stringify([...candidate.content.sourceBatchIds].sort())
  ) {
    throw new TypeError('Entitlement review requires the exact candidate source batches.');
  }
  const evidence = batches.flatMap((batch) => batch.content.evidence);
  const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));
  const captureBindings = new Map<string, Set<string>>();
  for (const {
    content: { capture },
  } of evidence) {
    const bindings = captureBindings.get(capture.captureId) ?? new Set<string>();
    bindings.add(JSON.stringify([capture.contentSha256, capture.sourceUrl]));
    captureBindings.set(capture.captureId, bindings);
  }
  const transfersById = new Map(candidate.content.transfers.map((item) => [item.transferId, item]));
  const transactionsById = new Map(
    candidate.content.transactions.map((item) => [item.transactionId, item])
  );
  const usedTransfers = new Set<string>();
  const usedEntitlements = new Set<string>();
  const usedSelections = new Set<string>();
  const referencesMatch = (references: ReviewBundle['award']['evidence'], evidenceIds?: string[]) =>
    references.every((reference) => {
      const bindings = captureBindings.get(reference.captureId);
      return (
        bindings?.size === 1 &&
        bindings.has(JSON.stringify([reference.contentSha256, reference.sourceUrl])) &&
        (evidenceIds === undefined ||
          evidenceIds.some(
            (id) => evidenceById.get(id)?.content.capture.captureId === reference.captureId
          ))
      );
    });
  function validateTradeDate(
    transfer: (typeof candidate.content.transfers)[number],
    edge: ReviewBundle['custody'][number],
    issues: Set<string>
  ): void {
    const transaction = transactionsById.get(transfer.transactionId);
    const edgeDate = specialEntitlementDateBounds(edge.occurredAt);
    if (
      !transaction ||
      transaction.seasonYear !== edgeDate.year ||
      (transaction.occurredOn !== null &&
        edgeDate.day !== null &&
        transaction.occurredOn !== edgeDate.day)
    ) {
      issues.add('canonical_trade_date_mismatch');
    }
  }

  function validateCandidateCustody(bundle: ReviewBundle, issues: Set<string>): void {
    let specialTransfers = 0;
    for (const edge of bundle.custody) {
      if (usedTransfers.has(edge.transferId)) issues.add('transfer_claimed_by_multiple_links');
      usedTransfers.add(edge.transferId);
      const transfer = transfersById.get(edge.transferId);
      if (
        !transfer ||
        transfer.fromClubId !== edge.fromClubId ||
        transfer.toClubId !== edge.toClubId ||
        transfer.asset.kind === 'player'
      ) {
        issues.add('canonical_transfer_mismatch');
        continue;
      }
      if (transfer.status === 'disputed') issues.add('canonical_transfer_disputed');
      if (transfer.asset.kind === 'special_pick') {
        specialTransfers += 1;
        if (
          sha256AflTradeCanonicalJson(transfer.asset) !== sha256AflTradeCanonicalJson(bundle.asset)
        ) {
          issues.add('canonical_component_mismatch');
        }
      }
      validateTradeDate(transfer, edge, issues);
      if (!referencesMatch(edge.evidence, transfer.evidenceIds))
        issues.add('transfer_evidence_mismatch');
    }
    if (specialTransfers === 0) issues.add('special_transfer_missing');
  }

  function validateCandidateSelection(bundle: ReviewBundle, issues: Set<string>): void {
    const selections = candidate.content.draftSelections.filter(
      (item) =>
        item.draftYear === bundle.selection.draftYear &&
        item.draftType === bundle.selection.draftType &&
        item.selectionNumber === bundle.selection.selectionNumber &&
        item.clubId === bundle.selection.clubId &&
        item.playerId === bundle.selection.playerId
    );
    if (selections.length !== 1) issues.add('canonical_selection_mismatch');
    else if (!referencesMatch(bundle.selection.evidence, selections[0].evidenceIds)) {
      issues.add('selection_evidence_mismatch');
    }
    if (selections.length === 1) {
      if (selections[0].status === 'disputed') issues.add('canonical_selection_disputed');
      for (const edge of bundle.custody) {
        const asset = transfersById.get(edge.transferId)?.asset;
        const renumbering = (bundle.renumbering ?? []).filter(
          (binding) => binding.transferId === edge.transferId
        );
        if (asset?.kind === 'pick_entitlement' && asset.pickId !== selections[0].pickId) {
          const binding = renumbering[0];
          const transfer = transfersById.get(edge.transferId)!;
          if (binding && !referencesMatch(binding.evidence, transfer.evidenceIds))
            issues.add('renumbering_transfer_evidence_mismatch');
          if (
            renumbering.length !== 1 ||
            !binding ||
            binding.sourcePickId !== asset.pickId ||
            binding.targetPickId !== selections[0].pickId ||
            asset.draftYear !== selections[0].draftYear ||
            asset.draftType !== selections[0].draftType
          ) {
            issues.add('canonical_pick_mismatch');
          }
        } else if (renumbering.length > 0) {
          issues.add('unnecessary_renumbering_binding');
        }
      }
    }
  }

  const results = input.links.map((link) => {
    const validation = validateSpecialEntitlementLink(link);
    const issues = new Set(validation.issues);
    const bundle = validation.link?.evidenceBundle;
    const entitlementId = bundle
      ? createAflTradeContentAddress('special-draft-entitlement', {
          competition: candidate.content.competition,
          issuingAwardId: bundle.award.entitlementId,
          component: bundle.award.component,
          entitlementType: bundle.asset.entitlementType,
        })
      : null;
    if (bundle && entitlementId) {
      if (usedEntitlements.has(entitlementId)) issues.add('entitlement_claimed_by_multiple_links');
      usedEntitlements.add(entitlementId);
      const exerciseKey = JSON.stringify([
        bundle.selection.draftYear,
        bundle.selection.draftType,
        bundle.selection.selectionNumber,
      ]);
      if (usedSelections.has(exerciseKey)) issues.add('selection_claimed_by_multiple_rights');
      usedSelections.add(exerciseKey);
      for (const event of [
        bundle.award,
        ...(bundle.activation ? [bundle.activation] : []),
        ...bundle.custody,
        ...(bundle.renumbering ?? []),
        bundle.selection,
      ]) {
        if (!referencesMatch(event.evidence)) issues.add('capture_not_bound_to_candidate');
      }
      validateCandidateCustody(bundle, issues);
      validateCandidateSelection(bundle, issues);
    }
    return {
      linkSha256: sha256AflTradeCanonicalJson(link),
      status: issues.size ? ('blocked' as const) : ('candidate_bound' as const),
      issues: [...issues].sort(),
      proposedResolution:
        issues.size || !bundle || !entitlementId
          ? null
          : {
              entitlementId,
              competition: candidate.content.competition,
              issuingAwardId: bundle.award.entitlementId,
              component: bundle.award.component,
              sourceAsset: bundle.asset,
              award: bundle.award,
              custody: bundle.custody.map((edge) => ({ ...edge, entitlementId })),
              retrospectiveExercise: {
                activation: bundle.activation,
                ...(bundle.renumbering?.length
                  ? {
                      renumbering: bundle.renumbering.map((binding) => ({
                        transferId: binding.transferId,
                        sourcePickId: binding.sourcePickId,
                        targetPickId: binding.targetPickId,
                        occurredAt:
                          typeof binding.occurredAt === 'string'
                            ? {
                                precision: 'day' as const,
                                date: specialEntitlementDateBounds(binding.occurredAt).day!,
                              }
                            : binding.occurredAt,
                        evidenceCaptureIds: [
                          ...new Set(binding.evidence.map(({ captureId }) => captureId)),
                        ].sort(),
                      })),
                    }
                  : {}),
                selection: bundle.selection,
                scope: 'retrospective_only' as const,
                historicalFeatureEligible: false as const,
              },
              status: 'proposed_not_admitted' as const,
            },
    };
  });
  // Never expose a usable mapping from a conflicting set, including its first claimant.
  const blocked = results.some((result) => result.status === 'blocked');
  if (blocked)
    results.forEach((result) => {
      result.proposedResolution = null;
    });
  const content = {
    schemaVersion: 'afl-trade-special-entitlement-reconciliation-review/v2' as const,
    candidateId: candidate.candidateId,
    bindingStatus: results.some((result) => result.status === 'blocked')
      ? ('blocked' as const)
      : ('candidate_bound' as const),
    results,
    scope: 'retrospective_only' as const,
    authorityVerified: false as const,
    awardAndActivationClaimsVerified: false as const,
    promotionEligible: false as const,
    persisted: false as const,
  };
  return { reviewId: createAflTradeContentAddress('special-entitlement-review', content), content };
}
