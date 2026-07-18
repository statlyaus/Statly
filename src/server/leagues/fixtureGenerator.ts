export interface LeagueFixture {
  round: number;
  homeMemberId: string | null;
  awayMemberId: string | null;
  byeMemberId: string | null;
}

export interface GeneratedCompetitionFixture extends LeagueFixture {
  fixtureVersion: number;
  aflRound: number;
  phase: 'REGULAR' | 'FINALS';
  bracketKey: string | null;
}

export interface GeneratedCompetitionRound {
  round: number;
  aflRound: number;
  phase: 'REGULAR' | 'FINALS';
  status: 'SCHEDULED' | 'NO_MATCHUP';
  startsAt?: Date | null;
  endsAt?: Date | null;
  fixtures: GeneratedCompetitionFixture[];
}

export interface GenerateCompetitionScheduleInput {
  memberIds: readonly string[];
  fixtureVersion: number;
  seasonStartAflRound: number;
  regularSeasonRounds: number;
  excludedAflRounds: readonly number[];
  finalsTeams: 0 | 4 | 6 | 8;
}

export function generateRoundRobinFixtures(memberIds: readonly string[]): LeagueFixture[] {
  const uniqueMemberIds = [...new Set(memberIds)].filter(Boolean);
  if (uniqueMemberIds.length < 2) return [];

  const hasBye = uniqueMemberIds.length % 2 === 1;
  const teams: Array<string | null> = hasBye ? [...uniqueMemberIds, null] : [...uniqueMemberIds];
  const rounds = teams.length - 1;
  const fixtures: LeagueFixture[] = [];

  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const round = roundIndex + 1;
    const half = teams.length / 2;

    for (let pairIndex = 0; pairIndex < half; pairIndex += 1) {
      const first = teams[pairIndex];
      const second = teams[teams.length - 1 - pairIndex];

      if (!first || !second) {
        fixtures.push({
          round,
          homeMemberId: null,
          awayMemberId: null,
          byeMemberId: first ?? second,
        });
        continue;
      }

      const swapHome = roundIndex % 2 === 1;
      fixtures.push({
        round,
        homeMemberId: swapHome ? second : first,
        awayMemberId: swapHome ? first : second,
        byeMemberId: null,
      });
    }

    const [anchor, ...rotating] = teams;
    teams.splice(0, teams.length, anchor, rotating[rotating.length - 1], ...rotating.slice(0, -1));
  }

  return fixtures;
}

export function finalsBracketKeys(finalsTeams: GenerateCompetitionScheduleInput['finalsTeams']) {
  switch (finalsTeams) {
    case 4:
      return [['SF_1_V_4', 'SF_2_V_3'], ['GF']];
    case 6:
      return [['EF_3_V_6', 'EF_4_V_5'], ['SF_1_V_EF_4_V_5', 'SF_2_V_EF_3_V_6'], ['GF']];
    case 8:
      return [
        ['QF_1_V_4', 'QF_2_V_3', 'EF_5_V_8', 'EF_6_V_7'],
        ['SF_LOSER_QF_1_V_4_V_WINNER_EF_6_V_7', 'SF_LOSER_QF_2_V_3_V_WINNER_EF_5_V_8'],
        ['PF_WINNER_QF_1_V_4_V_WINNER_SF_2', 'PF_WINNER_QF_2_V_3_V_WINNER_SF_1'],
        ['GF'],
      ];
    default:
      return [];
  }
}

export function generateManualCompetitionSchedule({
  fixtureVersion,
  seasonStartAflRound,
  regularSeasonRounds,
  excludedAflRounds,
  finalsTeams,
}: Omit<GenerateCompetitionScheduleInput, 'memberIds'>): GeneratedCompetitionRound[] {
  const excludedRounds = new Set(excludedAflRounds);
  const generatedRounds: GeneratedCompetitionRound[] = [];
  let fantasyRound = 0;
  let playableRoundCount = 0;
  let aflRound = seasonStartAflRound;

  while (playableRoundCount < regularSeasonRounds) {
    fantasyRound += 1;
    const isExcluded = excludedRounds.has(aflRound);
    generatedRounds.push({
      round: fantasyRound,
      aflRound,
      phase: 'REGULAR',
      status: isExcluded ? 'NO_MATCHUP' : 'SCHEDULED',
      fixtures: [],
    });
    if (!isExcluded) playableRoundCount += 1;
    aflRound += 1;
  }

  for (const bracketRound of finalsBracketKeys(finalsTeams)) {
    while (excludedRounds.has(aflRound)) {
      fantasyRound += 1;
      generatedRounds.push({
        round: fantasyRound,
        aflRound,
        phase: 'FINALS',
        status: 'NO_MATCHUP',
        fixtures: [],
      });
      aflRound += 1;
    }

    fantasyRound += 1;
    generatedRounds.push({
      round: fantasyRound,
      aflRound,
      phase: 'FINALS',
      status: 'SCHEDULED',
      fixtures: bracketRound.map((bracketKey) => ({
        round: fantasyRound,
        homeMemberId: null,
        awayMemberId: null,
        byeMemberId: null,
        fixtureVersion,
        aflRound,
        phase: 'FINALS',
        bracketKey,
      })),
    });
    aflRound += 1;
  }

  return generatedRounds;
}

export function generateCompetitionSchedule({
  memberIds,
  fixtureVersion,
  seasonStartAflRound,
  regularSeasonRounds,
  excludedAflRounds,
  finalsTeams,
}: GenerateCompetitionScheduleInput): GeneratedCompetitionRound[] {
  const cycleFixtures = generateRoundRobinFixtures(memberIds);
  if (cycleFixtures.length === 0 || regularSeasonRounds < 1) return [];

  const fixturesByCycleRound = new Map<number, LeagueFixture[]>();
  for (const fixture of cycleFixtures) {
    const fixtures = fixturesByCycleRound.get(fixture.round) ?? [];
    fixtures.push(fixture);
    fixturesByCycleRound.set(fixture.round, fixtures);
  }

  const cycleRoundCount = fixturesByCycleRound.size;
  const excludedRounds = new Set(excludedAflRounds);
  const generatedRounds: GeneratedCompetitionRound[] = [];
  let fantasyRound = 0;
  let playableRoundCount = 0;
  let aflRound = seasonStartAflRound;

  while (playableRoundCount < regularSeasonRounds) {
    fantasyRound += 1;

    if (excludedRounds.has(aflRound)) {
      generatedRounds.push({
        round: fantasyRound,
        aflRound,
        phase: 'REGULAR',
        status: 'NO_MATCHUP',
        fixtures: [],
      });
      aflRound += 1;
      continue;
    }

    const cycleRound = (playableRoundCount % cycleRoundCount) + 1;
    const fixtures = (fixturesByCycleRound.get(cycleRound) ?? []).map((fixture) => ({
      ...fixture,
      round: fantasyRound,
      fixtureVersion,
      aflRound,
      phase: 'REGULAR' as const,
      bracketKey: null,
    }));
    generatedRounds.push({
      round: fantasyRound,
      aflRound,
      phase: 'REGULAR',
      status: 'SCHEDULED',
      fixtures,
    });
    playableRoundCount += 1;
    aflRound += 1;
  }

  for (const bracketRound of finalsBracketKeys(finalsTeams)) {
    while (excludedRounds.has(aflRound)) {
      fantasyRound += 1;
      generatedRounds.push({
        round: fantasyRound,
        aflRound,
        phase: 'FINALS',
        status: 'NO_MATCHUP',
        fixtures: [],
      });
      aflRound += 1;
    }

    fantasyRound += 1;
    const fixtures = bracketRound.map((bracketKey) => ({
      round: fantasyRound,
      homeMemberId: null,
      awayMemberId: null,
      byeMemberId: null,
      fixtureVersion,
      aflRound,
      phase: 'FINALS' as const,
      bracketKey,
    }));
    generatedRounds.push({
      round: fantasyRound,
      aflRound,
      phase: 'FINALS',
      status: 'SCHEDULED',
      fixtures,
    });
    aflRound += 1;
  }

  return generatedRounds;
}
