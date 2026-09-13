import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import { parseAflTradeExternalReconciliationCandidate } from './externalReconciliationCandidateContracts';
import { buildReviewedLineageCorrectionGraph } from './reviewedLineageCorrectionGraph';
import { reviewedPickLineageRegistrationSchema } from './reviewedPickLineageRegistrationContracts';
import { specialEntitlementAwardSchema } from './specialEntitlementAwardContracts';

/** Build the existing award-resolution owner's inputs without substituting ordinary pick identities. */
export function buildReviewedSpecialCustodyBindings(input: {
  candidate: unknown;
  registration: unknown;
  awards: readonly { award: unknown; approvalDecisionId: string }[];
}) {
  const candidate = parseAflTradeExternalReconciliationCandidate(input.candidate);
  const registration = reviewedPickLineageRegistrationSchema.parse(input.registration);
  if (
    !candidate.content.reviewedCorrection ||
    candidate.content.reviewedScope?.registrationId !== registration.registrationId ||
    candidate.content.environment !== registration.content.environment
  )
    throw new TypeError(
      'Special custody requires the exact registered ordinary-correction successor.'
    );
  const graph = buildReviewedLineageCorrectionGraph(registration.content.records);
  if (candidate.content.reviewedCorrection.correctionGraphId !== graph.correctionGraphId)
    throw new TypeError('Special custody must preserve the registered correction graph.');
  const transfers = new Map(candidate.content.transfers.map((t) => [t.transferId, t]));
  const awards = input.awards.map((value) => ({
    ...value,
    award: specialEntitlementAwardSchema.parse(value.award),
  }));
  const histories = graph.content.chains.filter((chain) =>
    chain.transferIds.some((id) => transfers.get(id)?.asset.kind === 'special_pick')
  );
  const usedAwards = new Set<string>();
  const bindings: {
    transferId: string;
    award: ReturnType<typeof specialEntitlementAwardSchema.parse>;
    awardApprovalDecisionId: string;
    predecessorTransferId: string | null;
  }[] = [];
  for (const chain of histories) {
    const sourceAssets = chain.transferIds.flatMap((id) => {
      const asset = transfers.get(id)?.asset;
      return asset?.kind === 'special_pick' ? [asset] : [];
    });
    if (new Set(sourceAssets.map(canonicalizeAflTradeJson)).size !== 1)
      throw new TypeError('A special history must retain one exact award component.');
    const first = graph.content.movements.find((m) => m.movementId === chain.movementIds[0])!;
    const matches = awards.filter(
      ({ award }) =>
        award.content.environment === candidate.content.environment &&
        award.content.competition === candidate.content.competition &&
        award.content.holderClubId === first.fromClubId &&
        canonicalizeAflTradeJson(award.content.asset) === canonicalizeAflTradeJson(sourceAssets[0])
    );
    if (
      matches.length !== 1 ||
      !matches[0].approvalDecisionId.trim() ||
      usedAwards.has(matches[0].award.entitlementId)
    )
      throw new TypeError(
        'Every special history requires one distinct registered award and approval.'
      );
    const reviewed = matches[0];
    usedAwards.add(reviewed.award.entitlementId);
    let predecessorTransferId: string | null = null;
    for (const movementId of chain.movementIds) {
      const movement = graph.content.movements.find((m) => m.movementId === movementId)!;
      const roots = movement.transferIds.filter((id) => chain.transferIds.includes(id));
      if (roots.length !== 1)
        throw new TypeError(
          'Special custody requires each movement to have one retained candidate transfer.'
        );
      const transfer = transfers.get(roots[0]);
      if (
        !transfer ||
        transfer.fromClubId !== movement.fromClubId ||
        transfer.toClubId !== movement.toClubId ||
        !['pick_entitlement', 'special_pick'].includes(transfer.asset.kind)
      )
        throw new TypeError(
          'Registered special custody differs from the retained directed transfer.'
        );
      bindings.push({
        transferId: transfer.transferId,
        award: reviewed.award,
        awardApprovalDecisionId: reviewed.approvalDecisionId,
        predecessorTransferId,
      });
      predecessorTransferId = transfer.transferId;
    }
  }
  if (usedAwards.size !== awards.length)
    throw new TypeError('Unrelated awards cannot enter reviewed special custody.');
  const covered = bindings.map((b) => b.transferId).sort();
  const expected = histories.flatMap((h) => h.transferIds).sort();
  if (canonicalizeAflTradeJson(covered) !== canonicalizeAflTradeJson(expected))
    throw new TypeError('Special custody must cover every registered transfer exactly once.');
  return {
    bindings,
    historyCount: histories.length,
    transferIds: covered,
    canonicalAdmission: false as const,
  };
}
