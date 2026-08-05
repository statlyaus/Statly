import { describe, expect, it } from 'vitest';

import {
  aflTradeValuationCaseSchema,
  createAflTradeLineageGraphId,
  createAflTradeValuationCase,
  validateAflTradeValuationCaseLineage,
  type AflTradeValuationCaseContent,
} from '@/server/aflTradeIntelligence/valuation/valuationCaseContracts';
import type { AflTradeLineageGraph } from '@/server/aflTradeIntelligence/domain/lineageTypes';

const TRADE_AT = '2024-10-10T00:00:00.000Z';
const CURRENT_AT = '2026-08-05T00:00:00.000Z';

function digest(character: string): string {
  return character.repeat(64);
}

function graph(): AflTradeLineageGraph {
  return {
    assets: [
      {
        assetId: 'asset:player-a',
        assetType: 'player',
        effectiveFrom: TRADE_AT,
        knownFrom: TRADE_AT,
        knownTo: null,
        evidenceId: 'evidence:player-a',
      },
      {
        assetId: 'asset:pick-a',
        assetType: 'current_pick_entitlement',
        effectiveFrom: TRADE_AT,
        knownFrom: TRADE_AT,
        knownTo: null,
        evidenceId: 'evidence:pick-a',
      },
      {
        assetId: 'asset:player-b',
        assetType: 'player',
        effectiveFrom: TRADE_AT,
        knownFrom: TRADE_AT,
        knownTo: null,
        evidenceId: 'evidence:player-b',
      },
    ],
    custodySpells: [
      {
        custodySpellId: 'custody:player-a:club-a',
        assetId: 'asset:player-a',
        aflClubId: 'club-a',
        effectiveFrom: TRADE_AT,
        effectiveTo: null,
        knownFrom: TRADE_AT,
        knownTo: null,
        evidenceId: 'evidence:custody-player-a',
      },
      {
        custodySpellId: 'custody:pick-a:club-a',
        assetId: 'asset:pick-a',
        aflClubId: 'club-a',
        effectiveFrom: TRADE_AT,
        effectiveTo: null,
        knownFrom: TRADE_AT,
        knownTo: null,
        evidenceId: 'evidence:custody-pick-a',
      },
      {
        custodySpellId: 'custody:player-b:club-b',
        assetId: 'asset:player-b',
        aflClubId: 'club-b',
        effectiveFrom: TRADE_AT,
        effectiveTo: null,
        knownFrom: TRADE_AT,
        knownTo: null,
        evidenceId: 'evidence:custody-player-b',
      },
    ],
    edges: [],
    dispositions: [],
    corrections: [],
  };
}

function content(lineageGraph = graph()): AflTradeValuationCaseContent {
  const currentContext = {
    modelVintage: 'current' as const,
    effectiveAt: CURRENT_AT,
    knowledgeCutoffAt: CURRENT_AT,
    valuationAsOf: CURRENT_AT,
  };
  return {
    schemaVersion: 'afl-trade-valuation-case/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    calculationUnit: 'complete_multi_party_trade',
    tradeId: 'trade:fixture-two-party',
    tradeEffectiveAt: TRADE_AT,
    valuationBundleId: `valuation-bundle:${digest('1')}`,
    lineageGraphId: createAflTradeLineageGraphId(lineageGraph),
    componentDrawSetId: `component-draw-set:${digest('2')}`,
    realizedContributionLedgerId: `realized-contribution-ledger:${digest('3')}`,
    packagePolicyId: `package-policy:${digest('4')}`,
    valueUnitId: 'football-contribution-above-replacement-v1',
    parties: [
      {
        aflClubId: 'club-a',
        clubName: 'Club A',
        receivedRootAssetIds: ['asset:pick-a', 'asset:player-a'],
      },
      {
        aflClubId: 'club-b',
        clubName: 'Club B',
        receivedRootAssetIds: ['asset:player-b'],
      },
    ],
    viewContexts: [
      {
        view: 'at_trade',
        modelVintage: 'historical_restatement',
        effectiveAt: TRADE_AT,
        knowledgeCutoffAt: TRADE_AT,
        valuationAsOf: TRADE_AT,
      },
      { view: 'realized', ...currentContext },
      { view: 'remaining', ...currentContext },
      { view: 'current', ...currentContext },
    ],
    legacySourceMetricsTreatment:
      'excluded_from_calculation_retained_only_by_separate_legacy_projection',
  };
}

describe('AFL trade-intelligence valuation-case contracts', () => {
  it('canonicalizes semantic ordering and produces one reproducible content address', () => {
    const input = content();
    const reversed = {
      ...input,
      parties: [...input.parties].reverse().map((party) => ({
        ...party,
        receivedRootAssetIds: [...party.receivedRootAssetIds].reverse(),
      })),
      viewContexts: [...input.viewContexts].reverse(),
    };

    const left = createAflTradeValuationCase(input);
    const right = createAflTradeValuationCase(reversed);

    expect(right).toEqual(left);
    expect(left.content.parties.map((party) => party.aflClubId)).toEqual(['club-a', 'club-b']);
    expect(left.content.parties[0].receivedRootAssetIds).toEqual([
      'asset:pick-a',
      'asset:player-a',
    ]);
    expect(left.content.viewContexts.map((view) => view.view)).toEqual([
      'at_trade',
      'realized',
      'remaining',
      'current',
    ]);
  });

  it('rejects user, fantasy, roster, ownership, and inline legacy-value fields', () => {
    const valid = createAflTradeValuationCase(content());
    const forbiddenCases = [
      { ...valid.content, userId: 'user-1' },
      { ...valid.content, fantasyLeagueId: 'league-1' },
      { ...valid.content, rosterId: 'roster-1' },
      { ...valid.content, ownerId: 'owner-1' },
      { ...valid.content, legacyExpectedValue: 42 },
      {
        ...valid.content,
        parties: [{ ...valid.content.parties[0], userId: 'user-1' }, valid.content.parties[1]],
      },
    ];

    for (const invalidContent of forbiddenCases) {
      expect(
        aflTradeValuationCaseSchema.safeParse({
          valuationCaseId: valid.valuationCaseId,
          content: invalidContent,
        }).success
      ).toBe(false);
    }
  });

  it('rejects duplicated roots across receiving AFL clubs', () => {
    const invalid = content();
    invalid.parties[1].receivedRootAssetIds = ['asset:player-a'];

    expect(() => createAflTradeValuationCase(invalid)).toThrow(/only one AFL club/i);
  });

  it('rejects at-trade hindsight and mismatched current temporal contexts', () => {
    const hindsight = content();
    hindsight.viewContexts[0].knowledgeCutoffAt = '2024-10-11T00:00:00.000Z';
    const mismatch = content();
    mismatch.viewContexts[3].valuationAsOf = '2026-08-06T00:00:00.000Z';

    expect(() => createAflTradeValuationCase(hindsight)).toThrow();
    expect(() => createAflTradeValuationCase(mismatch)).toThrow(/share one temporal context/i);
  });

  it('validates graph identity, root visibility, and real-club custody', () => {
    const lineageGraph = graph();
    const valuationCase = createAflTradeValuationCase(content(lineageGraph));

    expect(validateAflTradeValuationCaseLineage(valuationCase, lineageGraph)).toEqual({
      valid: true,
      issues: [],
    });

    const tamperedGraph = structuredClone(lineageGraph);
    tamperedGraph.assets[0].evidenceId = 'evidence:tampered';
    expect(
      validateAflTradeValuationCaseLineage(valuationCase, tamperedGraph).issues.map(
        (issue) => issue.code
      )
    ).toContain('lineage_graph_id_mismatch');

    const custodyMismatch = content(lineageGraph);
    custodyMismatch.parties[0].aflClubId = 'club-z';
    custodyMismatch.parties[0].clubName = 'Club Z';
    const mismatchedCase = createAflTradeValuationCase(custodyMismatch);
    expect(
      validateAflTradeValuationCaseLineage(mismatchedCase, lineageGraph).issues.map(
        (issue) => issue.code
      )
    ).toContain('root_custody_mismatch');
  });

  it('rejects unknown roots and roots that were not knowable at the trade cutoff', () => {
    const lineageGraph = graph();
    const unknown = content(lineageGraph);
    unknown.parties[1].receivedRootAssetIds = ['asset:unknown'];
    const unknownCase = createAflTradeValuationCase(unknown);
    expect(
      validateAflTradeValuationCaseLineage(unknownCase, lineageGraph).issues.map(
        (issue) => issue.code
      )
    ).toContain('unknown_root_asset');

    const lateGraph = graph();
    lateGraph.assets[2].knownFrom = '2024-10-11T00:00:00.000Z';
    lateGraph.custodySpells[2].knownFrom = '2024-10-11T00:00:00.000Z';
    const lateCase = createAflTradeValuationCase(content(lateGraph));
    expect(
      validateAflTradeValuationCaseLineage(lateCase, lateGraph).issues.map((issue) => issue.code)
    ).toContain('root_not_visible_at_trade');
  });

  it('rejects trade roots related through the lineage graph', () => {
    const baseGraph = graph();
    const relatedGraph = {
      ...baseGraph,
      edges: [
        ...baseGraph.edges,
        {
          edgeId: 'edge:player-a-returned-pick-a',
          kind: 'asset_traded_for_asset' as const,
          sourceAssetId: 'asset:player-a',
          targetAssetId: 'asset:pick-a',
          effectiveAt: '2025-01-01T00:00:00.000Z',
          knownFrom: '2025-01-01T00:00:00.000Z',
          knownTo: null,
          evidenceId: 'evidence:edge-player-a-returned-pick-a',
          ruleVersion: 'fabricated-test/v1',
        },
      ],
    };
    const valuationCase = createAflTradeValuationCase(content(relatedGraph));

    expect(
      validateAflTradeValuationCaseLineage(valuationCase, relatedGraph).issues.map(
        (issue) => issue.code
      )
    ).toContain('related_trade_roots');
  });

  it('detects content-address tampering', () => {
    const valid = createAflTradeValuationCase(content());

    expect(
      aflTradeValuationCaseSchema.safeParse({
        ...valid,
        content: { ...valid.content, tradeId: 'trade:tampered' },
      }).success
    ).toBe(false);
  });
});
