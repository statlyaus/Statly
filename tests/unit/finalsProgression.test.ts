import { describe, expect, it } from 'vitest';

import {
  advanceFinalsBracket,
  seedFinalsBracket,
  type FinalizedFinalsMatchup,
  type FinalsBracketKey,
  type FinalsParticipantAssignment,
  type FinalsTeamCount,
} from '@/server/leagues/finalsProgression';

const teams = (count: FinalsTeamCount) =>
  Array.from({ length: count }, (_, index) => `team-${index + 1}`);

const result = (
  assignment: FinalsParticipantAssignment,
  homeCategoryWins = 5,
  awayCategoryWins = 4
): FinalizedFinalsMatchup => ({
  ...assignment,
  homeCategoryWins,
  awayCategoryWins,
});

const byKey = (
  assignments: readonly FinalsParticipantAssignment[],
  bracketKey: FinalsBracketKey
) => {
  const assignment = assignments.find((candidate) => candidate.bracketKey === bracketKey);
  if (!assignment) throw new Error(`Missing assignment for ${bracketKey}`);
  return assignment;
};

describe('seedFinalsBracket', () => {
  it.each([
    {
      finalsTeams: 4 as const,
      expected: [
        { bracketKey: 'SF_1_V_4', homeMemberId: 'team-1', awayMemberId: 'team-4' },
        { bracketKey: 'SF_2_V_3', homeMemberId: 'team-2', awayMemberId: 'team-3' },
      ],
    },
    {
      finalsTeams: 6 as const,
      expected: [
        { bracketKey: 'EF_3_V_6', homeMemberId: 'team-3', awayMemberId: 'team-6' },
        { bracketKey: 'EF_4_V_5', homeMemberId: 'team-4', awayMemberId: 'team-5' },
      ],
    },
    {
      finalsTeams: 8 as const,
      expected: [
        { bracketKey: 'QF_1_V_4', homeMemberId: 'team-1', awayMemberId: 'team-4' },
        { bracketKey: 'QF_2_V_3', homeMemberId: 'team-2', awayMemberId: 'team-3' },
        { bracketKey: 'EF_5_V_8', homeMemberId: 'team-5', awayMemberId: 'team-8' },
        { bracketKey: 'EF_6_V_7', homeMemberId: 'team-6', awayMemberId: 'team-7' },
      ],
    },
  ])('seeds the $finalsTeams-team opening round', ({ finalsTeams, expected }) => {
    expect(
      seedFinalsBracket({
        finalsTeams,
        orderedRegularSeasonMemberIds: teams(finalsTeams),
      })
    ).toEqual(expected);
  });

  it('does not mutate the ordered regular-season seeds', () => {
    const orderedSeeds = Object.freeze(teams(8));

    seedFinalsBracket({
      finalsTeams: 8,
      orderedRegularSeasonMemberIds: orderedSeeds,
    });

    expect(orderedSeeds).toEqual(teams(8));
  });
});

describe('advanceFinalsBracket for four teams', () => {
  it('assigns semifinal winners to the grand final and removes completed fixtures', () => {
    const orderedSeeds = teams(4);
    const semifinals = seedFinalsBracket({
      finalsTeams: 4,
      orderedRegularSeasonMemberIds: orderedSeeds,
    });
    const pending = advanceFinalsBracket({
      finalsTeams: 4,
      orderedRegularSeasonMemberIds: orderedSeeds,
      finalizedOutcomes: [
        result(byKey(semifinals, 'SF_1_V_4'), 3, 6),
        result(byKey(semifinals, 'SF_2_V_3')),
      ],
    });

    expect(pending).toEqual([{ bracketKey: 'GF', homeMemberId: 'team-4', awayMemberId: 'team-2' }]);
    expect(
      advanceFinalsBracket({
        finalsTeams: 4,
        orderedRegularSeasonMemberIds: orderedSeeds,
        finalizedOutcomes: [
          result(byKey(semifinals, 'SF_1_V_4'), 3, 6),
          result(byKey(semifinals, 'SF_2_V_3')),
          result(pending[0]!, 4, 5),
        ],
      })
    ).toEqual([]);
  });

  it('keeps the unfinished semifinal pending when the other semifinal is finalized', () => {
    const orderedSeeds = teams(4);
    const semifinals = seedFinalsBracket({
      finalsTeams: 4,
      orderedRegularSeasonMemberIds: orderedSeeds,
    });

    expect(
      advanceFinalsBracket({
        finalsTeams: 4,
        orderedRegularSeasonMemberIds: orderedSeeds,
        finalizedOutcomes: [result(byKey(semifinals, 'SF_1_V_4'))],
      })
    ).toEqual([byKey(semifinals, 'SF_2_V_3')]);
  });
});

describe('advanceFinalsBracket for six teams', () => {
  it('applies the top-two byes and advances every finals round', () => {
    const orderedSeeds = teams(6);
    const eliminationFinals = seedFinalsBracket({
      finalsTeams: 6,
      orderedRegularSeasonMemberIds: orderedSeeds,
    });
    const eliminationOutcomes = [
      result(byKey(eliminationFinals, 'EF_3_V_6'), 2, 6),
      result(byKey(eliminationFinals, 'EF_4_V_5')),
    ];
    const semifinals = advanceFinalsBracket({
      finalsTeams: 6,
      orderedRegularSeasonMemberIds: orderedSeeds,
      finalizedOutcomes: eliminationOutcomes,
    });

    expect(semifinals).toEqual([
      {
        bracketKey: 'SF_1_V_EF_4_V_5',
        homeMemberId: 'team-1',
        awayMemberId: 'team-4',
      },
      {
        bracketKey: 'SF_2_V_EF_3_V_6',
        homeMemberId: 'team-2',
        awayMemberId: 'team-6',
      },
    ]);

    const semifinalOutcomes = [
      result(byKey(semifinals, 'SF_1_V_EF_4_V_5'), 2, 3),
      result(byKey(semifinals, 'SF_2_V_EF_3_V_6')),
    ];
    const grandFinal = advanceFinalsBracket({
      finalsTeams: 6,
      orderedRegularSeasonMemberIds: orderedSeeds,
      finalizedOutcomes: [...eliminationOutcomes, ...semifinalOutcomes],
    });

    expect(grandFinal).toEqual([
      { bracketKey: 'GF', homeMemberId: 'team-4', awayMemberId: 'team-2' },
    ]);
    expect(
      advanceFinalsBracket({
        finalsTeams: 6,
        orderedRegularSeasonMemberIds: orderedSeeds,
        finalizedOutcomes: [...eliminationOutcomes, ...semifinalOutcomes, result(grandFinal[0]!)],
      })
    ).toEqual([]);
  });

  it('exposes a resolvable semifinal while the other elimination final remains pending', () => {
    const orderedSeeds = teams(6);
    const eliminationFinals = seedFinalsBracket({
      finalsTeams: 6,
      orderedRegularSeasonMemberIds: orderedSeeds,
    });

    expect(
      advanceFinalsBracket({
        finalsTeams: 6,
        orderedRegularSeasonMemberIds: orderedSeeds,
        finalizedOutcomes: [result(byKey(eliminationFinals, 'EF_3_V_6'), 4, 5)],
      })
    ).toEqual([
      byKey(eliminationFinals, 'EF_4_V_5'),
      {
        bracketKey: 'SF_2_V_EF_3_V_6',
        homeMemberId: 'team-2',
        awayMemberId: 'team-6',
      },
    ]);
  });
});

describe('advanceFinalsBracket for eight teams', () => {
  it('advances qualifying winners and crosses qualifying losers with elimination winners', () => {
    const orderedSeeds = teams(8);
    const openingRound = seedFinalsBracket({
      finalsTeams: 8,
      orderedRegularSeasonMemberIds: orderedSeeds,
    });
    const openingOutcomes = [
      result(byKey(openingRound, 'QF_1_V_4')),
      result(byKey(openingRound, 'QF_2_V_3'), 2, 5),
      result(byKey(openingRound, 'EF_5_V_8'), 3, 4),
      result(byKey(openingRound, 'EF_6_V_7')),
    ];
    const semifinals = advanceFinalsBracket({
      finalsTeams: 8,
      orderedRegularSeasonMemberIds: orderedSeeds,
      finalizedOutcomes: openingOutcomes,
    });

    expect(semifinals).toEqual([
      {
        bracketKey: 'SF_LOSER_QF_1_V_4_V_WINNER_EF_6_V_7',
        homeMemberId: 'team-4',
        awayMemberId: 'team-6',
      },
      {
        bracketKey: 'SF_LOSER_QF_2_V_3_V_WINNER_EF_5_V_8',
        homeMemberId: 'team-2',
        awayMemberId: 'team-8',
      },
    ]);

    const semifinalOutcomes = [
      result(byKey(semifinals, 'SF_LOSER_QF_1_V_4_V_WINNER_EF_6_V_7'), 1, 2),
      result(byKey(semifinals, 'SF_LOSER_QF_2_V_3_V_WINNER_EF_5_V_8')),
    ];
    const preliminaryFinals = advanceFinalsBracket({
      finalsTeams: 8,
      orderedRegularSeasonMemberIds: orderedSeeds,
      finalizedOutcomes: [...openingOutcomes, ...semifinalOutcomes],
    });

    expect(preliminaryFinals).toEqual([
      {
        bracketKey: 'PF_WINNER_QF_1_V_4_V_WINNER_SF_2',
        homeMemberId: 'team-1',
        awayMemberId: 'team-2',
      },
      {
        bracketKey: 'PF_WINNER_QF_2_V_3_V_WINNER_SF_1',
        homeMemberId: 'team-3',
        awayMemberId: 'team-6',
      },
    ]);

    const preliminaryOutcomes = [
      result(byKey(preliminaryFinals, 'PF_WINNER_QF_1_V_4_V_WINNER_SF_2'), 2, 3),
      result(byKey(preliminaryFinals, 'PF_WINNER_QF_2_V_3_V_WINNER_SF_1')),
    ];
    const grandFinal = advanceFinalsBracket({
      finalsTeams: 8,
      orderedRegularSeasonMemberIds: orderedSeeds,
      finalizedOutcomes: [...openingOutcomes, ...semifinalOutcomes, ...preliminaryOutcomes],
    });

    expect(grandFinal).toEqual([
      { bracketKey: 'GF', homeMemberId: 'team-2', awayMemberId: 'team-3' },
    ]);
    expect(
      advanceFinalsBracket({
        finalsTeams: 8,
        orderedRegularSeasonMemberIds: orderedSeeds,
        finalizedOutcomes: [
          ...openingOutcomes,
          ...semifinalOutcomes,
          ...preliminaryOutcomes,
          result(grandFinal[0]!, 3, 4),
        ],
      })
    ).toEqual([]);
  });

  it('does not expose a semifinal until both of its source matchups are finalized', () => {
    const orderedSeeds = teams(8);
    const openingRound = seedFinalsBracket({
      finalsTeams: 8,
      orderedRegularSeasonMemberIds: orderedSeeds,
    });

    expect(
      advanceFinalsBracket({
        finalsTeams: 8,
        orderedRegularSeasonMemberIds: orderedSeeds,
        finalizedOutcomes: [
          result(byKey(openingRound, 'QF_1_V_4')),
          result(byKey(openingRound, 'EF_5_V_8')),
        ],
      })
    ).toEqual([byKey(openingRound, 'QF_2_V_3'), byKey(openingRound, 'EF_6_V_7')]);
  });
});

describe('draw progression', () => {
  it.each([
    { finalsTeams: 4 as const, expectedGrandFinal: ['team-1', 'team-2'] },
    { finalsTeams: 6 as const, expectedGrandFinal: ['team-1', 'team-2'] },
    { finalsTeams: 8 as const, expectedGrandFinal: ['team-1', 'team-2'] },
  ])(
    'advances the higher regular-season seed through every drawn $finalsTeams-team matchup',
    ({ finalsTeams, expectedGrandFinal }) => {
      const orderedSeeds = teams(finalsTeams);
      const outcomes: FinalizedFinalsMatchup[] = [];
      let pending = seedFinalsBracket({
        finalsTeams,
        orderedRegularSeasonMemberIds: orderedSeeds,
      });

      while (pending.some((assignment) => assignment.bracketKey !== 'GF')) {
        outcomes.push(
          ...pending
            .filter((assignment) => assignment.bracketKey !== 'GF')
            .map((assignment) => result(assignment, 4, 4))
        );
        pending = advanceFinalsBracket({
          finalsTeams,
          orderedRegularSeasonMemberIds: orderedSeeds,
          finalizedOutcomes: outcomes,
        });
      }

      expect(pending).toEqual([
        {
          bracketKey: 'GF',
          homeMemberId: expectedGrandFinal[0],
          awayMemberId: expectedGrandFinal[1],
        },
      ]);
      expect(
        advanceFinalsBracket({
          finalsTeams,
          orderedRegularSeasonMemberIds: orderedSeeds,
          finalizedOutcomes: [...outcomes, result(pending[0]!, 4, 4)],
        })
      ).toEqual([]);
    }
  );
});

describe('current-contract validation', () => {
  it('returns the same assignments regardless of finalized outcome order', () => {
    const orderedSeeds = teams(4);
    const semifinals = seedFinalsBracket({
      finalsTeams: 4,
      orderedRegularSeasonMemberIds: orderedSeeds,
    });
    const outcomes = [
      result(byKey(semifinals, 'SF_1_V_4'), 3, 6),
      result(byKey(semifinals, 'SF_2_V_3')),
    ];
    const input = {
      finalsTeams: 4 as const,
      orderedRegularSeasonMemberIds: orderedSeeds,
    };

    expect(
      advanceFinalsBracket({
        ...input,
        finalizedOutcomes: outcomes,
      })
    ).toEqual(
      advanceFinalsBracket({
        ...input,
        finalizedOutcomes: [...outcomes].reverse(),
      })
    );
  });

  it('requires exactly the configured number of ordered seeds', () => {
    expect(() =>
      seedFinalsBracket({
        finalsTeams: 6,
        orderedRegularSeasonMemberIds: teams(4),
      })
    ).toThrow('Expected exactly 6 ordered regular-season seeds');
  });

  it('rejects blank and duplicate seeded members', () => {
    expect(() =>
      seedFinalsBracket({
        finalsTeams: 4,
        orderedRegularSeasonMemberIds: ['team-1', '', 'team-3', 'team-4'],
      })
    ).toThrow('Regular-season seed 2 must have a member ID');
    expect(() =>
      seedFinalsBracket({
        finalsTeams: 4,
        orderedRegularSeasonMemberIds: ['team-1', 'team-2', 'team-1', 'team-4'],
      })
    ).toThrow('Duplicate regular-season seed member: team-1');
  });

  it('rejects unsupported team counts at runtime', () => {
    expect(() =>
      seedFinalsBracket({
        finalsTeams: 5 as FinalsTeamCount,
        orderedRegularSeasonMemberIds: teams(4),
      })
    ).toThrow('Unsupported finals team count: 5');
  });

  it('rejects a bracket key from a different finals format', () => {
    const semifinals = seedFinalsBracket({
      finalsTeams: 4,
      orderedRegularSeasonMemberIds: teams(4),
    });

    expect(() =>
      advanceFinalsBracket({
        finalsTeams: 4,
        orderedRegularSeasonMemberIds: teams(4),
        finalizedOutcomes: [{ ...result(semifinals[0]!), bracketKey: 'EF_3_V_6' }],
      })
    ).toThrow('EF_3_V_6 is not part of the 4-team finals bracket');
  });

  it('rejects duplicate outcomes for one bracket key', () => {
    const semifinals = seedFinalsBracket({
      finalsTeams: 4,
      orderedRegularSeasonMemberIds: teams(4),
    });
    const outcome = result(semifinals[0]!);

    expect(() =>
      advanceFinalsBracket({
        finalsTeams: 4,
        orderedRegularSeasonMemberIds: teams(4),
        finalizedOutcomes: [outcome, outcome],
      })
    ).toThrow('Duplicate finalized outcome for SF_1_V_4');
  });

  it('rejects outcomes whose participants do not match their bracket assignment', () => {
    const semifinals = seedFinalsBracket({
      finalsTeams: 4,
      orderedRegularSeasonMemberIds: teams(4),
    });

    expect(() =>
      advanceFinalsBracket({
        finalsTeams: 4,
        orderedRegularSeasonMemberIds: teams(4),
        finalizedOutcomes: [
          {
            ...result(semifinals[0]!),
            homeMemberId: semifinals[0]!.awayMemberId,
            awayMemberId: semifinals[0]!.homeMemberId,
          },
        ],
      })
    ).toThrow('SF_1_V_4 participants do not match the bracket assignment');
  });

  it.each([
    { homeCategoryWins: -1, awayCategoryWins: 2, label: 'homeCategoryWins' },
    { homeCategoryWins: 2, awayCategoryWins: 1.5, label: 'awayCategoryWins' },
    { homeCategoryWins: Number.NaN, awayCategoryWins: 2, label: 'homeCategoryWins' },
  ])('rejects invalid $label values', ({ homeCategoryWins, awayCategoryWins, label }) => {
    const semifinals = seedFinalsBracket({
      finalsTeams: 4,
      orderedRegularSeasonMemberIds: teams(4),
    });

    expect(() =>
      advanceFinalsBracket({
        finalsTeams: 4,
        orderedRegularSeasonMemberIds: teams(4),
        finalizedOutcomes: [result(semifinals[0]!, homeCategoryWins, awayCategoryWins)],
      })
    ).toThrow(`SF_1_V_4 ${label} must be a non-negative integer`);
  });

  it('rejects a downstream result before its prerequisite matchups are finalized', () => {
    expect(() =>
      advanceFinalsBracket({
        finalsTeams: 4,
        orderedRegularSeasonMemberIds: teams(4),
        finalizedOutcomes: [
          {
            bracketKey: 'GF',
            homeMemberId: 'team-1',
            awayMemberId: 'team-2',
            homeCategoryWins: 5,
            awayCategoryWins: 4,
          },
        ],
      })
    ).toThrow('GF cannot be finalized before its prerequisite matchups');
  });
});
