import { describe, expect, it } from 'vitest';

import {
  buildAflTradeAttributionFrontier,
  validateAflTradeAttribution,
} from '@/server/aflTradeIntelligence/domain/lineageAttribution';
import { validateAflTradeLineageGraph } from '@/server/aflTradeIntelligence/domain/lineageValidation';
import { validateAflTradeRealizedContributionLedger } from '@/server/aflTradeIntelligence/valuation/realizedContributionLedger';
import {
  aflTradeStructuredExplanationSchema,
  validateAflTradeStructuredExplanationParity,
} from '@/server/aflTradeIntelligence/valuation/structuredExplanations';
import { aflTradeValuationCalculationSchema } from '@/server/aflTradeIntelligence/valuation/tradeValuationCalculation';
import {
  AFL_TRADE_VALUATION_FIXTURE_KINDS,
  createAllFabricatedAflTradeValuationFixtures,
  createFabricatedAflTradeValuationFixture,
} from '@/server/aflTradeIntelligence/valuation/tradeValuationFixtures';
import { validateAflTradeValuationCaseLineage } from '@/server/aflTradeIntelligence/valuation/valuationCaseContracts';
import { aflTradeValuationSnapshotSetSchema } from '@/server/aflTradeIntelligence/valuation/valuationSnapshots';

describe('fabricated AFL trade valuation fixtures', () => {
  it('builds every representative scenario through the complete Stage 5 pipeline', () => {
    const fixtures = createAllFabricatedAflTradeValuationFixtures();

    expect(fixtures.map((fixture) => fixture.fixtureKind)).toEqual(
      AFL_TRADE_VALUATION_FIXTURE_KINDS
    );
    for (const fixture of fixtures) {
      expect(fixture.evidenceClassification).toBe('fabricated_test_evidence_not_real_afl_data');
      expect(aflTradeValuationCalculationSchema.parse(fixture.calculation)).toEqual(
        fixture.calculation
      );
      expect(aflTradeValuationSnapshotSetSchema.parse(fixture.snapshotSet)).toEqual(
        fixture.snapshotSet
      );
      expect(aflTradeStructuredExplanationSchema.parse(fixture.explanation)).toEqual(
        fixture.explanation
      );
    }
  });

  it('validates graph, trade-root custody, realized attribution, and terminal frontier exactly once', () => {
    for (const fixture of createAllFabricatedAflTradeValuationFixtures()) {
      expect(validateAflTradeLineageGraph(fixture.lineageGraph)).toEqual({
        valid: true,
        issues: [],
      });
      expect(
        validateAflTradeValuationCaseLineage(fixture.valuationCase, fixture.lineageGraph)
      ).toEqual({ valid: true, issues: [] });
      expect(
        validateAflTradeRealizedContributionLedger(
          fixture.realizedContributionLedger,
          fixture.valuationCase,
          fixture.lineageGraph
        )
      ).toEqual({ valid: true, issues: [] });

      const rootAssetIds = fixture.valuationCase.content.parties.flatMap(
        (party) => party.receivedRootAssetIds
      );
      const cutoff = {
        effectiveAsOf: '2026-08-05T00:00:00.000Z',
        knowledgeCutoffAt: '2026-08-05T00:00:00.000Z',
      };
      const frontier = buildAflTradeAttributionFrontier(
        rootAssetIds,
        fixture.lineageGraph.edges,
        cutoff,
        fixture.lineageGraph.dispositions
      );
      expect(
        validateAflTradeAttribution(fixture.lineageGraph, {
          ...cutoff,
          rootAssetIds,
          creditedAssetIds: frontier,
          excludedAssetIds: [],
        })
      ).toEqual({ valid: true, expectedFrontierAssetIds: frontier, issues: [] });
      expect(new Set(frontier).size).toBe(frontier.length);
    }
  });

  it('replays every content-addressed output deterministically', () => {
    for (const kind of AFL_TRADE_VALUATION_FIXTURE_KINDS) {
      const first = createFabricatedAflTradeValuationFixture(kind);
      const second = createFabricatedAflTradeValuationFixture(kind);

      expect(second.valuationCase.valuationCaseId).toBe(first.valuationCase.valuationCaseId);
      expect(second.componentDrawSet.componentDrawSetId).toBe(
        first.componentDrawSet.componentDrawSetId
      );
      expect(second.realizedContributionLedger.realizedContributionLedgerId).toBe(
        first.realizedContributionLedger.realizedContributionLedgerId
      );
      expect(second.packagePolicy.packagePolicyId).toBe(first.packagePolicy.packagePolicyId);
      expect(second.calculation.valuationCalculationId).toBe(
        first.calculation.valuationCalculationId
      );
      expect(second.snapshotSet.valuationSnapshotSetId).toBe(
        first.snapshotSet.valuationSnapshotSetId
      );
      expect(second.explanation.structuredExplanationId).toBe(
        first.explanation.structuredExplanationId
      );
    }
  });

  it('keeps every generated numerical explanation claim in parity with its source artifacts', () => {
    for (const fixture of createAllFabricatedAflTradeValuationFixtures()) {
      expect(
        validateAflTradeStructuredExplanationParity(
          fixture.explanation,
          fixture.calculation,
          fixture.snapshotSet
        )
      ).toEqual({ valid: true, issueStatementIds: [] });
      expect(
        new Set(fixture.explanation.content.statements.map((statement) => statement.claimKind))
      ).toEqual(
        new Set(['assumption', 'model_estimate', 'measured_fact', 'low_confidence_output'])
      );
    }
  });

  it('covers multi-party, future-pick, and on-trade transformations explicitly', () => {
    const multi = createFabricatedAflTradeValuationFixture('three_party_exchange');
    const future = createFabricatedAflTradeValuationFixture('future_pick_resolution');
    const onTraded = createFabricatedAflTradeValuationFixture('on_traded_pick_return');

    expect(multi.valuationCase.content.parties).toHaveLength(3);
    expect(future.lineageGraph.edges.map((edge) => edge.kind)).toContain(
      'future_right_resolved_to_pick'
    );
    expect(onTraded.lineageGraph.edges.map((edge) => edge.kind)).toEqual(
      expect.arrayContaining([
        'asset_traded_for_asset',
        'future_right_resolved_to_pick',
        'pick_exercised_at_selection',
        'selection_created_player',
      ])
    );
  });

  it('enforces current equals realized plus remaining for every root, draw, club, and layer', () => {
    for (const fixture of createAllFabricatedAflTradeValuationFixtures()) {
      for (const draw of fixture.calculation.content.draws) {
        for (const party of draw.parties) {
          const realized = party.views.find((view) => view.view === 'realized')!;
          const remaining = party.views.find((view) => view.view === 'remaining')!;
          const current = party.views.find((view) => view.view === 'current')!;
          expect(realized.universal.status).toBe('available');
          expect(remaining.universal.status).toBe('available');
          expect(current.universal.status).toBe('available');
          if (
            realized.universal.status !== 'available' ||
            remaining.universal.status !== 'available' ||
            current.universal.status !== 'available'
          ) {
            continue;
          }
          expect(current.universal.layers).toEqual({
            gross: realized.universal.layers.gross + remaining.universal.layers.gross,
            listSpotAdjusted:
              realized.universal.layers.listSpotAdjusted +
              remaining.universal.layers.listSpotAdjusted,
            scarcityAdjusted:
              realized.universal.layers.scarcityAdjusted +
              remaining.universal.layers.scarcityAdjusted,
          });
        }
      }
    }
  });

  it('contains no user, fantasy, owner, roster, or legacy-value fields anywhere in fixtures', () => {
    const fixtures = createAllFabricatedAflTradeValuationFixtures();
    const keys: string[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          keys.push(key);
          visit(child);
        }
      }
    };
    visit(fixtures);

    expect(keys).not.toEqual(
      expect.arrayContaining([
        'userId',
        'fantasyTeamId',
        'ownerId',
        'rosterOwnerId',
        'legacyExpectedValue',
        'legacyActualValue',
      ])
    );
    expect(JSON.stringify(fixtures)).toContain('fabricated');
  });
});
