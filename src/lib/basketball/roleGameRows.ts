/**
 * Role outlook inputs: stored box-score lines turned into the rows the sheet's Role Model reads
 * (`RoleModel.gs`, 'Box Scores (Live)'). Pure and isomorphic.
 */

import type { NbaStatLine } from '@/types/basketball';

import type { EasternDate } from './fantasyWeeks';

/** One player's stored line in one final game (played or not), with the game's score. */
export interface RoleBoxRow extends Omit<NbaStatLine, 'threePointersAttempted'> {
  gameId: string;
  gameDate: EasternDate;
  teamCode: string;
  playerId: string;
  played: boolean;
  secondsPlayed: number;
  plusMinus: number;
  teamScore: number;
  opponentScore: number;
}

/** One played game, in the script's field names. */
export interface RoleGameRow {
  date: EasternDate;
  playerId: string;
  team: string;
  min: number;
  /** Box-score USG%, to one decimal as the sheet's feed gives it. */
  usg: number;
  pm: number;
  /** Team score minus opponent score. */
  margin: number;
  pts: number;
  fg3m: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  tov: number;
}

/** ESPN prints whole minutes, so a short appearance is stored as played with 0 seconds. */
export const CAMEO_MINUTES = 0.25;

const minutesOf = (row: RoleBoxRow) =>
  !row.played ? 0 : row.secondsPlayed > 0 ? row.secondsPlayed / 60 : CAMEO_MINUTES;

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Played rows only, ordered by date, game, team and player (the order breaks the model's ties).
 * USG% = 100·(FGA + 0.44·FTA + TOV)·(team minutes / 5) / (MIN·(team FGA + 0.44·team FTA + team
 * TOV)), team totals over all of the team's rows in the game; team minutes are snapped to 240 plus
 * 25 per overtime, because whole minutes do not add up exactly.
 */
export function toRoleGameRows(rows: readonly RoleBoxRow[]): RoleGameRow[] {
  const teams = new Map<string, { minutes: number; possessions: number }>();
  for (const row of rows) {
    const key = `${row.gameId}|${row.teamCode}`;
    const team = teams.get(key) ?? { minutes: 0, possessions: 0 };
    teams.set(key, team);
    team.minutes += minutesOf(row);
    team.possessions += row.fieldGoalsAttempted + 0.44 * row.freeThrowsAttempted + row.turnovers;
  }
  return rows
    .filter((row) => row.played)
    .sort(
      (a, b) =>
        compare(a.gameDate, b.gameDate) ||
        compare(a.gameId, b.gameId) ||
        compare(a.teamCode, b.teamCode) ||
        compare(a.playerId, b.playerId)
    )
    .map((row) => {
      const team = teams.get(`${row.gameId}|${row.teamCode}`)!;
      const min = minutesOf(row);
      const teamMinutes = 240 + 25 * Math.round((team.minutes - 240) / 25);
      const own = row.fieldGoalsAttempted + 0.44 * row.freeThrowsAttempted + row.turnovers;
      const usg = own === 0 ? 0 : (100 * own * (teamMinutes / 5)) / (min * team.possessions);
      return {
        date: row.gameDate,
        playerId: row.playerId,
        team: row.teamCode,
        min,
        usg: Math.round(usg * 10) / 10,
        pm: row.plusMinus,
        margin: row.teamScore - row.opponentScore,
        pts: row.points,
        fg3m: row.threePointersMade,
        reb: row.rebounds,
        ast: row.assists,
        stl: row.steals,
        blk: row.blocks,
        fgm: row.fieldGoalsMade,
        fga: row.fieldGoalsAttempted,
        ftm: row.freeThrowsMade,
        fta: row.freeThrowsAttempted,
        tov: row.turnovers,
      };
    });
}
