import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeHpnFieldMapCandidate,
  type AflTradeHpnSemanticBindingCandidate,
} from '@/server/aflTradeIntelligence/modeling/hpnFieldMapCandidate';
import { listAflTradeHpnRequiredSemanticFields } from '@/server/aflTradeIntelligence/modeling/hpnCalculationEligibility';
import {
  createLocalAflTradeHpnCompletedResultFieldMapCandidate,
  createLocalAflTradeHpnPlayerFieldMapCandidate,
} from '@/server/aflTradeIntelligence/development/localHpnFieldMapCandidates';
import {
  createLocalAflTradeAflTablesResultsAuthority,
  createLocalAflTradeFiveSeasonAflTablesAuthority,
} from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { createLocalAflTradeOfficialAfl2026Authority } from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Authority';

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

  it('builds exact unapproved candidates for both retained player-stat providers', () => {
    const aflTables = createLocalAflTradeFiveSeasonAflTablesAuthority(2025).fieldMap;
    const official = createLocalAflTradeOfficialAfl2026Authority().fieldMap;
    const aflTablesCandidate = createLocalAflTradeHpnPlayerFieldMapCandidate({
      provider: 'afl_tables',
      seasonYear: 2025,
      providerDecodeMap: aflTables,
      providerDecodeMapArtifact: createAflTradeCanonicalJsonArtifactRef(
        aflTables,
        createdAt
      ),
      createdAt,
    });
    const officialCandidate = createLocalAflTradeHpnPlayerFieldMapCandidate({
      provider: 'official_afl',
      seasonYear: 2026,
      providerDecodeMap: official,
      providerDecodeMapArtifact: createAflTradeCanonicalJsonArtifactRef(
        official,
        createdAt
      ),
      createdAt,
    });

    expect(
      aflTablesCandidate.content.semanticBindings.find(
        ({ semanticField }) => semanticField === 'match'
      )
    ).toMatchObject({
      mapping: {
        kind: 'composite_key',
        sourceFields: ['Date', 'Home.team', 'Away.team'],
      },
    });
    expect(
      aflTablesCandidate.content.semanticBindings.find(
        ({ semanticField }) => semanticField === 'club'
      )
    ).toMatchObject({ mapping: { kind: 'direct', sourceField: 'Playing.for' } });
    expect(
      officialCandidate.content.semanticBindings.find(
        ({ semanticField }) => semanticField === 'clearances'
      )
    ).toMatchObject({
      mapping: { kind: 'direct', sourceField: 'clearances.totalClearances' },
    });
    expect(aflTablesCandidate.content.reviewState).toBe('requires_review');
    expect(officialCandidate.content.reviewState).toBe('requires_review');
  });

  it('proposes an explicit reviewed final-score projection instead of inventing a status field', () => {
    const providerDecodeMap = createLocalAflTradeAflTablesResultsAuthority(2026).fieldMap;
    const resultCandidate = createLocalAflTradeHpnCompletedResultFieldMapCandidate({
      seasonYear: 2026,
      providerDecodeMap,
      providerDecodeMapArtifact: createAflTradeCanonicalJsonArtifactRef(
        providerDecodeMap,
        createdAt
      ),
      createdAt,
    });

    expect(resultCandidate.content).toMatchObject({
      inputKind: 'completed_match_result',
      completionRule: {
        kind: 'reviewed_final_score_presence',
        decisionRequired: true,
      },
      reviewState: 'requires_review',
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(
      resultCandidate.content.semanticBindings.find(
        ({ semanticField }) => semanticField === 'match'
      )
    ).toMatchObject({
      mapping: {
        kind: 'composite_key',
        sourceFields: ['Date', 'Home.Team', 'Away.Team'],
      },
    });
    expect(
      resultCandidate.content.semanticBindings.find(
        ({ semanticField }) => semanticField === 'completionStatus'
      )
    ).toMatchObject({
      mapping: {
        kind: 'reviewed_final_scores',
        matchDateField: 'Date',
        homePointsField: 'Home.Points',
        awayPointsField: 'Away.Points',
      },
    });
    expect(resultCandidate.content).not.toHaveProperty('completedValues');
  });
});
