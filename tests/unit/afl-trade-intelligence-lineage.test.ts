import { describe, expect, it } from 'vitest';

import {
  buildAflTradeAttributionFrontier,
  findAflTradeAssetCustodian,
  type AflTradeLineageGraph,
  validateAflTradeAttribution,
  validateAflTradeLineageGraph,
} from '@/server/aflTradeIntelligence/domain/lineage';
import {
  AFL_TRADE_LINEAGE_FIXTURE_KINDS,
  buildAflTradeLineageFixture,
} from '@/server/aflTradeIntelligence/domain/lineageFixtures';
import { parseAflTradeTime } from '@/server/aflTradeIntelligence/domain/lineageTemporal';

function uniqueCodes<T extends { code: string }>(issues: readonly T[]) {
  return [...new Set(issues.map((issue) => issue.code))].sort();
}

describe('public AFL trade lineage fixtures', () => {
  it.each(AFL_TRADE_LINEAGE_FIXTURE_KINDS)('%s has its declared graph outcome', (kind) => {
    const fixture = buildAflTradeLineageFixture(kind);
    const result = validateAflTradeLineageGraph(fixture.graph);

    expect(result.valid).toBe(fixture.expectedGraphValid);
    expect(uniqueCodes(result.issues)).toEqual([...fixture.expectedGraphIssueCodes].sort());
  });

  it.each(
    AFL_TRADE_LINEAGE_FIXTURE_KINDS.flatMap((kind) => {
      const fixture = buildAflTradeLineageFixture(kind);
      return fixture.attributionChecks.map((check) => ({ kind, fixture, check }));
    })
  )('$kind/$check.checkId has its declared attribution outcome', ({ fixture, check }) => {
    const result = validateAflTradeAttribution(fixture.graph, check.request);

    expect(result.valid).toBe(check.expectedValid);
    expect(result.expectedFrontierAssetIds).toEqual(check.expectedFrontierAssetIds);
    expect(uniqueCodes(result.issues)).toEqual([...check.expectedIssueCodes].sort());
  });

  it('builds deterministic fresh fixture objects', () => {
    const first = buildAflTradeLineageFixture('future_pick_to_player');
    const second = buildAflTradeLineageFixture('future_pick_to_player');

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.graph).not.toBe(second.graph);
  });

  it('keeps fixture data fabricated and free of fantasy ownership fields', () => {
    const serialized = JSON.stringify(
      AFL_TRADE_LINEAGE_FIXTURE_KINDS.map(buildAflTradeLineageFixture)
    );

    expect(serialized).toContain('fixture:');
    expect(serialized).not.toMatch(/"(?:userId|leagueId|membershipId|rosterId|fantasySeasonId)"/);
  });
});

describe('public AFL trade lineage temporal and structural invariants', () => {
  it('parses only ISO date-only values or instants with explicit offsets', () => {
    expect(parseAflTradeTime('2024-10-10')).not.toBeNull();
    expect(parseAflTradeTime('2024-10-10T12:00:00.000Z')).not.toBeNull();
    expect(parseAflTradeTime('2024-10-10T12:00:00')).toBeNull();
    expect(parseAflTradeTime('Oct 10 2024')).toBeNull();
  });

  it('does not credit a root before it is effective and knowable', () => {
    const fixture = buildAflTradeLineageFixture('future_pick_to_player');
    const result = validateAflTradeAttribution(fixture.graph, {
      rootAssetIds: ['fixture:future-right-a'],
      creditedAssetIds: ['fixture:future-right-a'],
      effectiveAsOf: '2023-01-01T00:00:00.000Z',
      knowledgeCutoffAt: '2023-01-01T00:00:00.000Z',
    });

    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'root_not_visible' }));
    expect(result.expectedFrontierAssetIds).toEqual([]);
  });
  it('preserves one future-right identity across real AFL club custody handoffs', () => {
    const fixture = buildAflTradeLineageFixture('future_pick_to_player');
    const root = 'fixture:future-right-a';

    expect(
      findAflTradeAssetCustodian(fixture.graph.custodySpells, root, {
        effectiveAsOf: '2024-10-10T12:00:00.000Z',
        knowledgeCutoffAt: '2024-10-10T12:00:00.000Z',
      })
    ).toBe('fixture-club-a');
    expect(
      findAflTradeAssetCustodian(fixture.graph.custodySpells, root, {
        effectiveAsOf: '2024-10-11T12:00:00.000Z',
        knowledgeCutoffAt: '2024-10-11T12:00:00.000Z',
      })
    ).toBe('fixture-club-b');
  });

  it('uses knowledge time to select corrected evidence without traversing correction provenance', () => {
    const fixture = buildAflTradeLineageFixture('evidence_correction');
    const root = 'fixture:corrected-future-right';

    expect(
      buildAflTradeAttributionFrontier([root], fixture.graph.edges, {
        effectiveAsOf: '2026-01-01T00:00:00.000Z',
        knowledgeCutoffAt: '2025-11-15T00:00:00.000Z',
      })
    ).toEqual(['fixture:incorrect-current-pick']);
    expect(
      buildAflTradeAttributionFrontier([root], fixture.graph.edges, {
        effectiveAsOf: '2026-01-01T00:00:00.000Z',
        knowledgeCutoffAt: '2026-01-01T00:00:00.000Z',
      })
    ).toEqual(['fixture:correct-current-pick']);
  });

  it('rejects overlapping AFL club custody in the same knowledge version', () => {
    const fixture = buildAflTradeLineageFixture('future_pick_to_player');
    const overlap = {
      ...fixture.graph.custodySpells[1],
      custodySpellId: 'fixture:overlapping-custody',
      effectiveFrom: '2024-10-10T12:00:00.000Z',
    };
    const result = validateAflTradeLineageGraph({
      ...fixture.graph,
      custodySpells: [...fixture.graph.custodySpells, overlap],
    });

    expect(uniqueCodes(result.issues)).toContain('overlapping_custody');
  });

  it('accepts corrected custody versions whose knowledge intervals do not overlap', () => {
    const fixture = buildAflTradeLineageFixture('active_player');
    const original = {
      ...fixture.graph.custodySpells[0],
      knownTo: '2025-01-01T00:00:00.000Z',
    };
    const corrected = {
      ...original,
      custodySpellId: 'fixture:corrected-custody',
      effectiveTo: '2025-06-01T00:00:00.000Z',
      knownFrom: '2025-01-01T00:00:00.000Z',
      knownTo: null,
    };
    const result = validateAflTradeLineageGraph({
      ...fixture.graph,
      custodySpells: [original, corrected],
    });

    expect(result.issues).not.toContainEqual(
      expect.objectContaining({ code: 'overlapping_custody' })
    );
  });

  it('rejects a correction interval that closes before it becomes known', () => {
    const fixture = buildAflTradeLineageFixture('future_pick_to_player');
    const result = validateAflTradeLineageGraph({
      ...fixture.graph,
      edges: [
        {
          ...fixture.graph.edges[0],
          knownTo: '2025-09-01T00:00:00.000Z',
        },
      ],
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_knowledge_interval' })
    );
  });

  it('rejects an unsupported typed transformation', () => {
    const fixture = buildAflTradeLineageFixture('future_pick_to_player');
    const result = validateAflTradeLineageGraph({
      ...fixture.graph,
      edges: [
        {
          ...fixture.graph.edges[3],
          sourceAssetId: 'fixture:future-right-a',
        },
      ],
    });

    expect(uniqueCodes(result.issues)).toContain('invalid_edge_types');
  });

  it('reports an unknown edge kind without throwing', () => {
    const fixture = buildAflTradeLineageFixture('future_pick_to_player');
    const graph = {
      ...fixture.graph,
      edges: [{ ...fixture.graph.edges[0], kind: 'unknown_edge_kind' }],
    } as unknown as AflTradeLineageGraph;

    expect(validateAflTradeLineageGraph(graph).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_edge_types' })
    );
  });

  it('rejects conflicting active successor transformations', () => {
    const fixture = buildAflTradeLineageFixture('future_pick_to_player');
    const extraTarget = {
      ...fixture.graph.assets[1],
      assetId: 'fixture:second-current-pick',
    };
    const extraEdge = {
      ...fixture.graph.edges[0],
      edgeId: 'fixture:second-resolution',
      targetAssetId: extraTarget.assetId,
    };
    const result = validateAflTradeLineageGraph({
      ...fixture.graph,
      assets: [...fixture.graph.assets, extraTarget],
      edges: [...fixture.graph.edges, extraEdge],
    });

    expect(uniqueCodes(result.issues)).toContain('conflicting_successors');
  });

  it('rejects terminal assets that also have active successors', () => {
    const fixture = buildAflTradeLineageFixture('voided_asset');
    const target = {
      ...fixture.graph.assets[0],
      assetId: 'fixture:post-void-pick',
      effectiveFrom: '2025-10-01T00:00:00.000Z',
    };
    const result = validateAflTradeLineageGraph({
      ...fixture.graph,
      assets: [...fixture.graph.assets, target],
      edges: [
        {
          edgeId: 'fixture:post-void-edge',
          kind: 'pick_renumbered_to_pick',
          sourceAssetId: fixture.graph.assets[0].assetId,
          targetAssetId: target.assetId,
          effectiveAt: target.effectiveFrom,
          knownFrom: target.effectiveFrom,
          knownTo: null,
          evidenceId: 'fixture:post-void-evidence',
          ruleVersion: 'fabricated-fixture/v1',
        },
      ],
    });

    expect(uniqueCodes(result.issues)).toContain('terminal_asset_has_successor');
  });

  it('rejects conflicting terminal dispositions', () => {
    const fixture = buildAflTradeLineageFixture('voided_asset');
    const result = validateAflTradeLineageGraph({
      ...fixture.graph,
      dispositions: [
        ...fixture.graph.dispositions,
        {
          ...fixture.graph.dispositions[0],
          dispositionId: 'fixture:conflicting-expiry',
          kind: 'asset_expired',
        },
      ],
    });

    expect(uniqueCodes(result.issues)).toContain('conflicting_disposition');
  });

  it('rejects empty package containers and self-corrections', () => {
    const packageGraph: AflTradeLineageGraph = {
      assets: [
        {
          assetId: 'fixture:empty-package',
          assetType: 'package',
          effectiveFrom: '2024-01-01T00:00:00.000Z',
          knownFrom: '2024-01-01T00:00:00.000Z',
          knownTo: null,
          evidenceId: 'fixture:package-evidence',
        },
      ],
      custodySpells: [],
      edges: [],
      dispositions: [],
      corrections: [
        {
          correctionId: 'fixture:self-correction',
          kind: 'evidence_supersedes',
          supersededRecordId: 'fixture:same-record',
          replacementRecordId: 'fixture:same-record',
          knownAt: '2024-01-02T00:00:00.000Z',
          evidenceId: 'fixture:correction-evidence',
        },
      ],
    };

    expect(uniqueCodes(validateAflTradeLineageGraph(packageGraph).issues)).toEqual([
      'empty_package',
      'self_correction',
    ]);
  });

  it('requires every frontier asset to be credited or explicitly excluded exactly once', () => {
    const fixture = buildAflTradeLineageFixture('three_party_package');
    const pick = 'fixture:package-current-pick';
    const unresolved = 'fixture:package-unresolved-consideration';
    const result = validateAflTradeAttribution(fixture.graph, {
      rootAssetIds: ['fixture:player-ibis'],
      creditedAssetIds: [pick, unresolved],
      excludedAssetIds: [unresolved],
      effectiveAsOf: '2026-01-01T00:00:00.000Z',
      knowledgeCutoffAt: '2026-01-01T00:00:00.000Z',
    });

    expect(uniqueCodes(result.issues)).toEqual([
      'asset_both_credited_and_excluded',
      'non_value_bearing_credit',
    ]);
  });
});
