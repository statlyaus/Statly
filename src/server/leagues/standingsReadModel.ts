export interface CurrentLeagueMember {
  id: string;
  teamName: string;
  teamLogoUrl: string | null;
  draftSlot?: number | null;
}

export interface PersistedLeagueStanding {
  id: string;
  memberId: string;
  wins: number;
  losses: number;
  draws: number;
  categoryWins: number;
  categoryLosses: number;
  categoryDraws: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface LeagueStandingReadRow extends PersistedLeagueStanding {
  teamName: string;
  teamLogoUrl: string | null;
  /** Null when the team has no value, such as no season DE% because it had no disposals. */
  tieBreakCategoryTotal: number | null;
  draftSlot: number | null;
}

export function buildLeagueStandings({
  members,
  standings,
  tieBreakCategoryTotalByMemberId = new Map<string, number | null>(),
  tieBreakDirection = 'HIGH_WINS',
}: {
  members: readonly CurrentLeagueMember[];
  standings: readonly PersistedLeagueStanding[];
  tieBreakCategoryTotalByMemberId?: ReadonlyMap<string, number | null>;
  tieBreakDirection?: 'HIGH_WINS' | 'LOW_WINS';
}): LeagueStandingReadRow[] {
  const membersById = new Map(members.map((member) => [member.id, member]));
  // A member with no score rows yet has a total of 0; a stored null (no value) stays null.
  const tieBreakValue = (memberId: string) => {
    const value = tieBreakCategoryTotalByMemberId.get(memberId);
    return value === undefined ? 0 : value;
  };
  const standingMemberIds = new Set(standings.map((standing) => standing.memberId));

  const resolvedStandings = standings.flatMap((standing) => {
    const member = membersById.get(standing.memberId);
    if (!member) return [];

    return [
      {
        ...standing,
        teamName: member.teamName,
        teamLogoUrl: member.teamLogoUrl,
        tieBreakCategoryTotal: tieBreakValue(member.id),
        draftSlot: member.draftSlot ?? null,
      },
    ];
  });

  const missingMemberRows = members
    .filter((member) => !standingMemberIds.has(member.id))
    .map((member) => ({
      id: `pending-${member.id}`,
      memberId: member.id,
      teamName: member.teamName,
      teamLogoUrl: member.teamLogoUrl,
      wins: 0,
      losses: 0,
      draws: 0,
      categoryWins: 0,
      categoryLosses: 0,
      categoryDraws: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      tieBreakCategoryTotal: tieBreakValue(member.id),
      draftSlot: member.draftSlot ?? null,
    }));

  // A team with no tie-break value ranks below every team with one, whatever the direction.
  const compareTieBreakTotal = (left: LeagueStandingReadRow, right: LeagueStandingReadRow) => {
    const leftTotal = left.tieBreakCategoryTotal;
    const rightTotal = right.tieBreakCategoryTotal;
    if (leftTotal === null || rightTotal === null) {
      return (leftTotal === null ? 1 : 0) - (rightTotal === null ? 1 : 0);
    }
    return tieBreakDirection === 'LOW_WINS' ? leftTotal - rightTotal : rightTotal - leftTotal;
  };

  return [...resolvedStandings, ...missingMemberRows].sort(
    (left, right) =>
      right.wins - left.wins ||
      left.losses - right.losses ||
      right.draws - left.draws ||
      compareTieBreakTotal(left, right) ||
      (left.draftSlot ?? Number.MAX_SAFE_INTEGER) - (right.draftSlot ?? Number.MAX_SAFE_INTEGER) ||
      left.teamName.localeCompare(right.teamName)
  );
}
