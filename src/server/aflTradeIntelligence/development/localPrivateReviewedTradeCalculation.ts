import type { DraftTradeAssetItem, DraftTradeDetail } from '@/lib/draftTrades/read';

import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  aflTradePrivateReviewedHpnCalculationSchema,
  type AflTradePrivateReviewedHpnCalculation,
} from '../modeling/privateReviewedHpnCalculation';
import type { AflTradeDevelopmentReconciledAcquisitionOutcome } from '../modeling/developmentWorkbookValueProjection';
import type { LocalPrivateTradeEvaluationGeneration } from '../valuation/localPrivateTradeEvaluationContracts';

export interface LocalPrivateReviewedPlayerIdentityEvidence {
  readonly sourcePlayerName?: string;
  readonly recordedName: string;
  readonly canonicalPlayerId: string;
  readonly identityDecisionIds: readonly string[];
  readonly reviewedSeasonIds: readonly string[];
}

export interface LocalPrivateReviewedSelectionLineageEvidence {
  readonly assetId: string;
  readonly draftYear: number;
  readonly selectionNumber: number;
  readonly draftedPlayerName: string;
  readonly recordedName: string;
  readonly canonicalPlayerId: string;
  readonly selectionDecisionId: string;
  readonly identityDecisionIds: readonly string[];
  readonly reviewedSeasonIds: readonly string[];
}

/**
 * A separately authenticated bridge from the traded pick root to the selected player's later
 * acquisition. Selection identity alone cannot supply these facts.
 */
export interface LocalGovernedPickRealizationEvidence {
  readonly rootAssetId: string;
  readonly selectionNumber: number;
  readonly canonicalPlayerId: string;
  readonly draftSelectionId: string;
  readonly lineageEdgeIds: readonly string[];
  readonly acquisitionEventId: string;
  readonly acquisitionAssetVersionId: string;
  readonly receivingClubId: string;
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
    | 'reviewed_acquisition_spell_unavailable'
    | 'reviewed_acquisition_spell_allocation_mismatch'
    | 'historical_value_model_not_authorized'
    | 'selection_value_model_not_authorized'
    | 'predictive_model_not_authorized';
}

export type LocalPrivateReviewedPostTradeGames =
  | Readonly<{
      state: 'observed' | 'partial';
      gamesPlayed: number;
      effectiveThrough: string;
      effectiveThroughSeason?: number;
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
      selectionLineageDecisionId?: string;
      governedPickRealization?: LocalGovernedPickRealizationEvidence;
      postTradeGames: LocalPrivateReviewedPostTradeGames;
      atTrade: UnavailableView;
      realized: AvailableView | UnavailableView;
      remaining: UnavailableView;
      current: UnavailableView;
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
  readonly generation?: LocalPrivateTradeEvaluationGeneration;
  readonly projectionId: string;
  readonly tradeId: string;
  readonly workbookSha256: string;
  readonly methodId: string | null;
  readonly valueUnit: 'season_pav';
  readonly policy: {
    readonly atTrade: 'unavailable_without_authorized_historical_value_model';
    readonly realized: 'reviewed_seasons_after_trade_year_at_receiving_club';
    readonly remaining: 'unavailable_without_authorized_predictive_model';
    readonly current: 'unavailable_without_authorized_predictive_model';
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

function postTradeGamesFor(
  outcome: AflTradeDevelopmentReconciledAcquisitionOutcome | undefined
): LocalPrivateReviewedPostTradeGames {
  if (outcome === undefined) {
    return { state: 'unavailable', reason: 'reviewed_acquisition_outcome_unavailable' };
  }
  const games = outcome.metrics.games;
  return games?.state === 'observed'
    ? {
        state: 'observed',
        gamesPlayed: games.value,
        effectiveThrough: outcome.effectiveThrough,
        source: 'reconciled_acquisition_spell',
        rightCensored: false,
      }
    : games?.state === 'partial'
      ? {
          state: 'partial',
          gamesPlayed: games.observedValue,
          effectiveThrough: outcome.effectiveThrough,
          source: 'reconciled_acquisition_spell',
          rightCensored: true,
        }
      : { state: 'unavailable', reason: 'reviewed_acquisition_outcome_unavailable' };
}

function realizedSpellView(
  allocations: Parameters<typeof availableView>[0],
  outcome: AflTradeDevelopmentReconciledAcquisitionOutcome | undefined,
  postTradeGames: LocalPrivateReviewedPostTradeGames,
  expected: {
    acquisitionEventId: string;
    startAssetVersionId?: string;
    canonicalPlayerId: string;
    receivingClubId: string;
  },
  fallback: UnavailableView
): AvailableView | UnavailableView {
  if (postTradeGames.state === 'unavailable' || outcome?.exactMatchSet === undefined) {
    return { state: 'unavailable', reason: 'reviewed_acquisition_spell_unavailable' };
  }
  if (allocations.length === 0) return fallback;
  const exact = outcome.exactMatchSet;
  if (
    exact.acquisitionEventId !== expected.acquisitionEventId ||
    (expected.startAssetVersionId !== undefined &&
      exact.startAssetVersionId !== expected.startAssetVersionId) ||
    exact.canonicalPlayerId !== expected.canonicalPlayerId ||
    exact.receivingClubId !== expected.receivingClubId
  ) {
    return { state: 'unavailable', reason: 'reviewed_acquisition_spell_allocation_mismatch' };
  }
  const allocationRowsBySeason = new Map<number, string[]>();
  for (const { calculation, allocation } of allocations) {
    const sourceRows = allocationRowsBySeason.get(calculation.content.seasonYear) ?? [];
    sourceRows.push(...allocation.sourceRowIds);
    allocationRowsBySeason.set(calculation.content.seasonYear, sourceRows);
  }
  const exactRowsBySeason = new Map(
    exact.seasons.map(({ seasonYear, providerDecodedRowIds }) => [
      seasonYear,
      [...providerDecodedRowIds].sort(),
    ])
  );
  const allocationSeasons = [...allocationRowsBySeason.keys()].sort((left, right) => left - right);
  const exactSeasons = [...exactRowsBySeason.keys()].sort((left, right) => left - right);
  const matchSetAgrees =
    new Set(exact.seasons.map(({ seasonYear }) => seasonYear)).size === exact.seasons.length &&
    allocationSeasons.length === exactSeasons.length &&
    allocationSeasons.every((seasonYear, index) => {
      if (seasonYear !== exactSeasons[index]) return false;
      const allocationRows = [...new Set(allocationRowsBySeason.get(seasonYear) ?? [])].sort();
      const exactRows = exactRowsBySeason.get(seasonYear) ?? [];
      return (
        allocationRows.length === exactRows.length &&
        allocationRows.every((rowId, rowIndex) => rowId === exactRows[rowIndex])
      );
    });
  const exactGameCount = exact.seasons.reduce(
    (sum, { providerDecodedRowIds }) => sum + new Set(providerDecodedRowIds).size,
    0
  );
  return matchSetAgrees && exactGameCount === postTradeGames.gamesPlayed
    ? availableView(allocations)
    : { state: 'unavailable', reason: 'reviewed_acquisition_spell_allocation_mismatch' };
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
  const reviewedSeasonIds = new Set(matching.flatMap(({ reviewedSeasonIds }) => reviewedSeasonIds));
  const eligibleCalculations = input.calculations.filter(({ content }) =>
    reviewedSeasonIds.has(content.reviewedSeasonId)
  );
  const receivingClubId = `local-afl-club:${input.asset.clubSlug}`;
  const realizedAllocations = allocationsFor(
    eligibleCalculations,
    canonicalPlayerId,
    ({ content }) => content.seasonYear > input.tradeYear,
    receivingClubId
  );
  const postTradeSeasons = eligibleCalculations
    .map(({ content }) => content.seasonYear)
    .filter((season) => season > input.tradeYear);
  const postTradeUnavailable: UnavailableView = {
    state: 'unavailable',
    reason:
      postTradeSeasons.length === 0
        ? 'post_trade_season_unavailable'
        : 'no_reviewed_receiving_club_allocation',
  };
  const postTradeGames = postTradeGamesFor(input.outcome);
  return {
    asset: input.asset,
    state: 'calculated',
    canonicalPlayerId,
    identityDecisionIds: [...new Set(matching.flatMap(({ identityDecisionIds }) => identityDecisionIds))].sort(),
    reviewedSeasonIds: [...new Set(matching.flatMap(({ reviewedSeasonIds }) => reviewedSeasonIds))].sort(),
    postTradeGames,
    atTrade: { state: 'unavailable', reason: 'historical_value_model_not_authorized' },
    realized: realizedSpellView(
      realizedAllocations,
      input.outcome,
      postTradeGames,
      {
        acquisitionEventId: input.asset.id,
        canonicalPlayerId,
        receivingClubId,
      },
      postTradeUnavailable
    ),
    remaining: { state: 'unavailable', reason: 'predictive_model_not_authorized' },
    current: { state: 'unavailable', reason: 'predictive_model_not_authorized' },
  };
}

function projectSelection(input: {
  asset: DraftTradeAssetItem;
  tradeYear: number;
  selections: readonly LocalPrivateReviewedSelectionLineageEvidence[];
  pickRealizations: readonly LocalGovernedPickRealizationEvidence[];
  calculations: readonly AflTradePrivateReviewedHpnCalculation[];
  outcome: AflTradeDevelopmentReconciledAcquisitionOutcome | undefined;
}): LocalPrivateReviewedTradeAssetCalculation {
  const matching = input.selections.filter(
    (selection) =>
      selection.assetId === input.asset.id &&
      selection.draftYear === input.asset.year &&
      selection.selectionNumber === input.asset.pick.numberActual &&
      input.asset.draftedPlayer !== null &&
      normalizeName(selection.draftedPlayerName) === normalizeName(input.asset.draftedPlayer)
  );
  if (matching.length !== 1) {
    return {
      asset: input.asset,
      state: 'unavailable',
      reason: 'selection_lineage_not_reviewed',
    };
  }
  const selection = matching[0]!;
  const matchingRealizations = input.pickRealizations.filter(
    (realization) =>
      realization.rootAssetId === input.asset.id &&
      realization.selectionNumber === selection.selectionNumber &&
      realization.canonicalPlayerId === selection.canonicalPlayerId &&
      realization.draftSelectionId.length > 0 &&
      realization.lineageEdgeIds.length > 0 &&
      realization.acquisitionEventId.length > 0 &&
      realization.acquisitionEventId !== realization.rootAssetId &&
      realization.acquisitionAssetVersionId.length > 0 &&
      realization.receivingClubId.length > 0
  );
  const realization = matchingRealizations.length === 1 ? matchingRealizations[0] : undefined;
  const reviewedSeasonIds = new Set(selection.reviewedSeasonIds);
  const eligibleCalculations = input.calculations.filter(({ content }) =>
    reviewedSeasonIds.has(content.reviewedSeasonId)
  );
  const receivingClubId = realization?.receivingClubId;
  const postTradeSeasons = eligibleCalculations
    .map(({ content }) => content.seasonYear)
    .filter((season) => season > input.tradeYear);
  const realizedAllocations =
    receivingClubId === undefined
      ? []
      : allocationsFor(
          eligibleCalculations,
          selection.canonicalPlayerId,
          ({ content }) => content.seasonYear > input.tradeYear,
          receivingClubId
        );
  const postTradeUnavailable: UnavailableView = {
    state: 'unavailable',
    reason:
      postTradeSeasons.length === 0
        ? 'post_trade_season_unavailable'
        : 'no_reviewed_receiving_club_allocation',
  };
  const governedOutcome = realization === undefined ? undefined : input.outcome;
  const postTradeGames = postTradeGamesFor(governedOutcome);
  return {
    asset: input.asset,
    state: 'calculated',
    canonicalPlayerId: selection.canonicalPlayerId,
    identityDecisionIds: [...selection.identityDecisionIds].sort(),
    reviewedSeasonIds: [...selection.reviewedSeasonIds].sort(),
    selectionLineageDecisionId: selection.selectionDecisionId,
    ...(realization === undefined ? {} : { governedPickRealization: realization }),
    postTradeGames,
    atTrade: { state: 'unavailable', reason: 'selection_value_model_not_authorized' },
    realized: realizedSpellView(
      realizedAllocations,
      governedOutcome,
      postTradeGames,
      {
        acquisitionEventId: realization?.acquisitionEventId ?? '',
        startAssetVersionId: realization?.acquisitionAssetVersionId,
        canonicalPlayerId: selection.canonicalPlayerId,
        receivingClubId: receivingClubId ?? '',
      },
      postTradeUnavailable
    ),
    remaining: { state: 'unavailable', reason: 'predictive_model_not_authorized' },
    current: { state: 'unavailable', reason: 'predictive_model_not_authorized' },
  };
}

export function projectLocalPrivateReviewedTradeCalculation(input: Readonly<{
  detail: DraftTradeDetail;
  workbookSha256: string;
  identities: readonly LocalPrivateReviewedPlayerIdentityEvidence[];
  selections?: readonly LocalPrivateReviewedSelectionLineageEvidence[];
  pickRealizations?: readonly LocalGovernedPickRealizationEvidence[];
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
    if (asset.assetType === 'pick') {
      return projectSelection({
        asset,
        tradeYear: input.detail.trade.year,
        selections: input.selections ?? [],
        pickRealizations: input.pickRealizations ?? [],
        calculations,
        outcome: input.outcomesByAssetId?.get(asset.id),
      });
    }
    if (asset.assetType === 'future_pick') {
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
      atTrade: 'unavailable_without_authorized_historical_value_model' as const,
      realized: 'reviewed_seasons_after_trade_year_at_receiving_club' as const,
      remaining: 'unavailable_without_authorized_predictive_model' as const,
      current: 'unavailable_without_authorized_predictive_model' as const,
    },
    assets,
    clubTotals: null,
    overallGrade: {
      state: 'unavailable' as const,
      reason: 'asset_values_incomplete_and_distribution_unavailable' as const,
    },
    limitation:
      'Private reviewed realized season PAV only; at-trade value, remaining value, current value, predictive distributions, letter grades, publication, and production use remain unavailable.',
    publicationEligible: false as const,
    publicationProhibited: true as const,
  };
  return {
    projectionId: createAflTradeContentAddress('local-private-trade-calculation', content),
    ...content,
  };
}
