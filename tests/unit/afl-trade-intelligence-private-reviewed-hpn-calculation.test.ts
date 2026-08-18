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

function reviewedInput() {
  const base = {
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
  const row = (
    ordinal: number,
    club: 'a' | 'b',
    identity:
      | { state: 'resolved'; canonicalPlayerId: string; identityDecisionId: string }
      | { state: 'quarantined'; reason: 'missing_source_identity'; recordedName: string | null },
    totalPoints: number,
    inside50s: number
  ) => ({
    providerDecodedRowId: `provider-row:${ordinal}`,
    sourceRowSha256: `${ordinal}`.repeat(64),
    typedPayloadSha256: `${ordinal + 4}`.repeat(64),
    matchId: 'local-afl-match:2025-03-01-club-a-club-b',
    matchDate: '2025-03-01',
    homeClubId: 'local-afl-club:a',
    awayClubId: 'local-afl-club:b',
    homePoints: 80,
    awayPoints: 70,
    playingForClubId: `local-afl-club:${club}`,
    playerIdentity: identity,
    stats: { ...base, totalPoints, inside50s },
  });
  const rows = [
    row(
      1,
      'a',
      {
        state: 'resolved',
        canonicalPlayerId: 'local-afl-player:100',
        identityDecisionId: 'identity-decision:100',
      },
      20,
      5
    ),
    row(
      2,
      'a',
      {
        state: 'resolved',
        canonicalPlayerId: 'local-afl-player:101',
        identityDecisionId: 'identity-decision:101',
      },
      15,
      4
    ),
    row(
      3,
      'b',
      {
        state: 'resolved',
        canonicalPlayerId: 'local-afl-player:200',
        identityDecisionId: 'identity-decision:200',
      },
      18,
      4
    ),
    row(
      4,
      'b',
      { state: 'quarantined', reason: 'missing_source_identity', recordedName: null },
      12,
      3
    ),
  ];
  const assembled = createAflTradeHpnReviewedSeasonUniverseCandidate({
    environment: 'non_production',
    competition: 'AFLM',
    seasonYear: 2025,
    captureId: 'capture:afl-tables:2025',
    normalizationRunId: `provider-normalization-run:${'a'.repeat(64)}`,
    resultFieldMapId: `hpn-pav-field-map:${'b'.repeat(64)}`,
    playerFieldMapId: `hpn-pav-field-map:${'c'.repeat(64)}`,
    resolvedReviewSetSha256: 'd'.repeat(64),
    normalizationReview: {
      status: 'needs_review',
      sourceRowCount: rows.length,
      acceptedRowCount: 3,
      issueCount: 1,
    },
    rows,
    createdAt,
  });
  const decision = createAflTradeHpnReviewedSeasonDecision({
    ...assembled,
    decision: 'approved',
    reviewerId: 'local-hpn-season-reviewer',
    rationale: 'Approve the exact numeric universe with one identity quarantined.',
    decidedAt: createdAt,
  });
  const reviewedSeason = sealAflTradeHpnReviewedSeasonUniverse({
    ...assembled,
    decision,
  });
  return { ...assembled, reviewedSeason };
}

describe('private calculation over an exact reviewed HPN season', () => {
  it('conserves the league pools and exposes resolved and quarantined allocations separately', () => {
    const reviewed = reviewedInput();
    const method = createAflTradePrivateReviewedHpnMethod();
    const calculation = calculateAflTradePrivateReviewedHpnSeason({
      reviewedSeason: reviewed.reviewedSeason,
      membership: reviewed.membership,
      method,
      calculatedAt: createdAt,
    });

    expect(calculation.content.league.totalPav).toBe(600);
    expect(calculation.content.teams.reduce((sum, team) => sum + team.totalPav, 0)).toBeCloseTo(
      600,
      8
    );
    expect(calculation.content.allocations).toHaveLength(4);
    expect(
      calculation.content.allocations.find(
        ({ identity }) =>
          identity.state === 'resolved' &&
          identity.canonicalPlayerId === 'local-afl-player:100'
      )?.gamesPlayed
    ).toBe(1);
    const quarantine = calculation.content.allocations.find(
      ({ identity }) => identity.state === 'quarantined'
    );
    expect(quarantine?.sourceRowIds).toEqual(['provider-row:4']);
    expect(quarantine?.identity).not.toHaveProperty('canonicalPlayerId');
    expect(calculation.content.reviewedSeasonId).toBe(
      reviewed.reviewedSeason.reviewedSeasonId
    );
    expect(calculation.content.publicationProhibited).toBe(true);
    expect(method.content.provenanceState).toBe(
      'repository_implemented_formula_not_source_recaptured'
    );
  });

  it('is deterministic and rejects membership substitution or calculation before review', () => {
    const reviewed = reviewedInput();
    const input = {
      reviewedSeason: reviewed.reviewedSeason,
      membership: reviewed.membership,
      method: createAflTradePrivateReviewedHpnMethod(),
      calculatedAt: createdAt,
    };
    expect(calculateAflTradePrivateReviewedHpnSeason(input)).toEqual(
      calculateAflTradePrivateReviewedHpnSeason(input)
    );
    expect(() =>
      calculateAflTradePrivateReviewedHpnSeason({
        ...input,
        membership: {
          ...reviewed.membership,
          content: { ...reviewed.membership.content, rows: reviewed.membership.content.rows.slice(1) },
        },
      })
    ).toThrow(/membership|content address/i);
    expect(() =>
      calculateAflTradePrivateReviewedHpnSeason({
        ...input,
        calculatedAt: '2026-08-16T05:59:59.000Z',
      })
    ).toThrow(/before review/i);
  });
});
