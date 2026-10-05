import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
  aflTradeFinalizedHpnPavCalculationSchema,
} from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';
import {
  admitPrivateGovernedPlayerEvidence,
  derivePrivateGovernedPlayerRequiredHorizons,
} from '@/server/aflTradeIntelligence/valuation/privateGovernedPlayerEvidence';

const admittedAt = '2026-08-17T12:00:00.000Z';
const sha = (value: string) => createAflTradeContentAddress('fixture', value).split(':')[1]!;
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const evidence = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, admittedAt);
const methodId = addressed('hpn-pav-method', 'retained-hpn-method');
const spellVersionId = addressed('acquisition-spell-version', 'dawson-adelaide');

const sourceStats = {
  totalPoints: 10,
  hitOuts: 1,
  goalAssists: 2,
  inside50s: 3,
  marks: 4,
  marksInside50: 1,
  freeKicksFor: 2,
  freeKicksAgainst: 1,
  rebound50s: 2,
  onePercenters: 3,
  clearances: 4,
  tackles: 5,
};

function calculation(seasonYear: number, gamesPlayed: number, effectiveThrough: string) {
  const core = calculateAflTradeHpnPavCore([
    {
      teamId: 'local-afl-club:adelaide',
      pointsFor: 100,
      pointsAgainst: 80,
      inside50sFor: 50,
      inside50sAgainst: 40,
      players: [
        {
          spellVersionId,
          playerId: 'local-afl-player:12516',
          sourceRowIds: Array.from(
            { length: gamesPlayed },
            (_, index) => `row:${seasonYear}:dawson:${index + 1}`
          ),
          ...sourceStats,
        },
      ],
    },
    {
      teamId: 'local-afl-club:comparison',
      pointsFor: 80,
      pointsAgainst: 100,
      inside50sFor: 40,
      inside50sAgainst: 50,
      players: [
        {
          spellVersionId: addressed('acquisition-spell-version', `comparison:${seasonYear}`),
          playerId: `local-afl-player:comparison:${seasonYear}`,
          sourceRowIds: [`row:${seasonYear}:comparison`],
          ...sourceStats,
        },
      ],
    },
  ]);
  const content = {
    schemaVersion: AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
    authorityBoundary:
      'private_finalized_hpn_input_exact_method_bytes_no_publication_or_fantasy_ownership' as const,
    publicationEligible: false as const,
    environment: 'non_production' as const,
    competition: 'AFLM' as const,
    seasonYear,
    effectiveThrough,
    calculatedAt: admittedAt,
    methodId,
    inputSetId: addressed('hpn-pav-input-set', `input:${seasonYear}`),
    inputSetSha256: sha(`input:${seasonYear}`),
    factualRunId: addressed('factual-reconciliation-run', `facts:${seasonYear}`),
    factualInputSetSha256: sha(`facts:${seasonYear}`),
    primaryProviders: ['retained_primary'],
    corroboratingProviders: ['retained_corroborating'],
    resultSourceRowIds: [`row:${seasonYear}:result`],
    valueUnit: 'season_pav' as const,
    ...core,
    players: core.players.map((player) => ({
      ...player,
      source: {
        ...player.source,
        gamesPlayed:
          player.spellVersionId === spellVersionId ? gamesPlayed : 1,
      },
    })),
  };
  return aflTradeFinalizedHpnPavCalculationSchema.parse({
    calculationId: createAflTradeContentAddress('hpn-pav-season', content),
    content,
  });
}

function input() {
  const current = calculation(2026, 12, '2026-05-28T12:00:00.000Z');
  return {
    confirmedResultArtifact: evidence('confirmed-result'),
    asset: {
      assetId: 'asset-player-dawson',
      canonicalPlayerId: 'local-afl-player:12516',
      receivingClubId: 'local-afl-club:adelaide',
      acquisitionSpellVersionId: spellVersionId,
      acquisitionSpellStartDate: '2021-10-13',
      acquisitionSpellEndDate: null,
      tradeYear: 2021,
      knowledgeCutoffAt: admittedAt,
    },
    expectedHorizons: [
      ...[2022, 2023, 2024, 2025].map((season) => {
        const completed = calculation(season, 22, `${season}-09-24T12:00:00.000Z`);
        return {
          kind: 'completed_season' as const,
          season,
          coverage: 'complete' as const,
          coverageEvidenceRef: evidence(`season-${season}-complete`),
          calculation: completed,
          calculationArtifact: createAflTradeCanonicalJsonArtifactRef(completed, admittedAt),
        };
      }),
      {
        kind: 'current_season' as const,
        season: 2026,
        coverage: 'right_censored' as const,
        coverageEvidenceRef: evidence('season-2026-right-censored'),
        calculation: current,
        calculationArtifact: createAflTradeCanonicalJsonArtifactRef(current, admittedAt),
      },
    ],
    admittedAt,
  };
}

describe('private governed player evidence', () => {
  it('admits exact completed and right-censored HPN/PAV horizons for one acquisition spell', () => {
    expect(derivePrivateGovernedPlayerRequiredHorizons(input().asset)).toEqual([
      ...[2022, 2023, 2024, 2025].map((season) => ({
        kind: 'completed_season',
        season,
      })),
      { kind: 'current_season', season: 2026 },
    ]);
    const result = admitPrivateGovernedPlayerEvidence(input());

    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('Expected player evidence admission.');
    expect(
      result.admission.content.horizons.map(({ kind, season, gamesPlayed, coverage }) => ({
        kind,
        season,
        gamesPlayed,
        coverage,
      }))
    ).toEqual([
      ...[2022, 2023, 2024, 2025].map((season) => ({
        kind: 'completed_season',
        season,
        gamesPlayed: 22,
        coverage: 'complete',
      })),
      {
        kind: 'current_season',
        season: 2026,
        gamesPlayed: 12,
        coverage: 'right_censored',
      },
    ]);
    expect(result.admission.content.horizons[0]?.source).toEqual(sourceStats);
    expect(result.admission.content.publicationProhibited).toBe(true);
  });

  it('rejects a caller that omits a required post-trade completed season', () => {
    const omitted = input();
    omitted.expectedHorizons = omitted.expectedHorizons.filter(({ season }) => season !== 2024);

    expect(admitPrivateGovernedPlayerEvidence(omitted)).toMatchObject({
      state: 'unavailable',
      assetId: 'asset-player-dawson',
      reasons: ['hpn_required_horizon_missing'],
    });
  });

  it('keeps a required season unavailable when its calculation is missing', () => {
    const missing = input();
    missing.expectedHorizons[1] = {
      ...missing.expectedHorizons[1]!,
      calculation: null,
      calculationArtifact: null,
    };

    const result = admitPrivateGovernedPlayerEvidence(missing);
    expect(result).toMatchObject({
      state: 'unavailable',
      assetId: 'asset-player-dawson',
      reasons: ['hpn_season_calculation_missing'],
    });
    expect(result.evidenceRefs).toContainEqual(missing.confirmedResultArtifact);
    expect(result.evidenceRefs).not.toContain(null);
  });
});
