import { describe, expect, it } from 'vitest';

import { reconcileLocalScopedAflcaVotes } from '@/server/aflTradeIntelligence/development/localScopedAflcaReconciliation';

const participants = [
  ['Sam Walsh', 'Carlton', 'player-carlton-sam'],
  ['Patrick Cripps', 'Carlton', 'player-carlton-patrick'],
  ['Tom Lynch', 'Richmond', 'player-richmond-tom'],
  ['Joshua Kennedy', 'Richmond', 'player-richmond-joshua'],
] as const;

function aflTablesParticipants() {
  return participants.map(([recordedPlayerName, recordedClubName, canonicalPlayerClubId]) => ({
    seasonYear: 2025,
    roundNumber: 1,
    homeClubName: 'Richmond',
    awayClubName: 'Carlton',
    recordedPlayerName,
    recordedClubName,
    canonicalPlayerClubId,
    canonicalMatchId: 'match-2025-1-richmond-carlton',
  }));
}

function vote(
  index: number,
  recordedPlayerName: string,
  numericVotes: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    providerDecodedRowId: `row-${index}`,
    identityCandidateId: `identity-${index}`,
    matchCandidateId: `match-candidate-${index}`,
    seasonYear: 2025,
    roundNumber: 1,
    awardScope: 'home_and_away',
    homeClubName: 'Richmond',
    awayClubName: 'Carlton',
    recordedPlayerName,
    numericVotes,
    ...overrides,
  };
}

describe('scoped AFLCA reconciliation', () => {
  it('resolves exact and bounded provider name variants inside one reviewed match lineup', () => {
    const result = reconcileLocalScopedAflcaVotes({
      expectedParticipants: aflTablesParticipants(),
      votes: [
        vote(1, 'Sam Walsh (CARL)', 10),
        vote(2, 'Patrick Cripps (CARL)', 8),
        vote(3, 'Tom J Lynch (RICH)', 7),
        vote(4, 'Josh Kennedy (RICH)', 5),
      ],
    });

    expect(result).toMatchObject({
      matchCount: 1,
      voteRowCount: 4,
      totalVotes: 30,
      reconciled: [
        {
          canonicalPlayerClubId: 'player-carlton-sam',
          canonicalMatchId: 'match-2025-1-richmond-carlton',
          numericVotes: 10,
        },
        { canonicalPlayerClubId: 'player-carlton-patrick', numericVotes: 8 },
        { canonicalPlayerClubId: 'player-richmond-tom', numericVotes: 7 },
        { canonicalPlayerClubId: 'player-richmond-joshua', numericVotes: 5 },
      ],
    });
  });

  it('normalizes only the reviewed AFLCA club vocabulary', () => {
    const expected = aflTablesParticipants().map((participant) => ({
      ...participant,
      homeClubName: 'Adelaide',
      awayClubName: 'Carlton',
      recordedClubName: participant.recordedClubName === 'Carlton' ? 'Carlton' : 'Adelaide',
      canonicalMatchId: 'match-2025-1-adelaide-carlton',
    }));
    const result = reconcileLocalScopedAflcaVotes({
      expectedParticipants: expected,
      votes: [
        vote(1, 'Sam Walsh (CARL)', 10, { homeClubName: 'Adelaide Crows' }),
        vote(2, 'Patrick Cripps (CARL)', 8, { homeClubName: 'Adelaide Crows' }),
        vote(3, 'Tom J Lynch (ADEL)', 7, { homeClubName: 'Adelaide Crows' }),
        vote(4, 'Josh Kennedy (ADEL)', 5, { homeClubName: 'Adelaide Crows' }),
      ],
    });

    expect(result.matchCount).toBe(1);
  });

  it('resolves only unique provider match-designation differences', () => {
    const reversed = reconcileLocalScopedAflcaVotes({
      expectedParticipants: aflTablesParticipants(),
      votes: [
        vote(1, 'Sam Walsh (CARL)', 10, { homeClubName: 'Carlton', awayClubName: 'Richmond' }),
        vote(2, 'Patrick Cripps (CARL)', 8, { homeClubName: 'Carlton', awayClubName: 'Richmond' }),
        vote(3, 'Tom J Lynch (RICH)', 7, { homeClubName: 'Carlton', awayClubName: 'Richmond' }),
        vote(4, 'Josh Kennedy (RICH)', 5, { homeClubName: 'Carlton', awayClubName: 'Richmond' }),
      ],
    });
    const shiftedRound = reconcileLocalScopedAflcaVotes({
      expectedParticipants: aflTablesParticipants(),
      votes: [
        vote(1, 'Sam Walsh (CARL)', 10, { roundNumber: 4 }),
        vote(2, 'Patrick Cripps (CARL)', 8, { roundNumber: 4 }),
        vote(3, 'Tom J Lynch (RICH)', 7, { roundNumber: 4 }),
        vote(4, 'Josh Kennedy (RICH)', 5, { roundNumber: 4 }),
      ],
    });

    expect(reversed.reconciled[0]?.canonicalMatchId).toBe('match-2025-1-richmond-carlton');
    expect(shiftedRound.reconciled[0]?.canonicalMatchId).toBe('match-2025-1-richmond-carlton');
  });

  it('uses one exact reviewed identity mapping when the current match source omits a player', () => {
    const current = aflTablesParticipants().filter(
      ({ recordedPlayerName }) => recordedPlayerName !== 'Sam Walsh'
    );
    const historical = aflTablesParticipants().map((participant, index) => ({
      ...participant,
      seasonYear: 2024,
      canonicalPlayerClubId: `local_player_club:afl_tables:${12345 + index}:historical-club`,
      canonicalMatchId: 'match-2024-1-richmond-carlton',
    }));
    const reviewedIdentityMappings = [
      {
        seasonYear: 2025,
        recordedPlayerName: 'Sam Walsh (CARL)',
        canonicalClubName: 'Carlton',
        canonicalPlayerClubId: 'local_player_club:reconciled-aflca:12345:carlton',
        evidenceId: `artifact:${'a'.repeat(64)}`,
        reviewDecisionId: `local-scoped-aflca-identity-mapping:${'b'.repeat(64)}`,
      },
    ];
    const result = reconcileLocalScopedAflcaVotes({
      expectedParticipants: [...current, ...historical],
      reviewedIdentityMappings,
      votes: [
        vote(1, 'Sam Walsh (CARL)', 10),
        vote(2, 'Patrick Cripps (CARL)', 8),
        vote(3, 'Tom J Lynch (RICH)', 7),
        vote(4, 'Josh Kennedy (RICH)', 5),
        vote(5, 'Sam Walsh (CARL)', 10, { seasonYear: 2024 }),
        vote(6, 'Patrick Cripps (CARL)', 8, { seasonYear: 2024 }),
        vote(7, 'Tom J Lynch (RICH)', 7, { seasonYear: 2024 }),
        vote(8, 'Josh Kennedy (RICH)', 5, { seasonYear: 2024 }),
      ],
    });

    expect(result.reconciled[0]?.canonicalPlayerClubId).toBe(
      'local_player_club:reconciled-aflca:12345:carlton'
    );
    expect(() =>
      reconcileLocalScopedAflcaVotes({
        expectedParticipants: [...current, ...historical],
        votes: [
          vote(1, 'Sam Walsh (CARL)', 10),
          vote(2, 'Patrick Cripps (CARL)', 8),
          vote(3, 'Tom J Lynch (RICH)', 7),
          vote(4, 'Josh Kennedy (RICH)', 5),
          vote(5, 'Sam Walsh (CARL)', 10, { seasonYear: 2024 }),
          vote(6, 'Patrick Cripps (CARL)', 8, { seasonYear: 2024 }),
          vote(7, 'Tom J Lynch (RICH)', 7, { seasonYear: 2024 }),
          vote(8, 'Josh Kennedy (RICH)', 5, { seasonYear: 2024 }),
        ],
      })
    ).toThrow(/exactly one AFL Tables player/);
  });

  it('fails closed on missing matches, ambiguous identities, invalid scope, and vote totals', () => {
    const baseVotes = [
      vote(1, 'Sam Walsh (CARL)', 10),
      vote(2, 'Patrick Cripps (CARL)', 8),
      vote(3, 'Tom J Lynch (RICH)', 7),
      vote(4, 'Josh Kennedy (RICH)', 5),
    ];

    expect(() =>
      reconcileLocalScopedAflcaVotes({
        expectedParticipants: aflTablesParticipants(),
        votes: baseVotes.slice(0, 3),
      })
    ).toThrow(/exactly 30/);
    expect(() =>
      reconcileLocalScopedAflcaVotes({
        expectedParticipants: aflTablesParticipants(),
        votes: baseVotes.map((row, index) =>
          index === 0 ? { ...row, awardScope: 'finals' } : row
        ),
      })
    ).toThrow(/home_and_away/);
    expect(() =>
      reconcileLocalScopedAflcaVotes({
        expectedParticipants: [
          ...aflTablesParticipants(),
          {
            ...aflTablesParticipants()[2]!,
            recordedPlayerName: 'Tim Lynch',
            canonicalPlayerClubId: 'player-richmond-tim',
          },
        ],
        votes: baseVotes.map((row, index) =>
          index === 2 ? { ...row, recordedPlayerName: 'T Lynch (RICH)' } : row
        ),
      })
    ).toThrow(/exactly one AFL Tables player/);
    expect(() =>
      reconcileLocalScopedAflcaVotes({
        expectedParticipants: [
          ...aflTablesParticipants(),
          ...aflTablesParticipants().map((participant) => ({
            ...participant,
            roundNumber: 3,
            canonicalMatchId: 'match-2025-3-richmond-carlton',
          })),
        ],
        votes: baseVotes.map((row) => ({ ...row, roundNumber: 2 })),
      })
    ).toThrow(/reviewed AFL Tables match/);
  });
});
