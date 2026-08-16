import {
  createAflTradeHpnReviewedSeasonDecision,
  createAflTradeHpnReviewedSeasonUniverseCandidate,
  sealAflTradeHpnReviewedSeasonUniverse,
} from '@/server/aflTradeIntelligence/modeling/hpnReviewedSeasonUniverse';

const createdAt = '2026-08-16T06:00:00.000Z';
const zeroStats = {
  totalPoints: 6,
  hitOuts: 0,
  goalAssists: 0,
  inside50s: 1,
  marks: 1,
  marksInside50: 0,
  freeKicksFor: 0,
  freeKicksAgainst: 0,
  rebound50s: 0,
  onePercenters: 0,
  clearances: 0,
  tackles: 1,
};

function rows() {
  return [
    {
      providerDecodedRowId: 'provider-row:1',
      sourceRowSha256: '1'.repeat(64),
      typedPayloadSha256: '2'.repeat(64),
      matchId: 'local-afl-match:2025-03-01-club-a-club-b',
      matchDate: '2025-03-01',
      homeClubId: 'local-afl-club:club-a',
      awayClubId: 'local-afl-club:club-b',
      homePoints: 80,
      awayPoints: 70,
      playingForClubId: 'local-afl-club:club-a',
      playerIdentity: {
        state: 'resolved' as const,
        canonicalPlayerId: 'local-afl-player:100',
        identityDecisionId: 'local-afl-tables-review:identity:candidate-1',
      },
      stats: zeroStats,
    },
    {
      providerDecodedRowId: 'provider-row:2',
      sourceRowSha256: '3'.repeat(64),
      typedPayloadSha256: '4'.repeat(64),
      matchId: 'local-afl-match:2025-03-01-club-a-club-b',
      matchDate: '2025-03-01',
      homeClubId: 'local-afl-club:club-a',
      awayClubId: 'local-afl-club:club-b',
      homePoints: 80,
      awayPoints: 70,
      playingForClubId: 'local-afl-club:club-b',
      playerIdentity: {
        state: 'quarantined' as const,
        reason: 'missing_source_identity' as const,
        recordedName: null,
      },
      stats: { ...zeroStats, totalPoints: 12, inside50s: 2 },
    },
  ];
}

describe('reviewed HPN league-season universe', () => {
  it('preserves complete numeric membership while quarantining unresolved identity', () => {
    const assembled = createAflTradeHpnReviewedSeasonUniverseCandidate({
      environment: 'non_production',
      competition: 'AFLM',
      seasonYear: 2025,
      captureId: 'capture:afl-tables:2025',
      normalizationRunId: `provider-normalization-run:${'5'.repeat(64)}`,
      resultFieldMapId: `hpn-pav-field-map:${'6'.repeat(64)}`,
      playerFieldMapId: `hpn-pav-field-map:${'7'.repeat(64)}`,
      resolvedReviewSetSha256: '8'.repeat(64),
      normalizationReview: {
        status: 'staged',
        sourceRowCount: 2,
        acceptedRowCount: 2,
        issueCount: 0,
      },
      rows: rows(),
      createdAt,
    });
    const decision = createAflTradeHpnReviewedSeasonDecision({
      candidate: assembled.candidate,
      candidateArtifact: assembled.candidateArtifact,
      membership: assembled.membership,
      membershipArtifact: assembled.membershipArtifact,
      decision: 'approved',
      reviewerId: 'local-hpn-season-reviewer',
      rationale: 'Approve exact complete numerics with unresolved identities quarantined.',
      decidedAt: createdAt,
    });
    const reviewed = sealAflTradeHpnReviewedSeasonUniverse({
      candidate: assembled.candidate,
      candidateArtifact: assembled.candidateArtifact,
      membership: assembled.membership,
      membershipArtifact: assembled.membershipArtifact,
      decision,
    });

    expect(reviewed.content.counts).toEqual({
      sourceRows: 2,
      completedMatches: 1,
      resolvedIdentityRows: 1,
      quarantinedIdentityRows: 1,
    });
    expect(reviewed.content.identityCoverage).toBe('partial_with_explicit_quarantine');
    expect(reviewed.content.numericalCoverage).toBe('complete');
    expect(reviewed.content.publicationProhibited).toBe(true);
  });

  it('rejects row loss, conflicting match scores, and a quarantined row with a canonical identity', () => {
    const invalid = rows();
    invalid[1] = {
      ...invalid[1]!,
      homePoints: 81,
      playerIdentity: {
        state: 'quarantined',
        reason: 'missing_source_identity',
        recordedName: null,
        canonicalPlayerId: 'invented',
      } as never,
    };
    expect(() =>
      createAflTradeHpnReviewedSeasonUniverseCandidate({
        environment: 'non_production',
        competition: 'AFLM',
        seasonYear: 2025,
        captureId: 'capture:afl-tables:2025',
        normalizationRunId: `provider-normalization-run:${'5'.repeat(64)}`,
        resultFieldMapId: `hpn-pav-field-map:${'6'.repeat(64)}`,
        playerFieldMapId: `hpn-pav-field-map:${'7'.repeat(64)}`,
        resolvedReviewSetSha256: '8'.repeat(64),
        normalizationReview: {
          status: 'needs_review',
          sourceRowCount: 2,
          acceptedRowCount: 1,
          issueCount: 1,
        },
        rows: invalid,
        createdAt,
      })
    ).toThrow(/canonicalPlayerId|reviewed season universe/i);
  });
});
