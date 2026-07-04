export interface LeagueFixture {
  round: number;
  homeMemberId: string | null;
  awayMemberId: string | null;
  byeMemberId: string | null;
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
