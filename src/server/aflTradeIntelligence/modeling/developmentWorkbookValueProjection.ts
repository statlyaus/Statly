import { createHash } from 'node:crypto';

import type { AflTradeDevelopmentGradeDatasetContent } from './developmentTradeGradeDataset';
import { createAflTradeDevelopmentGradeDataset } from './developmentTradeGradeDataset';
import {
  createAflTradeDevelopmentGradeModel,
  valueAflTradeDevelopmentTrade,
  type AflTradeDevelopmentGradeModel,
  type AflTradeDevelopmentTradeValueResult,
} from './developmentTradeGradeModel';
import {
  deriveAflTradeStatlyGrades,
  type AflTradeStatlyGradeResult,
} from '../valuation/statlyGradePolicy';
import type {
  AflOutcomesDevelopmentAcquisitionItem,
  AflOutcomesDevelopmentAcquisitionProjection,
} from '../source/developmentWorkbookAcquisitionProjection';
import type { AflOutcomesDevelopmentTradeProjection } from '../source/developmentWorkbookTradeProjection';
import type { DraftTradeAssetItem } from '@/lib/draftTrades/firestore';

export interface AflTradeDevelopmentWorkbookAssetLink {
  assetId: string;
  state: 'linked' | 'unresolved' | 'ambiguous';
  acquisitionId: string | null;
  method: 'player_club_year' | 'draft_selection_year' | 'none';
}

export interface AflTradeDevelopmentWorkbookValueProjection {
  datasetId: string;
  model: AflTradeDevelopmentGradeModel;
  valuesByTradeId: ReadonlyMap<string, AflTradeDevelopmentTradeValueResult>;
  gradesByTradeId: ReadonlyMap<
    string,
    { atTrade: AflTradeStatlyGradeResult; current: AflTradeStatlyGradeResult }
  >;
  linksByTradeId: ReadonlyMap<string, readonly AflTradeDevelopmentWorkbookAssetLink[]>;
  publicationEligible: false;
}

export interface AflTradeDevelopmentWorkbookValueProjectionInput {
  trades: AflOutcomesDevelopmentTradeProjection;
  acquisitions: AflOutcomesDevelopmentAcquisitionProjection;
  providerSeasons: AflTradeDevelopmentGradeDatasetContent['providerSeasons'];
  createdAt: string;
  minimumCohortSize: number;
  tradeIds?: readonly string[];
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stableWorkbookPlayerId(item: AflOutcomesDevelopmentAcquisitionItem): string {
  const digest = createHash('sha256')
    .update(`${item.eventId}\0${normalizeName(item.playerName)}`)
    .digest('hex')
    .slice(0, 24);
  return `development-workbook-player:${digest}`;
}

function numericMetric(
  rawValue: string | null,
  isMatured: boolean
):
  | { state: 'observed'; value: number }
  | { state: 'partial'; observedValue: number; reason: 'active_career_right_censored' }
  | { state: 'unavailable'; reason: 'source_missing' | 'definition_unsupported' } {
  if (rawValue === null || rawValue.trim() === '') {
    return { state: 'unavailable', reason: 'source_missing' };
  }
  if (!/^\d+(?:\.\d+)?$/.test(rawValue.trim())) {
    return { state: 'unavailable', reason: 'definition_unsupported' };
  }
  const value = Number(rawValue);
  return isMatured
    ? { state: 'observed', value }
    : { state: 'partial', observedValue: value, reason: 'active_career_right_censored' };
}

function toDatasetAcquisition(item: AflOutcomesDevelopmentAcquisitionItem, createdAt: string) {
  const effectiveAt = `${item.year}-10-01T00:00:00.000Z`;
  const outcomeMaturedAt = `${item.year + 3}-10-01T00:00:00.000Z`;
  const isMatured = Date.parse(outcomeMaturedAt) <= Date.parse(createdAt);
  return {
    acquisitionId: item.eventId,
    effectiveAt,
    outcomeMaturedAt,
    outcomeObservedAt: createdAt,
    seasonYear: item.year,
    mechanism: item.category,
    receivingClubId: `afl-club:${normalizeName(item.clubName).replaceAll(' ', '-')}`,
    player: {
      identityState: 'resolved' as const,
      playerId: stableWorkbookPlayerId(item),
      playerName: item.playerName,
    },
    selection: {
      nominalNumber: item.draftNumber,
      actualNumber: item.draftNumber,
      round:
        item.draftNumber === null
          ? null
          : item.draftNumber <= 20
            ? 1
            : item.draftNumber <= 40
              ? 2
              : item.draftNumber <= 60
                ? 3
                : 4,
      originalClubId: null,
    },
    atTrade: { age: item.age, heightCm: item.heightCm, weightKg: item.weightKg },
    outcome: {
      games: numericMetric(item.games, isMatured),
      goals: numericMetric(item.goals, isMatured),
      coachesVotes: numericMetric(item.coachesVotes, isMatured),
      brownlowVotes: numericMetric(item.brownlowVotes, isMatured),
    },
  };
}

function matchByPlayer(
  asset: DraftTradeAssetItem,
  acquisitions: readonly AflOutcomesDevelopmentAcquisitionItem[]
) {
  const query = normalizeName(asset.playerName ?? '');
  if (!query) return [];
  const queryTokens = query.split(' ');
  return acquisitions.filter((candidate) => {
    if (
      candidate.year !== asset.year ||
      candidate.category !== 'trade' ||
      normalizeName(candidate.clubName) !== normalizeName(asset.clubName)
    ) {
      return false;
    }
    const candidateName = normalizeName(candidate.playerName);
    const candidateTokens = candidateName.split(' ');
    return (
      candidateName === query ||
      (queryTokens.length === 1 && candidateTokens.at(-1) === queryTokens[0])
    );
  });
}

function matchBySelection(
  asset: DraftTradeAssetItem,
  acquisitions: readonly AflOutcomesDevelopmentAcquisitionItem[]
) {
  const actualNumber = asset.pick.numberActual;
  const draftedPlayer = normalizeName(asset.draftedPlayer ?? '');
  if (actualNumber === null && !draftedPlayer) return [];
  return acquisitions.filter((candidate) => {
    if (candidate.year !== asset.year || candidate.category === 'trade') return false;
    if (actualNumber !== null && candidate.draftNumber === actualNumber) return true;
    if (!draftedPlayer) return false;
    const candidateTokens = normalizeName(candidate.playerName).split(' ');
    const draftedTokens = draftedPlayer.split(' ');
    return (
      normalizeName(candidate.playerName) === draftedPlayer ||
      (draftedTokens.length === 1 && candidateTokens.at(-1) === draftedTokens[0])
    );
  });
}

function linkAsset(
  asset: DraftTradeAssetItem,
  acquisitions: readonly AflOutcomesDevelopmentAcquisitionItem[]
): AflTradeDevelopmentWorkbookAssetLink {
  const candidates =
    asset.assetType === 'player'
      ? matchByPlayer(asset, acquisitions)
      : asset.assetType === 'pick'
        ? matchBySelection(asset, acquisitions)
        : [];
  const method =
    asset.assetType === 'player'
      ? ('player_club_year' as const)
      : asset.assetType === 'pick'
        ? ('draft_selection_year' as const)
        : ('none' as const);
  if (candidates.length === 1) {
    return { assetId: asset.id, state: 'linked', acquisitionId: candidates[0]!.eventId, method };
  }
  return {
    assetId: asset.id,
    state: candidates.length > 1 ? 'ambiguous' : 'unresolved',
    acquisitionId: null,
    method: candidates.length > 0 ? method : 'none',
  };
}

export function projectAflOutcomesDevelopmentWorkbookValues(
  input: AflTradeDevelopmentWorkbookValueProjectionInput
): AflTradeDevelopmentWorkbookValueProjection {
  const dataset = createAflTradeDevelopmentGradeDataset({
    schemaVersion: 'afl-trade-development-grade-dataset-input/v1',
    environment: 'development',
    createdAt: input.createdAt,
    sourceBoundary: 'pinned_workbook_and_reconciled_fitzroy_no_fantasy_ownership',
    fixedOutcomeHorizonSeasons: 3,
    acquisitions: input.acquisitions.items.map((item) =>
      toDatasetAcquisition(item, input.createdAt)
    ),
    providerSeasons: input.providerSeasons,
  });
  const model = createAflTradeDevelopmentGradeModel(dataset, {
    createdAt: input.createdAt,
    minimumCohortSize: input.minimumCohortSize,
    practicalEquivalenceTolerance: 5,
  });
  const valuesByTradeId = new Map<string, AflTradeDevelopmentTradeValueResult>();
  const gradesByTradeId = new Map<
    string,
    { atTrade: AflTradeStatlyGradeResult; current: AflTradeStatlyGradeResult }
  >();
  const linksByTradeId = new Map<string, readonly AflTradeDevelopmentWorkbookAssetLink[]>();
  const requestedTradeIds = input.tradeIds ? new Set(input.tradeIds) : null;
  const orderedDetails = [...input.trades.detailsById.values()]
    .filter(({ trade }) => requestedTradeIds === null || requestedTradeIds.has(trade.tradeId))
    .sort(
      (left, right) =>
        left.trade.year - right.trade.year || left.trade.tradeId.localeCompare(right.trade.tradeId)
    );
  for (const detail of orderedDetails) {
    const links = detail.assets.map((asset) => linkAsset(asset, input.acquisitions.items));
    linksByTradeId.set(detail.trade.tradeId, links);
    const linkByAssetId = new Map(links.map((link) => [link.assetId, link]));
    const tradeCase = {
      schemaVersion: 'afl-trade-development-grade-case/v1' as const,
      tradeId: detail.trade.tradeId,
      effectiveAt: `${detail.trade.year}-10-01T00:00:00.000Z`,
      asOf: input.createdAt,
      parties: detail.parties.map((party) => ({
        aflClubId: `afl-club:${party.clubSlug}`,
        clubName: party.clubName,
        assets: detail.assets
          .filter(({ clubSlug }) => clubSlug === party.clubSlug)
          .map((asset) => {
            const link = linkByAssetId.get(asset.id)!;
            const hasSelectionEvidence =
              asset.assetType === 'pick' && asset.pick.numberGiven !== null;
            return {
              assetId: asset.id,
              kind:
                asset.assetType === 'player'
                  ? ('player' as const)
                  : asset.assetType === 'future_pick'
                    ? ('future_pick' as const)
                    : ('pick' as const),
              lineageState:
                link.state === 'ambiguous' || (!hasSelectionEvidence && link.state !== 'linked')
                  ? ('unresolved' as const)
                  : ('resolved' as const),
              acquisitionId: link.acquisitionId,
              selection: {
                nominalNumber: asset.pick.numberGiven,
                round:
                  asset.pick.round ??
                  (asset.pick.numberGiven === null
                    ? null
                    : asset.pick.numberGiven <= 20
                      ? 1
                      : asset.pick.numberGiven <= 40
                        ? 2
                        : asset.pick.numberGiven <= 60
                          ? 3
                          : 4),
              },
            };
          }),
      })),
    };
    const value = valueAflTradeDevelopmentTrade({ dataset, model, trade: tradeCase });
    valuesByTradeId.set(detail.trade.tradeId, value);
    gradesByTradeId.set(detail.trade.tradeId, {
      atTrade: deriveAflTradeStatlyGrades(value.summaries.at_trade),
      current: deriveAflTradeStatlyGrades(value.summaries.current),
    });
  }
  return Object.freeze({
    datasetId: dataset.datasetId,
    model,
    valuesByTradeId,
    gradesByTradeId,
    linksByTradeId,
    publicationEligible: false,
  });
}
