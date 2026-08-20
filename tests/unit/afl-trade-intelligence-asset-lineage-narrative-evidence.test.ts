import { describe, expect, it } from 'vitest';

import { buildAflTradeLineageFixture } from '@/server/aflTradeIntelligence/domain/lineageFixtures';
import { deriveAflTradeAssetLineageNarrativeEvidence } from '@/server/aflTradeIntelligence/valuation/assetLineageNarrativeEvidence';

const cutoff = {
  effectiveAsOf: '2026-01-01T00:00:00.000Z',
  knowledgeCutoffAt: '2026-01-01T00:00:00.000Z',
};
const display = {
  assets: [
    { assetId: 'fixture:future-right-a', label: '2024 future first-round pick' },
    { assetId: 'fixture:current-pick-9', label: 'Pick 9' },
    { assetId: 'fixture:current-pick-12', label: 'Pick 12' },
    { assetId: 'fixture:draft-selection-12', label: '2024 draft selection 12' },
    { assetId: 'fixture:player-kestrel', label: 'Kestrel Player' },
  ],
  clubs: [
    { aflClubId: 'fixture-club-a', clubName: 'Fixture Club A' },
    { aflClubId: 'fixture-club-b', clubName: 'Fixture Club B' },
  ],
};

describe('asset lineage narrative evidence', () => {
  it('projects an ordered future-pick-to-player story with custody handoffs', () => {
    const graph = buildAflTradeLineageFixture('future_pick_to_player').graph;
    const evidence = deriveAflTradeAssetLineageNarrativeEvidence(
      graph,
      'fixture:future-right-a',
      cutoff,
      display
    );

    expect(evidence.nodes.map(({ assetId, assetType, depth }) => ({
      assetId,
      assetType,
      depth,
    }))).toEqual([
      { assetId: 'fixture:future-right-a', assetType: 'future_pick_entitlement', depth: 0 },
      { assetId: 'fixture:current-pick-9', assetType: 'current_pick_entitlement', depth: 1 },
      { assetId: 'fixture:current-pick-12', assetType: 'current_pick_entitlement', depth: 2 },
      { assetId: 'fixture:draft-selection-12', assetType: 'draft_selection', depth: 3 },
      { assetId: 'fixture:player-kestrel', assetType: 'player', depth: 4 },
    ]);
    expect(evidence.transformations.map(({ kind }) => kind)).toEqual([
      'future_right_resolved_to_pick',
      'pick_renumbered_to_pick',
      'pick_exercised_at_selection',
      'selection_created_player',
    ]);
    expect(evidence.nodes.map(({ label }) => label)).toEqual([
      '2024 future first-round pick',
      'Pick 9',
      'Pick 12',
      '2024 draft selection 12',
      'Kestrel Player',
    ]);
    expect(evidence.transformations.at(-1)).toMatchObject({
      sourceLabel: '2024 draft selection 12',
      targetLabel: 'Kestrel Player',
    });
    expect(
      evidence.custodyHistory
        .filter(({ assetId }) => assetId === 'fixture:future-right-a')
        .map(({ aflClubId, clubName }) => ({ aflClubId, clubName }))
    ).toEqual([
      { aflClubId: 'fixture-club-a', clubName: 'Fixture Club A' },
      { aflClubId: 'fixture-club-b', clubName: 'Fixture Club B' },
    ]);
    expect(evidence.frontierAssetIds).toEqual(['fixture:player-kestrel']);
  });

  it('rejects invalid lineage rather than rendering a plausible story', () => {
    const graph = buildAflTradeLineageFixture('invalid_cycle').graph;

    expect(() =>
      deriveAflTradeAssetLineageNarrativeEvidence(graph, graph.assets[0]!.assetId, cutoff, display)
    ).toThrow(/valid authenticated lineage graph/i);
  });
});
