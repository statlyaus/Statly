import type { DraftTradeDetail } from '@/lib/draftTrades/read';
import {
  projectLocalPrivateReviewedTradeCalculation,
  type LocalPrivateReviewedPlayerIdentityEvidence,
} from '@/server/aflTradeIntelligence/development/localPrivateReviewedTradeCalculation';
import {
  calculateAflTradePrivateReviewedHpnSeason,
  createAflTradePrivateReviewedHpnMethod,
} from '@/server/aflTradeIntelligence/modeling/privateReviewedHpnCalculation';
import {
  createAflTradeHpnReviewedSeasonDecision,
  createAflTradeHpnReviewedSeasonUniverseCandidate,
  sealAflTradeHpnReviewedSeasonUniverse,
} from '@/server/aflTradeIntelligence/modeling/hpnReviewedSeasonUniverse';

const createdAt = '2026-08-16T06:00:00.000Z';
const method = createAflTradePrivateReviewedHpnMethod();

function calculation(seasonYear: number, playerClub: 'a' | 'b') {
  const stats = {
    hitOuts: 1,
    goalAssists: 1,
    marks: 4,
    marksInside50: 1,
    freeKicksFor: 2,
    freeKicksAgainst: 1,
    rebound50s: 2,
    onePercenters: 2,
    clearances: 3,
    tackles: 4,
  };
  const opponentClub = playerClub === 'a' ? 'b' : 'a';
  const rows = [
    {
      providerDecodedRowId: `provider-row:${seasonYear}:player`,
      sourceRowSha256: '1'.repeat(64),
      typedPayloadSha256: '2'.repeat(64),
      matchId: `local-afl-match:${seasonYear}:1`,
      matchDate: `${seasonYear}-03-01`,
      homeClubId: 'local-afl-club:a',
      awayClubId: 'local-afl-club:b',
      homePoints: 80,
      awayPoints: 70,
      playingForClubId: `local-afl-club:${playerClub}`,
      playerIdentity: {
        state: 'resolved' as const,
        canonicalPlayerId: 'local-afl-player:100',
        identityDecisionId: `identity-review:${seasonYear}:100`,
      },
      stats: { ...stats, totalPoints: 20, inside50s: 5 },
    },
    {
      providerDecodedRowId: `provider-row:${seasonYear}:opponent`,
      sourceRowSha256: '3'.repeat(64),
      typedPayloadSha256: '4'.repeat(64),
      matchId: `local-afl-match:${seasonYear}:1`,
      matchDate: `${seasonYear}-03-01`,
      homeClubId: 'local-afl-club:a',
      awayClubId: 'local-afl-club:b',
      homePoints: 80,
      awayPoints: 70,
      playingForClubId: `local-afl-club:${opponentClub}`,
      playerIdentity: {
        state: 'resolved' as const,
        canonicalPlayerId: `local-afl-player:${seasonYear}`,
        identityDecisionId: `identity-review:${seasonYear}:opponent`,
      },
      stats: { ...stats, totalPoints: 15, inside50s: 4 },
    },
  ];
  const assembled = createAflTradeHpnReviewedSeasonUniverseCandidate({
    environment: 'non_production',
    competition: 'AFLM',
    seasonYear,
    captureId: `capture:${seasonYear}`,
    normalizationRunId: `provider-normalization-run:${String(seasonYear).padStart(64, '0')}`,
    resultFieldMapId: `hpn-pav-field-map:${'5'.repeat(64)}`,
    playerFieldMapId: `hpn-pav-field-map:${'6'.repeat(64)}`,
    resolvedReviewSetSha256: '7'.repeat(64),
    normalizationReview: {
      status: 'staged',
      sourceRowCount: 2,
      acceptedRowCount: 2,
      issueCount: 0,
    },
    rows,
    createdAt,
  });
  const decision = createAflTradeHpnReviewedSeasonDecision({
    ...assembled,
    decision: 'approved',
    reviewerId: 'local-reviewer',
    rationale: 'Approve exact reviewed season.',
    decidedAt: createdAt,
  });
  return calculateAflTradePrivateReviewedHpnSeason({
    reviewedSeason: sealAflTradeHpnReviewedSeasonUniverse({ ...assembled, decision }),
    membership: assembled.membership,
    method,
    calculatedAt: createdAt,
  });
}

const detail: DraftTradeDetail = {
  trade: {
    tradeId: 'workbook-2024-example',
    year: 2024,
    seqInYear: 1,
    title: 'Example trade',
    clubSlugs: ['a', 'b'],
    clubNames: ['Club A', 'Club B'],
    partyCount: 2,
    assetCount: 2,
    hasPlayers: true,
    hasPicks: true,
    hasFuturePicks: false,
    receivesByClub: [
      {
        clubSlug: 'b',
        clubName: 'Club B',
        assetCount: 2,
        playerCount: 1,
        pickCount: 1,
        futurePickCount: 0,
      },
    ],
  },
  parties: [],
  assets: [
    {
      id: 'asset-player',
      tradeId: 'workbook-2024-example',
      year: 2024,
      clubSlug: 'b',
      clubName: 'Club B',
      assetIndex: 1,
      assetType: 'player',
      assetText: 'Player One',
      playerName: 'Player One',
      pick: {
        code: null,
        numberGiven: null,
        year: null,
        round: null,
        originalClub: null,
        numberActual: null,
      },
      draftedPlayer: null,
      games: null,
      note: null,
    },
    {
      id: 'asset-pick',
      tradeId: 'workbook-2024-example',
      year: 2024,
      clubSlug: 'b',
      clubName: 'Club B',
      assetIndex: 2,
      assetType: 'pick',
      assetText: '#12',
      playerName: null,
      pick: {
        code: '12',
        numberGiven: 12,
        year: null,
        round: null,
        originalClub: null,
        numberActual: null,
      },
      draftedPlayer: null,
      games: null,
      note: null,
    },
  ],
};

const identity: LocalPrivateReviewedPlayerIdentityEvidence = {
  recordedName: 'Player One',
  canonicalPlayerId: 'local-afl-player:100',
  identityDecisionIds: ['identity-review:2024:100', 'identity-review:2025:100'],
  reviewedSeasonIds: [
    calculation(2024, 'a').content.reviewedSeasonId,
    calculation(2025, 'b').content.reviewedSeasonId,
  ],
};

describe('local private reviewed trade calculation projection', () => {
  it('shows an at-trade season and realized post-trade components while blocking unsupported picks', () => {
    const projected = projectLocalPrivateReviewedTradeCalculation({
      detail,
      workbookSha256: '8'.repeat(64),
      identities: [identity],
      calculations: [calculation(2024, 'a'), calculation(2025, 'b')],
      outcomesByAssetId: new Map([
        [
          'asset-player',
          {
            source: 'reconciled_acquisition_spell',
            effectiveThrough: '2026-08-15T00:00:00.000Z',
            metrics: {
              games: {
                state: 'partial',
                observedValue: 12,
                reason: 'active_career_right_censored',
              },
              goals: { state: 'unavailable', reason: 'source_missing' },
              coachesVotes: { state: 'unavailable', reason: 'source_missing' },
              brownlowVotes: { state: 'unavailable', reason: 'source_missing' },
            },
          },
        ],
      ]),
    });
    const player = projected.assets[0];
    expect(player?.state).toBe('calculated');
    if (player?.state !== 'calculated') throw new Error('Expected calculated player.');
    expect(player.atTrade.state).toBe('available');
    expect(player.realized.state).toBe('available');
    expect(player.realized.gamesPlayed).toBe(1);
    expect(player.realized.seasons).toEqual([2025]);
    expect(player.realized.components.offensivePav).toBeGreaterThan(0);
    expect(player.postTradeGames).toMatchObject({
      state: 'partial',
      gamesPlayed: 12,
      rightCensored: true,
    });
    expect(projected.assets[1]).toMatchObject({
      state: 'unavailable',
      reason: 'selection_lineage_not_reviewed',
    });
    expect(projected.overallGrade).toEqual({
      state: 'unavailable',
      reason: 'asset_values_incomplete_and_distribution_unavailable',
    });
    expect(projected.publicationProhibited).toBe(true);
  });

  it('fails closed for ambiguous player-name identity and missing post-trade seasons', () => {
    const ambiguous = projectLocalPrivateReviewedTradeCalculation({
      detail,
      workbookSha256: '8'.repeat(64),
      identities: [
        identity,
        { ...identity, canonicalPlayerId: 'local-afl-player:other' },
      ],
      calculations: [calculation(2024, 'a')],
    });
    expect(ambiguous.assets[0]).toMatchObject({
      state: 'unavailable',
      reason: 'player_identity_ambiguous',
    });
  });
});
