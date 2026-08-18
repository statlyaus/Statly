import type { DraftTradeAssetItem, DraftTradeDetail } from '@/lib/draftTrades/read';

import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  aflTradePrivateReviewedHpnCalculationSchema,
  type AflTradePrivateReviewedHpnCalculation,
} from '../modeling/privateReviewedHpnCalculation';
import type { AflTradeDevelopmentReconciledAcquisitionOutcome } from '../modeling/developmentWorkbookValueProjection';

export interface LocalPrivateReviewedPlayerIdentityEvidence {
  readonly sourcePlayerName?: string;
  readonly recordedName: string;
  readonly canonicalPlayerId: string;
  readonly identityDecisionIds: readonly string[];
  readonly reviewedSeasonIds: readonly string[];
}

interface AvailableView {
  readonly state: 'available';
  readonly score: number;
  readonly gamesPlayed: number;
  readonly seasons: readonly number[];
  readonly components: {
    readonly offensiveScore: number;
    readonly midfieldScore: number;
    readonly defensiveScore: number;
    readonly offensivePav: number;
    readonly midfieldPav: number;
    readonly defensivePav: number;
  };
  readonly calculationIds: readonly string[];
  readonly allocationIds: readonly string[];
}

interface UnavailableView {
  readonly state: 'unavailable';
  readonly reason:
    | 'reviewed_season_unavailable'
    | 'post_trade_season_unavailable'
    | 'no_reviewed_receiving_club_allocation'
    | 'predictive_model_not_authorized';
}

export type LocalPrivateReviewedPostTradeGames =
  | Readonly<{
      state: 'observed' | 'partial';
      gamesPlayed: number;
      effectiveThrough: string;
      source: 'reconciled_acquisition_spell';
      rightCensored: boolean;
    }>
  | Readonly<{ state: 'unavailable'; reason: 'reviewed_acquisition_outcome_unavailable' }>;

export type LocalPrivateReviewedTradeAssetCalculation =
  | Readonly<{
      asset: DraftTradeAssetItem;
      state: 'calculated';
      canonicalPlayerId: string;
      identityDecisionIds: readonly string[];
      reviewedSeasonIds: readonly string[];
      postTradeGames: LocalPrivateReviewedPostTradeGames;
      atTrade: AvailableView | UnavailableView;
      realized: AvailableView | UnavailableView;
      remaining: UnavailableView;
      current: AvailableView | UnavailableView;
    }>
  | Readonly<{
      asset: DraftTradeAssetItem;
      state: 'unavailable';
      reason:
        | 'player_identity_unavailable'
        | 'player_identity_ambiguous'
        | 'selection_lineage_not_reviewed'
        | 'asset_kind_unsupported';
    }>;

export interface LocalPrivateReviewedTradeCalculation {
  readonly projectionId: string;
  readonly tradeId: string;
  readonly workbookSha256: string;
  readonly methodId: string | null;
  readonly valueUnit: 'season_pav';
  readonly policy: {
    readonly atTrade: 'latest_reviewed_season_at_or_before_trade_year';
    readonly realized: 'reviewed_seasons_after_trade_year_at_receiving_club';
    readonly remaining: 'unavailable_without_authorized_predictive_model';
    readonly current: 'latest_reviewed_post_trade_season_at_receiving_club';
  };
  readonly assets: readonly LocalPrivateReviewedTradeAssetCalculation[];
  readonly clubTotals: null;
  readonly overallGrade: Readonly<{
    state: 'unavailable';
    reason: 'asset_values_incomplete_and_distribution_unavailable';
  }>;
  readonly limitation: string;
  readonly publicationEligible: false;
  readonly publicationProhibited: true;
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-AU');
}

function normalized(value: number): number {
  const result = Number(value.toFixed(12));
  if (!Number.isFinite(result)) throw new RangeError('Trade PAV aggregation became non-finite.');
  return result;
}

function availableView(
  allocations: ReadonlyArray<{
    calculation: AflTradePrivateReviewedHpnCalculation;
    allocation: AflTradePrivateReviewedHpnCalculation['content']['allocations'][number];
  }>
): AvailableView {
  const total = (field: keyof AvailableView['components'] | 'totalPav') =>
    normalized(
      allocations.reduce(
        (sum, { allocation }) => sum + (allocation[field] as number),
        0
      )
    );
  return {
    state: 'available',
    score: total('totalPav'),
    gamesPlayed: allocations.reduce(
      (sum, { allocation }) => sum + allocation.gamesPlayed,
      0
    ),
    seasons: [...new Set(allocations.map(({ calculation }) => calculation.content.seasonYear))].sort(
      (left, right) => left - right
    ),
    components: {
      offensiveScore: total('offensiveScore'),
      midfieldScore: total('midfieldScore'),
      defensiveScore: total('defensiveScore'),
      offensivePav: total('offensivePav'),
      midfieldPav: total('midfieldPav'),
      defensivePav: total('defensivePav'),
    },
    calculationIds: [
      ...new Set(allocations.map(({ calculation }) => calculation.calculationId)),
    ].sort(),
    allocationIds: allocations.map(({ allocation }) => allocation.allocationId).sort(),
  };
}

function allocationsFor(
  calculations: readonly AflTradePrivateReviewedHpnCalculation[],
  canonicalPlayerId: string,
  predicate: (calculation: AflTradePrivateReviewedHpnCalculation) => boolean,
  clubId?: string
) {
  return calculations.flatMap((calculation) =>
    predicate(calculation)
      ? calculation.content.allocations
          .filter(
            (allocation) =>
              allocation.identity.state === 'resolved' &&
              allocation.identity.canonicalPlayerId === canonicalPlayerId &&
              (clubId === undefined || allocation.clubId === clubId)
          )
          .map((allocation) => ({ calculation, allocation }))
      : []
  );
}

function projectPlayer(input: {
  asset: DraftTradeAssetItem;
  tradeYear: number;
  identities: readonly LocalPrivateReviewedPlayerIdentityEvidence[];
  calculations: readonly AflTradePrivateReviewedHpnCalculation[];
  outcome: AflTradeDevelopmentReconciledAcquisitionOutcome | undefined;
}): LocalPrivateReviewedTradeAssetCalculation {
  const recordedName = input.asset.playerName?.trim();
  if (!recordedName) {
    return { asset: input.asset, state: 'unavailable', reason: 'player_identity_unavailable' };
  }
  const matching = input.identities.filter(
    ({ sourcePlayerName, recordedName: candidate }) =>
      normalizeName(sourcePlayerName ?? candidate) === normalizeName(recordedName)
  );
  const canonicalIds = [...new Set(matching.map(({ canonicalPlayerId }) => canonicalPlayerId))];
  if (canonicalIds.length === 0) {
    return { asset: input.asset, state: 'unavailable', reason: 'player_identity_unavailable' };
  }
  if (canonicalIds.length !== 1) {
    return { asset: input.asset, state: 'unavailable', reason: 'player_identity_ambiguous' };
  }
  const canonicalPlayerId = canonicalIds[0]!;
  const atTradeSeasons = input.calculations
    .map(({ content }) => content.seasonYear)
    .filter((season) => season <= input.tradeYear);
  const atTradeSeason = atTradeSeasons.length > 0 ? Math.max(...atTradeSeasons) : null;
  const atTradeAllocations =
    atTradeSeason === null
      ? []
      : allocationsFor(
          input.calculations,
          canonicalPlayerId,
          ({ content }) => content.seasonYear === atTradeSeason
        );
  const receivingClubId = `local-afl-club:${input.asset.clubSlug}`;
  const realizedAllocations = allocationsFor(
    input.calculations,
    canonicalPlayerId,
    ({ content }) => content.seasonYear > input.tradeYear,
    receivingClubId
  );
  const postTradeSeasons = input.calculations
    .map(({ content }) => content.seasonYear)
    .filter((season) => season > input.tradeYear);
  const currentSeason = postTradeSeasons.length > 0 ? Math.max(...postTradeSeasons) : null;
  const currentAllocations =
    currentSeason === null
      ? []
      : allocationsFor(
          input.calculations,
          canonicalPlayerId,
          ({ content }) => content.seasonYear === currentSeason,
          receivingClubId
        );
  const postTradeUnavailable: UnavailableView = {
    state: 'unavailable',
    reason:
      postTradeSeasons.length === 0
        ? 'post_trade_season_unavailable'
        : 'no_reviewed_receiving_club_allocation',
  };
  const games = input.outcome?.metrics.games;
  const postTradeGames: LocalPrivateReviewedPostTradeGames =
    games?.state === 'observed'
      ? {
          state: 'observed',
          gamesPlayed: games.value,
          effectiveThrough: input.outcome!.effectiveThrough,
          source: 'reconciled_acquisition_spell',
          rightCensored: false,
        }
      : games?.state === 'partial'
        ? {
            state: 'partial',
            gamesPlayed: games.observedValue,
            effectiveThrough: input.outcome!.effectiveThrough,
            source: 'reconciled_acquisition_spell',
            rightCensored: true,
          }
        : { state: 'unavailable', reason: 'reviewed_acquisition_outcome_unavailable' };
  return {
    asset: input.asset,
    state: 'calculated',
    canonicalPlayerId,
    identityDecisionIds: [...new Set(matching.flatMap(({ identityDecisionIds }) => identityDecisionIds))].sort(),
    reviewedSeasonIds: [...new Set(matching.flatMap(({ reviewedSeasonIds }) => reviewedSeasonIds))].sort(),
    postTradeGames,
    atTrade:
      atTradeAllocations.length > 0
        ? availableView(atTradeAllocations)
        : { state: 'unavailable', reason: 'reviewed_season_unavailable' },
    realized:
      realizedAllocations.length > 0 ? availableView(realizedAllocations) : postTradeUnavailable,
    remaining: { state: 'unavailable', reason: 'predictive_model_not_authorized' },
    current:
      currentAllocations.length > 0 ? availableView(currentAllocations) : postTradeUnavailable,
  };
}

export function projectLocalPrivateReviewedTradeCalculation(input: Readonly<{
  detail: DraftTradeDetail;
  workbookSha256: string;
  identities: readonly LocalPrivateReviewedPlayerIdentityEvidence[];
  calculations: readonly unknown[];
  outcomesByAssetId?: ReadonlyMap<string, AflTradeDevelopmentReconciledAcquisitionOutcome>;
}>): LocalPrivateReviewedTradeCalculation {
  if (!/^[a-f0-9]{64}$/u.test(input.workbookSha256)) {
    throw new TypeError('Private trade calculation requires the pinned workbook digest.');
  }
  const calculations = input.calculations
    .map((calculation) => aflTradePrivateReviewedHpnCalculationSchema.parse(calculation))
    .sort((left, right) => left.content.seasonYear - right.content.seasonYear);
  const methodIds = [...new Set(calculations.map(({ content }) => content.methodId))];
  if (methodIds.length > 1) throw new TypeError('Trade calculations cannot mix HPN methods.');
  const assets = input.detail.assets.map((asset) => {
    if (asset.assetType === 'player') {
      return projectPlayer({
        asset,
        tradeYear: input.detail.trade.year,
        identities: input.identities,
        calculations,
        outcome: input.outcomesByAssetId?.get(asset.id),
      });
    }
    if (asset.assetType === 'pick' || asset.assetType === 'future_pick') {
      return { asset, state: 'unavailable', reason: 'selection_lineage_not_reviewed' } as const;
    }
    return { asset, state: 'unavailable', reason: 'asset_kind_unsupported' } as const;
  });
  const content = {
    tradeId: input.detail.trade.tradeId,
    workbookSha256: input.workbookSha256,
    methodId: methodIds[0] ?? null,
    valueUnit: 'season_pav' as const,
    policy: {
      atTrade: 'latest_reviewed_season_at_or_before_trade_year' as const,
      realized: 'reviewed_seasons_after_trade_year_at_receiving_club' as const,
      remaining: 'unavailable_without_authorized_predictive_model' as const,
      current: 'latest_reviewed_post_trade_season_at_receiving_club' as const,
    },
    assets,
    clubTotals: null,
    overallGrade: {
      state: 'unavailable' as const,
      reason: 'asset_values_incomplete_and_distribution_unavailable' as const,
    },
    limitation:
      'Private reviewed historical season PAV only; pick values, remaining value, predictive distributions, letter grades, publication, and production use remain unavailable.',
    publicationEligible: false as const,
    publicationProhibited: true as const,
  };
  return {
    projectionId: createAflTradeContentAddress('local-private-trade-calculation', content),
    ...content,
  };
}
