/** Pure: safe on server and client. */

/** Players each other team should have marked as taken before the free-agent list can be trusted. */
export const TAKEN_PER_OTHER_TEAM = 8;

export interface TakenPlayersCheck {
  /** Players rostered by anyone but me and this week's opponent: other entered teams or elsewhere. */
  taken: number;
  /** (teams − 2) × 8: about a starting lineup for every team besides mine and the opponent. */
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
  const expected = Math.max(0, league.teamCount - 2) * TAKEN_PER_OTHER_TEAM;
  return { taken, expected, enough: taken >= expected };
}
