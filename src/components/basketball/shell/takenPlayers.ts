/** Pure: safe on server and client. */

/** Players each other team should have marked as taken before the free-agent list can be trusted. */
export const TAKEN_PER_OTHER_TEAM = 8;

export interface TakenPlayersCheck {
  /** Players on other teams: on any entered team but mine and this week's opponent, or elsewhere. */
  taken: number;
  /** The floor: 8 for every team but mine and, when one is set, this week's opponent. */
  expected: number;
  enough: boolean;
}

/**
 * Whether the league has enough players marked as taken for Pickups to suggest real free agents.
 * Statly only knows the players the user enters, so with the other teams missing, players rostered
 * in the real league show up as free agents.
 */
export function takenPlayersCheck(
  league: { teamCount: number; myTeamId: string; rosterSpots: { teamId: string | null }[] },
  opponentTeamId: string | null
): TakenPlayersCheck {
  const taken = league.rosterSpots.filter(
    (spot) => spot.teamId !== league.myTeamId && (!opponentTeamId || spot.teamId !== opponentTeamId)
  ).length;
  const otherTeams = league.teamCount - (opponentTeamId ? 2 : 1);
  const expected = Math.max(0, otherTeams) * TAKEN_PER_OTHER_TEAM;
  return { taken, expected, enough: taken >= expected };
}

/** "12 players on other teams (at least 80 needed)" */
export function takenPlayersSummary(check: TakenPlayersCheck): string {
  return `${check.taken} ${check.taken === 1 ? 'player' : 'players'} on other teams (at least ${check.expected} needed)`;
}
