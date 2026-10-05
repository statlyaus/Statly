import { describe, expect, it } from 'vitest';

import {
  derivePrivateGovernedPickAttribution,
  type PrivateGovernedPickAttributionInput,
} from '@/server/aflTradeIntelligence/valuation/privateGovernedPickAttribution';

const tradeAt = '2021-10-15T00:00:00.000Z';
const currentAt = '2026-08-18T00:00:00.000Z';
const receivingClubId = 'local-afl-club:receiving';
const laterClubId = 'local-afl-club:later-custodian';

function input(): PrivateGovernedPickAttributionInput {
  return {
    rootAssetId: 'asset:future-pick',
    receivingClubId,
    tradeCutoff: {
      effectiveAsOf: tradeAt,
      knowledgeCutoffAt: tradeAt,
    },
    currentCutoff: {
      effectiveAsOf: currentAt,
      knowledgeCutoffAt: currentAt,
    },
    graph: {
      assets: [
        {
          assetId: 'asset:future-pick',
          assetType: 'future_pick_entitlement',
          effectiveFrom: tradeAt,
          knownFrom: tradeAt,
          knownTo: null,
          evidenceId: 'evidence:trade',
        },
        {
          assetId: 'asset:final-pick',
          assetType: 'current_pick_entitlement',
          effectiveFrom: '2021-11-01T00:00:00.000Z',
          knownFrom: '2021-11-01T00:00:00.000Z',
          knownTo: null,
          evidenceId: 'evidence:lineage',
        },
        {
          assetId: 'asset:selection',
          assetType: 'draft_selection',
          effectiveFrom: '2021-11-20T00:00:00.000Z',
          knownFrom: '2021-11-21T00:00:00.000Z',
          knownTo: null,
          evidenceId: 'evidence:selection',
        },
        {
          assetId: 'asset:selected-player',
          assetType: 'player',
          effectiveFrom: '2021-11-20T00:00:00.000Z',
          knownFrom: '2021-11-21T00:00:00.000Z',
          knownTo: null,
          evidenceId: 'evidence:selection',
        },
      ],
      custodySpells: [
        {
          custodySpellId: 'custody:future-pick',
          assetId: 'asset:future-pick',
          aflClubId: receivingClubId,
          effectiveFrom: tradeAt,
          effectiveTo: null,
          knownFrom: tradeAt,
          knownTo: null,
          evidenceId: 'evidence:trade',
        },
        {
          custodySpellId: 'custody:final-pick',
          assetId: 'asset:final-pick',
          aflClubId: receivingClubId,
          effectiveFrom: '2021-11-01T00:00:00.000Z',
          effectiveTo: null,
          knownFrom: '2021-11-01T00:00:00.000Z',
          knownTo: null,
          evidenceId: 'evidence:custody',
        },
        {
          custodySpellId: 'custody:selected-player',
          assetId: 'asset:selected-player',
          aflClubId: receivingClubId,
          effectiveFrom: '2021-11-20T00:00:00.000Z',
          effectiveTo: null,
          knownFrom: '2021-11-21T00:00:00.000Z',
          knownTo: null,
          evidenceId: 'evidence:selection',
        },
      ],
      edges: [
        {
          edgeId: 'edge:future-to-final',
          kind: 'future_right_resolved_to_pick',
          sourceAssetId: 'asset:future-pick',
          targetAssetId: 'asset:final-pick',
          effectiveAt: '2021-11-01T00:00:00.000Z',
          knownFrom: '2021-11-01T00:00:00.000Z',
          knownTo: null,
          evidenceId: 'evidence:lineage',
          ruleVersion: 'canonical-pick-lineage/v1',
        },
        {
          edgeId: 'edge:pick-to-selection',
          kind: 'pick_exercised_at_selection',
          sourceAssetId: 'asset:final-pick',
          targetAssetId: 'asset:selection',
          effectiveAt: '2021-11-20T00:00:00.000Z',
          knownFrom: '2021-11-21T00:00:00.000Z',
          knownTo: null,
          evidenceId: 'evidence:selection',
          ruleVersion: 'canonical-pick-realization/v1',
        },
        {
          edgeId: 'edge:selection-to-player',
          kind: 'selection_created_player',
          sourceAssetId: 'asset:selection',
          targetAssetId: 'asset:selected-player',
          effectiveAt: '2021-11-20T00:00:00.000Z',
          knownFrom: '2021-11-21T00:00:00.000Z',
          knownTo: null,
          evidenceId: 'evidence:selection',
          ruleVersion: 'canonical-draft-selection/v1',
        },
      ],
      dispositions: [],
      corrections: [],
    },
  };
}

describe('private governed pick attribution', () => {
  it('credits only the selected-player frontier when the receiving club keeps and exercises the pick', () => {
    expect(derivePrivateGovernedPickAttribution(input())).toEqual({
      state: 'ready',
      rootAssetId: 'asset:future-pick',
      frontierAssetIds: ['asset:selected-player'],
    });
  });

  it('replaces an on-traded pick with the exact assets received in the later exchange', () => {
    const onTraded = input();
    onTraded.graph.assets = [
      ...onTraded.graph.assets.slice(0, 2),
      {
        assetId: 'asset:exchange-package',
        assetType: 'package',
        effectiveFrom: '2021-11-10T00:00:00.000Z',
        knownFrom: '2021-11-10T00:00:00.000Z',
        knownTo: null,
        evidenceId: 'evidence:later-trade',
      },
      {
        assetId: 'asset:successor-player',
        assetType: 'player',
        effectiveFrom: '2021-11-10T00:00:00.000Z',
        knownFrom: '2021-11-10T00:00:00.000Z',
        knownTo: null,
        evidenceId: 'evidence:later-trade',
      },
      {
        assetId: 'asset:successor-pick',
        assetType: 'current_pick_entitlement',
        effectiveFrom: '2021-11-10T00:00:00.000Z',
        knownFrom: '2021-11-10T00:00:00.000Z',
        knownTo: null,
        evidenceId: 'evidence:later-trade',
      },
    ];
    onTraded.graph.custodySpells = [
      onTraded.graph.custodySpells[0]!,
      {
        ...onTraded.graph.custodySpells[1]!,
        effectiveTo: '2021-11-10T00:00:00.000Z',
      },
      {
        custodySpellId: 'custody:final-pick-later-club',
        assetId: 'asset:final-pick',
        aflClubId: laterClubId,
        effectiveFrom: '2021-11-10T00:00:00.000Z',
        effectiveTo: null,
        knownFrom: '2021-11-10T00:00:00.000Z',
        knownTo: null,
        evidenceId: 'evidence:later-trade',
      },
    ];
    onTraded.graph.edges = [
      onTraded.graph.edges[0]!,
      {
        edgeId: 'edge:pick-to-package',
        kind: 'asset_traded_for_package',
        sourceAssetId: 'asset:final-pick',
        targetAssetId: 'asset:exchange-package',
        effectiveAt: '2021-11-10T00:00:00.000Z',
        knownFrom: '2021-11-10T00:00:00.000Z',
        knownTo: null,
        evidenceId: 'evidence:later-trade',
        ruleVersion: 'conserved-frontier/v1',
      },
      {
        edgeId: 'edge:package-to-player',
        kind: 'package_contains_asset',
        sourceAssetId: 'asset:exchange-package',
        targetAssetId: 'asset:successor-player',
        effectiveAt: '2021-11-10T00:00:00.000Z',
        knownFrom: '2021-11-10T00:00:00.000Z',
        knownTo: null,
        evidenceId: 'evidence:later-trade',
        ruleVersion: 'conserved-frontier/v1',
      },
      {
        edgeId: 'edge:package-to-pick',
        kind: 'package_contains_asset',
        sourceAssetId: 'asset:exchange-package',
        targetAssetId: 'asset:successor-pick',
        effectiveAt: '2021-11-10T00:00:00.000Z',
        knownFrom: '2021-11-10T00:00:00.000Z',
        knownTo: null,
        evidenceId: 'evidence:later-trade',
        ruleVersion: 'conserved-frontier/v1',
      },
    ];

    expect(derivePrivateGovernedPickAttribution(onTraded)).toEqual({
      state: 'ready',
      rootAssetId: 'asset:future-pick',
      frontierAssetIds: ['asset:successor-pick', 'asset:successor-player'],
    });
  });

  it('fails closed when custody leaves the receiving club without an exact exchange successor', () => {
    const escaped = input();
    escaped.graph.assets = escaped.graph.assets.slice(0, 2);
    escaped.graph.edges = escaped.graph.edges.slice(0, 1);
    escaped.graph.custodySpells = escaped.graph.custodySpells.slice(0, 2);
    escaped.graph.custodySpells[1] = {
      ...escaped.graph.custodySpells[1]!,
      effectiveTo: '2021-11-10T00:00:00.000Z',
    };
    escaped.graph.custodySpells.push({
      custodySpellId: 'custody:final-pick-later-club',
      assetId: 'asset:final-pick',
      aflClubId: laterClubId,
      effectiveFrom: '2021-11-10T00:00:00.000Z',
      effectiveTo: null,
      knownFrom: '2021-11-10T00:00:00.000Z',
      knownTo: null,
      evidenceId: 'evidence:later-trade',
    });

    expect(derivePrivateGovernedPickAttribution(escaped)).toEqual({
      state: 'unavailable',
      rootAssetId: 'asset:future-pick',
      reasons: ['custody_departure_successor_missing'],
    });
  });

  it('fails closed on an invalid or cyclic lineage graph', () => {
    const cyclic = input();
    cyclic.graph.edges.push({
      edgeId: 'edge:player-to-pick',
      kind: 'asset_traded_for_asset',
      sourceAssetId: 'asset:selected-player',
      targetAssetId: 'asset:future-pick',
      effectiveAt: '2022-10-01T00:00:00.000Z',
      knownFrom: '2022-10-01T00:00:00.000Z',
      knownTo: null,
      evidenceId: 'evidence:later-trade',
      ruleVersion: 'conserved-frontier/v1',
    });

    expect(derivePrivateGovernedPickAttribution(cyclic)).toMatchObject({
      state: 'unavailable',
      rootAssetId: 'asset:future-pick',
      reasons: ['lineage_graph_invalid'],
    });
  });
});
