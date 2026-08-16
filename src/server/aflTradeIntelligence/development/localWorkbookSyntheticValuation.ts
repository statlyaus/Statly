import type { DraftTradeDetail } from '@/lib/draftTrades/firestore';

import {
  createAflTradeValuationExplanation,
  type AflTradeValuationExplanationResult,
} from '../valuation/tradeValuationExplanation';

import {
  createLocalSyntheticValuationScenario,
  type LocalSyntheticTradeDefinition,
  type LocalSyntheticValuationScenario,
} from './localSyntheticValuationScenario';

export type LocalWorkbookSyntheticValuationUnavailableReason =
  | 'invalid_trade_shape'
  | 'unsupported_asset_kind'
  | 'invalid_evaluation_window'
  | 'incomplete_numeric_evidence';

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
      explanation: Extract<AflTradeValuationExplanationResult, { state: 'available' }>;
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
  const canonicalPartySlugs = [...partySlugs].sort((left, right) =>
    clubId(left).localeCompare(clubId(right))
  );
  const indexBySlug = new Map(canonicalPartySlugs.map((slug, index) => [slug, index]));
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
        const senderSlug =
          canonicalPartySlugs[
            (receiverIndex + canonicalPartySlugs.length - 1) % canonicalPartySlugs.length
          ]!;
        return {
          transferId: asset.id,
          fromClubId: clubId(senderSlug),
          toClubId: clubId(asset.clubSlug),
          assetId: asset.id,
          assetKind: assetKind(asset.assetType)!,
          displayLabel: asset.assetText,
          directionBasis,
        };
      }),
  };
}

function summarizeExplanation(
  scenario: ReturnType<typeof createLocalSyntheticValuationScenario>,
  explanation: Extract<AflTradeValuationExplanationResult, { state: 'available' }>
): LocalWorkbookSyntheticValuationSummary {
  return {
    scenarioId: scenario.scenarioId,
    calculationId: scenario.calculation.valuationCalculationId,
    valueUnitId: scenario.valuationCase.content.valueUnitId,
    views: explanation.document.views.map(({ view, clubs }) => ({
      view,
      parties: clubs.map(({ aflClubId, clubName, received, givenUp, net }) => ({
        aflClubId,
        clubName,
        received: received.additiveMean,
        givenUp: givenUp.additiveMean,
        netAdvantage: net.additiveMean,
      })),
    })),
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
  const explanation = createAflTradeValuationExplanation({
    admittedAssumptionSetId: scenario.assumptionSet.assumptionSetId,
    directionEvidence: scenario.assumptionSet,
    valuationCase: scenario.valuationCase,
    valuationCalculation: scenario.calculation,
    selectedLayer: 'scarcityAdjusted',
    gradeContext: {
      confidenceLevel: 'high',
      developmentPreview: true,
    },
  });
  if (explanation.state !== 'available') {
    return unavailable(input.trade.trade.tradeId, 'incomplete_numeric_evidence');
  }
  return {
    state: 'ready',
    tradeId: input.trade.trade.tradeId,
    scenario,
    explanation,
    summary: summarizeExplanation(scenario, explanation),
    publicationEligible: false,
  };
}
