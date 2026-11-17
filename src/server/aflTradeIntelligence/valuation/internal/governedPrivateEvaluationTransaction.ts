import {
  governedPrivateEvaluationInputTraceSchema,
  type GovernedPrivateEvaluationInputTrace,
} from './governedPrivateEvaluationInputTrace';

type ExplanationAssetKind = 'player' | 'current_pick' | 'future_pick';

export interface GovernedPrivateEvaluationDirectedTransfer {
  readonly transferId: string;
  readonly assetId: string;
  readonly assetKind: ExplanationAssetKind;
  readonly fromClubId: string;
  readonly toClubId: string;
  readonly displayLabel: string;
  readonly directionBasis: 'archive_recorded_transfer';
}

export interface GovernedPrivateEvaluationClubBank {
  readonly aflClubId: string;
  readonly clubName: string;
  readonly receivedAssetIds: readonly string[];
  readonly givenUpAssetIds: readonly string[];
}

function explanationAssetKind(
  value: GovernedPrivateEvaluationInputTrace['content']['transaction']['transfers'][number]['assetKind']
): ExplanationAssetKind {
  if (value === 'current_pick_entitlement') return 'current_pick';
  if (value === 'future_pick_entitlement') return 'future_pick';
  return 'player';
}

export function deriveGovernedPrivateEvaluationTransaction(unparsedTrace: unknown) {
  const trace = governedPrivateEvaluationInputTraceSchema.parse(unparsedTrace);
  const transfers: readonly GovernedPrivateEvaluationDirectedTransfer[] =
    trace.content.transaction.transfers.map((transfer) => ({
      transferId: transfer.transferId,
      assetId: transfer.assetId,
      assetKind: explanationAssetKind(transfer.assetKind),
      fromClubId: transfer.fromClubId,
      toClubId: transfer.toClubId,
      displayLabel: transfer.displayLabel,
      directionBasis: 'archive_recorded_transfer',
    }));
  const clubs: readonly GovernedPrivateEvaluationClubBank[] =
    trace.content.transaction.clubs.map((club) => ({
      aflClubId: club.aflClubId,
      clubName: club.clubName,
      receivedAssetIds: transfers
        .filter(({ toClubId }) => toClubId === club.aflClubId)
        .map(({ assetId }) => assetId)
        .sort(),
      givenUpAssetIds: transfers
        .filter(({ fromClubId }) => fromClubId === club.aflClubId)
        .map(({ assetId }) => assetId)
        .sort(),
    }));
  if (
    clubs.some(
      ({ receivedAssetIds, givenUpAssetIds }) =>
        receivedAssetIds.length === 0 || givenUpAssetIds.length === 0
    )
  ) {
    throw new TypeError(
      'A complete governed transaction requires every club to receive and give up an asset.'
    );
  }
  return {
    selector: trace.content.selector,
    effectiveAt: trace.content.transaction.effectiveAt,
    clubs,
    transfers,
  };
}
