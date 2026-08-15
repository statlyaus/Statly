import type { DraftTradeDetail } from '@/lib/draftTrades/firestore';

import {
  createLocalSyntheticValuationScenario,
  type LocalSyntheticTradeDefinition,
  type LocalSyntheticValuationScenario,
} from './localSyntheticValuationScenario';

export type LocalWorkbookSyntheticValuationUnavailableReason =
  'invalid_trade_shape' | 'unsupported_asset_kind' | 'invalid_evaluation_window';

export interface LocalWorkbookSyntheticValuationInput {
  environment: 'test_fixture';
  trade: DraftTradeDetail;
  workbookSha256: string;
  valuationBundleId: string;
  scenario: LocalSyntheticValuationScenario;
  assessedAt: string;
}

export type LocalWorkbookSyntheticValuationPreparation =
  | {
      state: 'ready';
      tradeId: string;
      scenario: ReturnType<typeof createLocalSyntheticValuationScenario>;
      summary: LocalWorkbookSyntheticValuationSummary;
      publicationEligible: false;
    }
  | {
      state: 'unavailable';
      reason: LocalWorkbookSyntheticValuationUnavailableReason;
      tradeId: string;
      publicationEligible: false;
    };

export interface LocalWorkbookSyntheticValuationSummary {
  scenarioId: string;
  calculationId: string;
  valueUnitId: string;
  views: Array<{
    view: 'at_trade' | 'realized' | 'remaining' | 'current';
    parties: Array<{
      aflClubId: string;
      clubName: string;
      received: number;
      givenUp: number;
      netAdvantage: number;
    }>;
  }>;
}

function unavailable(
  tradeId: string,
  reason: LocalWorkbookSyntheticValuationUnavailableReason
): LocalWorkbookSyntheticValuationPreparation {
  return { state: 'unavailable', reason, tradeId, publicationEligible: false };
}

function clubId(clubSlug: string): string {
  return `afl-club:${clubSlug}`;
}

function assetKind(assetType: DraftTradeDetail['assets'][number]['assetType']) {
  if (assetType === 'player') return 'player' as const;
  if (assetType === 'pick') return 'current_pick' as const;
  if (assetType === 'future_pick') return 'future_pick' as const;
  return null;
}

function definitionFor(
  input: LocalWorkbookSyntheticValuationInput
): LocalSyntheticTradeDefinition | LocalWorkbookSyntheticValuationPreparation {
  const { trade } = input;
  const parties = [...trade.parties].sort((left, right) => left.rowOrder - right.rowOrder);
  const partySlugs = parties.map(({ clubSlug }) => clubSlug);
  const partySlugSet = new Set(partySlugs);
  if (
    parties.length < 2 ||
    parties.length > 18 ||
    partySlugSet.size !== parties.length ||
    trade.trade.partyCount !== parties.length ||
    trade.assets.length < 2 ||
    trade.assets.length > 100 ||
    trade.trade.assetCount !== trade.assets.length ||
    trade.assets.some(({ clubSlug }) => !partySlugSet.has(clubSlug)) ||
    parties.some(({ clubSlug }) => !trade.assets.some((asset) => asset.clubSlug === clubSlug)) ||
    new Set(trade.assets.map(({ id }) => id)).size !== trade.assets.length
  ) {
    return unavailable(trade.trade.tradeId, 'invalid_trade_shape');
  }
  if (trade.assets.some(({ assetType }) => assetKind(assetType) === null)) {
    return unavailable(trade.trade.tradeId, 'unsupported_asset_kind');
  }

  const effectiveAt = `${trade.trade.year}-10-01T00:00:00.000Z`;
  if (
    !Number.isFinite(Date.parse(input.assessedAt)) ||
    Date.parse(input.assessedAt) <= Date.parse(effectiveAt) + 2 * 24 * 60 * 60 * 1_000
  ) {
    return unavailable(trade.trade.tradeId, 'invalid_evaluation_window');
  }
  const indexBySlug = new Map(partySlugs.map((slug, index) => [slug, index]));
  const directionBasis =
    parties.length === 2
      ? ('two_party_other_club_assumption' as const)
      : ('deterministic_fixture_transfer_map_v1' as const);

  return {
    schemaVersion: 'local-synthetic-trade-definition/v1',
    basis: { kind: 'private_workbook', basisId: `workbook-sha256:${input.workbookSha256}` },
    tradeId: trade.trade.tradeId,
    effectiveAt,
    effectiveThrough: input.assessedAt,
    parties: parties.map((party) => ({
      aflClubId: clubId(party.clubSlug),
      clubName: party.clubName,
    })),
    transfers: [...trade.assets]
      .sort((left, right) => left.assetIndex - right.assetIndex || left.id.localeCompare(right.id))
      .map((asset) => {
        const receiverIndex = indexBySlug.get(asset.clubSlug)!;
        const sender = parties[(receiverIndex + parties.length - 1) % parties.length]!;
        return {
          transferId: asset.id,
          fromClubId: clubId(sender.clubSlug),
          toClubId: clubId(asset.clubSlug),
          assetId: asset.id,
          assetKind: assetKind(asset.assetType)!,
          displayLabel: asset.assetText,
          directionBasis,
        };
      }),
  };
}

function scarcityAdjusted(
  value: ReturnType<
    typeof createLocalSyntheticValuationScenario
  >['calculation']['content']['draws'][number]['parties'][number]['views'][number]['roots'][number]['universal']
): number {
  return value.status === 'available'
    ? value.layers.scarcityAdjusted
    : value.partialLayers.scarcityAdjusted;
}

function summarizeScenario(
  scenario: ReturnType<typeof createLocalSyntheticValuationScenario>
): LocalWorkbookSyntheticValuationSummary {
  const transfers = scenario.definition.transfers;
  const views = scenario.valuationCase.content.viewContexts.map(({ view }) => ({
    view,
    parties: scenario.definition.parties.map((party) => {
      let received = 0;
      let givenUp = 0;
      for (const draw of scenario.calculation.content.draws) {
        const roots = draw.parties.flatMap(
          (drawParty) => drawParty.views.find((candidate) => candidate.view === view)?.roots ?? []
        );
        const valueByAssetId = new Map(
          roots.map((root) => [root.assetId, scarcityAdjusted(root.universal)] as const)
        );
        received +=
          draw.probabilityWeight *
          transfers
            .filter(({ toClubId }) => toClubId === party.aflClubId)
            .reduce((sum, transfer) => sum + valueByAssetId.get(transfer.assetId)!, 0);
        givenUp +=
          draw.probabilityWeight *
          transfers
            .filter(({ fromClubId }) => fromClubId === party.aflClubId)
            .reduce((sum, transfer) => sum + valueByAssetId.get(transfer.assetId)!, 0);
      }
      return {
        aflClubId: party.aflClubId,
        clubName: party.clubName,
        received,
        givenUp,
        netAdvantage: received - givenUp,
      };
    }),
  }));
  return {
    scenarioId: scenario.scenarioId,
    calculationId: scenario.calculation.valuationCalculationId,
    valueUnitId: scenario.valuationCase.content.valueUnitId,
    views,
  };
}

export function prepareLocalWorkbookSyntheticValuation(
  input: LocalWorkbookSyntheticValuationInput
): LocalWorkbookSyntheticValuationPreparation {
  if (input.environment !== 'test_fixture') {
    throw new TypeError('Workbook synthetic valuation is restricted to test_fixture.');
  }
  if (!/^[a-f0-9]{64}$/u.test(input.workbookSha256)) {
    throw new TypeError('Workbook synthetic valuation requires a pinned SHA-256 digest.');
  }
  const definition = definitionFor(input);
  if ('state' in definition) return definition;
  const scenario = createLocalSyntheticValuationScenario({
    environment: input.environment,
    definition,
    valuationBundleId: input.valuationBundleId,
    scenario: input.scenario,
    assessedAt: input.assessedAt,
  });
  return {
    state: 'ready',
    tradeId: input.trade.trade.tradeId,
    scenario,
    summary: summarizeScenario(scenario),
    publicationEligible: false,
  };
}
