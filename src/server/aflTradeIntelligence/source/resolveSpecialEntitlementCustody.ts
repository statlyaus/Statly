import { z } from 'zod';
import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import { specialEntitlementAwardSchema } from './specialEntitlementAwardContracts';
import {
  createAflTradeExternalReconciliationCandidate,
  parseAflTradeExternalReconciliationCandidate,
} from './externalReconciliationCandidateContracts';

const bindingSchema = z
  .object({
    transferId: aflTradeContentAddressedIdSchema('external-transfer'),
    award: specialEntitlementAwardSchema,
    awardApprovalDecisionId: z.string().min(1),
    predecessorTransferId: aflTradeContentAddressedIdSchema('external-transfer').nullable(),
  })
  .strict();

/** Retain the source candidate; the resulting candidate still needs independent reviewed promotion. */
export function resolveSpecialEntitlementCustody(input: {
  candidate: unknown;
  bindings: readonly unknown[];
  reconciledAt: string;
}) {
  const source = parseAflTradeExternalReconciliationCandidate(input.candidate);
  const bindings = z.array(bindingSchema).min(1).max(10000).parse(input.bindings);
  const byId = new Map(bindings.map((binding) => [binding.transferId, binding]));
  if (byId.size !== bindings.length)
    throw new TypeError('Each transfer requires one unique award binding.');
  const resolved = new Set<string>();
  const transfers = source.content.transfers.map((transfer) => {
    const binding = byId.get(transfer.transferId);
    if (!binding) return transfer;
    if (
      transfer.status === 'disputed' ||
      !transfer.fromClubId ||
      !transfer.toClubId ||
      !['special_pick', 'pick_entitlement'].includes(transfer.asset.kind) ||
      binding.award.content.competition !== source.content.competition ||
      binding.award.content.environment !== source.content.environment ||
      binding.predecessorTransferId === transfer.transferId
    ) {
      throw new TypeError('Award resolution requires undisputed source custody and exact scope.');
    }
    if (transfer.asset.kind !== 'special_pick' && transfer.asset.kind !== 'pick_entitlement') {
      throw new TypeError(
        'Only an unresolved source right or source pick can be linked to an award.'
      );
    }
    if (
      transfer.asset.kind === 'special_pick' &&
      JSON.stringify(transfer.asset) !== JSON.stringify(binding.award.content.asset)
    ) {
      throw new TypeError('Source special entitlement differs from the reviewed award component.');
    }
    resolved.add(transfer.transferId);
    return {
      ...transfer,
      status: 'single_source' as const,
      asset: {
        kind: 'special_entitlement' as const,
        entitlementId: binding.award.entitlementId,
        awardApprovalDecisionId: binding.awardApprovalDecisionId,
        sourceCandidateId: source.candidateId,
        sourceAsset: transfer.asset,
        predecessorTransferId: binding.predecessorTransferId,
      },
    };
  });
  if (resolved.size !== bindings.length)
    throw new TypeError('Award bindings must identify existing source transfers.');
  if (Date.parse(input.reconciledAt) < Date.parse(source.content.reconciledAt))
    throw new TypeError('Resolution cannot predate its source candidate.');
  return createAflTradeExternalReconciliationCandidate({
    ...source.content,
    transfers,
    // Any former ordinary-pick exercise remains in the retained source candidate, pending the
    // separate retrospective exercise owner; it cannot price the special right as an ordinary pick.
    pickLineage: source.content.pickLineage.filter((edge) => !resolved.has(edge.transferId)),
    issues: source.content.issues.filter(
      (issue) =>
        !(
          issue.code === 'lineage_unresolved' &&
          [...resolved].some((transferId) => issue.subjectKey === `lineage:${transferId}`)
        )
    ),
    reconciledAt: input.reconciledAt,
  });
}
