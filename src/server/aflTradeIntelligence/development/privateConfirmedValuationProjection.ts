import type { DraftTradeDetail } from '@/lib/draftTrades/read';

import type { AflTradePrivateConfirmedValuationResultV2 } from '../valuation/privateConfirmedTradeValuationContracts';
import type {
  LocalPrivateReviewedTradeAssetCalculation,
  LocalPrivateReviewedTradeCalculation,
} from './localPrivateReviewedTradeCalculation';

function unavailableAssetReason(
  assetKind: AflTradePrivateConfirmedValuationResultV2['content']['assets'][number]['assetKind']
): Extract<LocalPrivateReviewedTradeAssetCalculation, { state: 'unavailable' }>['reason'] {
  return assetKind === 'player'
    ? 'player_identity_unavailable'
    : assetKind === 'pick' || assetKind === 'future_pick'
      ? 'selection_lineage_not_reviewed'
      : 'asset_kind_unsupported';
}

export function projectPrivateConfirmedValuationResult(input: Readonly<{
  detail: DraftTradeDetail;
  authenticatedWorkbookSha256: string;
  result: AflTradePrivateConfirmedValuationResultV2;
}>): LocalPrivateReviewedTradeCalculation {
  if (
    !/^[a-f0-9]{64}$/u.test(input.authenticatedWorkbookSha256) ||
    input.result.content.tradeId !== input.detail.trade.tradeId ||
    input.result.content.publicationEligible !== false ||
    input.result.content.publicationProhibited !== true
  ) {
    throw new TypeError('Private confirmed valuation projection failed its workbook boundary.');
  }
  const resultByAssetId = new Map(
    input.result.content.assets.map((asset) => [asset.assetId, asset] as const)
  );
  if (
    resultByAssetId.size !== input.detail.assets.length ||
    input.detail.assets.some(({ id }) => !resultByAssetId.has(id))
  ) {
    throw new TypeError('Private confirmed valuation result does not classify the exact workbook trade.');
  }
  const methodIds = new Set<string>();
  const assets = input.detail.assets.map<LocalPrivateReviewedTradeAssetCalculation>((asset) => {
    const resultAsset = resultByAssetId.get(asset.id)!;
    if (resultAsset.canonicalPlayerId === null) {
      return {
        asset,
        state: 'unavailable',
        reason: unavailableAssetReason(resultAsset.assetKind),
      };
    }
    const postTradeGames =
      resultAsset.appearances.state === 'observed'
        ? ({
            state:
              resultAsset.appearances.coverage === 'right_censored'
                ? ('partial' as const)
                : ('observed' as const),
            gamesPlayed: resultAsset.appearances.gamesPlayed,
            effectiveThrough: input.result.content.knowledgeCutoffAt,
            effectiveThroughSeason: resultAsset.appearances.effectiveThroughSeason,
            source: 'reconciled_acquisition_spell' as const,
            rightCensored: resultAsset.appearances.coverage === 'right_censored',
          } as const)
        : ({
            state: 'unavailable' as const,
            reason: 'reviewed_acquisition_outcome_unavailable' as const,
          } as const);
    const realized =
      resultAsset.realizedPav.state === 'calculated'
        ? (() => {
            if (resultAsset.appearances.state !== 'observed') {
              throw new TypeError(
                'Calculated realized PAV cannot be projected without observed appearances.'
              );
            }
            methodIds.add(resultAsset.realizedPav.methodId);
            return {
              state: 'available' as const,
              score: resultAsset.realizedPav.score,
              gamesPlayed: resultAsset.appearances.gamesPlayed,
              seasons: resultAsset.realizedPav.seasons,
              components: resultAsset.realizedPav.components,
              calculationIds: resultAsset.realizedPav.calculationArtifacts.map(
                ({ artifactId }) => artifactId
              ),
              allocationIds: [],
            };
          })()
        : ({
            state: 'unavailable' as const,
            reason:
              resultAsset.appearances.state === 'observed'
                ? ('no_reviewed_receiving_club_allocation' as const)
                : ('reviewed_acquisition_spell_unavailable' as const),
          } as const);
    return {
      asset,
      state: 'calculated',
      canonicalPlayerId: resultAsset.canonicalPlayerId,
      identityDecisionIds: [],
      reviewedSeasonIds: [],
      postTradeGames,
      atTrade: {
        state: 'unavailable',
        reason:
          resultAsset.assetKind === 'pick'
            ? 'selection_value_model_not_authorized'
            : 'historical_value_model_not_authorized',
      },
      realized,
      remaining: { state: 'unavailable', reason: 'predictive_model_not_authorized' },
      current: { state: 'unavailable', reason: 'predictive_model_not_authorized' },
    };
  });
  if (methodIds.size > 1) {
    throw new TypeError('Private confirmed valuation result mixes calculation methods.');
  }
  return {
    projectionId: input.result.resultId,
    tradeId: input.result.content.tradeId,
    workbookSha256: input.authenticatedWorkbookSha256,
    methodId: [...methodIds][0] ?? null,
    valueUnit: 'season_pav',
    policy: {
      atTrade: 'unavailable_without_authorized_historical_value_model',
      realized: 'reviewed_seasons_after_trade_year_at_receiving_club',
      remaining: 'unavailable_without_authorized_predictive_model',
      current: 'unavailable_without_authorized_predictive_model',
    },
    assets,
    clubTotals: null,
    overallGrade: {
      state: 'unavailable',
      reason: 'asset_values_incomplete_and_distribution_unavailable',
    },
    limitation: input.result.content.limitation,
    publicationEligible: false,
    publicationProhibited: true,
  };
}
