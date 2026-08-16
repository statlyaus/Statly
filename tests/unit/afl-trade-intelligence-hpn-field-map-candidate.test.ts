import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeHpnFieldMapCandidate,
  type AflTradeHpnSemanticBindingCandidate,
} from '@/server/aflTradeIntelligence/modeling/hpnFieldMapCandidate';
import { listAflTradeHpnRequiredSemanticFields } from '@/server/aflTradeIntelligence/modeling/hpnCalculationEligibility';

const createdAt = '2026-08-16T04:00:00.000Z';
const sourceSchemaSha256 = 'a'.repeat(64);
const aflTablesBindings: Record<string, string> = {
  player: 'ID',
  match: 'url',
  club: 'Team',
  hitOuts: 'Hit.Outs',
  goalAssists: 'Goal.Assists',
  inside50s: 'Inside.50s',
  marks: 'Marks',
  marksInside50: 'Marks.Inside.50',
  freeKicksFor: 'Frees.For',
  freeKicksAgainst: 'Frees.Against',
  rebound50s: 'Rebounds',
  onePercenters: 'One.Percenters',
  clearances: 'Clearances',
  tackles: 'Tackles',
};

function decodeMap(fields = [...new Set([...Object.values(aflTablesBindings), 'Goals', 'Behinds'])]) {
  return {
    mapId: 'afl-tables-player-stats-local-2025-v1',
    capabilityId: 'afl-tables-player-stats',
    sourceSchemaSha256,
    exactOrderedFields: fields,
  };
}

function bindings(): AflTradeHpnSemanticBindingCandidate[] {
  return listAflTradeHpnRequiredSemanticFields('player_match_stats').map(
    (semanticField) => ({
      semanticField,
      mapping:
        semanticField === 'totalPoints'
          ? { kind: 'goals_plus_behinds' as const, goals: 'Goals', behinds: 'Behinds' }
          : { kind: 'direct' as const, sourceField: aflTablesBindings[semanticField]! },
    })
  );
}

function candidate(overrides: {
  semanticBindings?: readonly AflTradeHpnSemanticBindingCandidate[];
  decodeMap?: ReturnType<typeof decodeMap>;
} = {}) {
  const providerDecodeMap = overrides.decodeMap ?? decodeMap();
  return createAflTradeHpnFieldMapCandidate({
    environment: 'non_production',
    competition: 'AFLM',
    provider: 'afl_tables',
    capabilityId: 'afl-tables-player-stats',
    sourceSchemaSha256,
    inputKind: 'player_match_stats',
    validFromSeason: 2021,
    validThroughSeason: 2025,
    providerDecodeMap,
    providerDecodeMapArtifact: createAflTradeCanonicalJsonArtifactRef(
      providerDecodeMap,
      createdAt
    ),
    semanticBindings: overrides.semanticBindings ?? bindings(),
    createdAt,
  });
}

describe('HPN field-map review candidate', () => {
  it('seals every semantic binding while remaining structurally unapproved', () => {
    const first = candidate();
    const second = candidate({ semanticBindings: [...bindings()].reverse() });

    expect(first).toEqual(second);
    expect(first.candidateId).toMatch(/^hpn-field-map-candidate:[a-f0-9]{64}$/);
    expect(first.content).toMatchObject({
      reviewState: 'requires_review',
      inputKind: 'player_match_stats',
      semanticBindings: expect.arrayContaining([
        {
          semanticField: 'hitOuts',
          mapping: { kind: 'direct', sourceField: 'Hit.Outs' },
        },
        {
          semanticField: 'totalPoints',
          mapping: { kind: 'goals_plus_behinds', goals: 'Goals', behinds: 'Behinds' },
        },
      ]),
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(first.content).not.toHaveProperty('approvalDecision');
  });

  it('rejects incomplete semantic coverage and source fields absent from the decode map', () => {
    expect(() => candidate({ semanticBindings: bindings().slice(1) })).toThrow(
      /every required HPN semantic field/i
    );
    expect(() =>
      candidate({
        decodeMap: decodeMap(
          [...new Set([...Object.values(aflTablesBindings), 'Goals', 'Behinds'])].filter(
            (field) => field !== 'Hit.Outs'
          )
        ),
      })
    ).toThrow(/must exist in the exact provider decode map/i);
  });

  it('rejects an inexact provider decode-map artifact', () => {
    const providerDecodeMap = decodeMap();
    expect(() =>
      createAflTradeHpnFieldMapCandidate({
        environment: 'non_production',
        competition: 'AFLM',
        provider: 'afl_tables',
        capabilityId: 'afl-tables-player-stats',
        sourceSchemaSha256,
        inputKind: 'player_match_stats',
        validFromSeason: 2021,
        validThroughSeason: 2025,
        providerDecodeMap,
        providerDecodeMapArtifact: createAflTradeCanonicalJsonArtifactRef(
          { not: 'the decode map' },
          createdAt
        ),
        semanticBindings: bindings(),
        createdAt,
      })
    ).toThrow(/exact provider decode-map artifact/i);
  });
});
