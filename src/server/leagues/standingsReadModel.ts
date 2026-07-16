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
  tieBreakCategoryWins: number;
  draftSlot: number | null;
}

export function buildLeagueStandings({
  members,
  standings,
  tieBreakCategoryWinsByMemberId = new Map<string, number>(),
}: {
  members: readonly CurrentLeagueMember[];
  standings: readonly PersistedLeagueStanding[];
  tieBreakCategoryWinsByMemberId?: ReadonlyMap<string, number>;
}): LeagueStandingReadRow[] {
  const membersById = new Map(members.map((member) => [member.id, member]));
  const standingMemberIds = new Set(standings.map((standing) => standing.memberId));

  const resolvedStandings = standings.flatMap((standing) => {
    const member = membersById.get(standing.memberId);
    if (!member) return [];

    return [
      {
        ...standing,
        teamName: member.teamName,
        teamLogoUrl: member.teamLogoUrl,
        tieBreakCategoryWins: tieBreakCategoryWinsByMemberId.get(member.id) ?? 0,
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
      tieBreakCategoryWins: tieBreakCategoryWinsByMemberId.get(member.id) ?? 0,
      draftSlot: member.draftSlot ?? null,
    }));

  return [...resolvedStandings, ...missingMemberRows].sort(
    (left, right) =>
      right.wins - left.wins ||
      left.losses - right.losses ||
      right.draws - left.draws ||
      right.tieBreakCategoryWins - left.tieBreakCategoryWins ||
      (left.draftSlot ?? Number.MAX_SAFE_INTEGER) - (right.draftSlot ?? Number.MAX_SAFE_INTEGER) ||
      left.teamName.localeCompare(right.teamName)
  );
}
