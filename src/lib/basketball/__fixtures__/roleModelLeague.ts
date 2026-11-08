/**
 * A synthetic league for the role outlook tests: made-up players, box scores from a seeded
 * generator, no real data. Six teams by default (a new coach, both remapped team codes) with 13
 * players each. Built in: a traded player, cameos (played, 0 seconds), overtime games, DNP rows, a
 * teammate newly out, two coming back, two gone more than 5 team games (one on the injury report),
 * a player with 2 games and two either side of 10 minutes over the last 5. `futureDays` adds the
 * games still to play from `today`, drawn after the box scores so they never change them.
 */

import { addDays } from '../fantasyWeeks';
import type { InjuryOutlook } from '../injuryOutlook';
import {
  PROJECTED_STATS,
  type HistoryGame,
  type Presence,
  type SeasonTotals,
} from '../playerHistory';
import { toRoleGameRows, type RoleBoxRow, type RoleGameRow } from '../roleGameRows';
import type { ScheduleGame } from '../roleSchedule';

/** Base minutes by roster spot; the 13th man only ever gets a cameo. */
const BASE_MINUTES = [34, 33, 32, 30, 28, 24, 20, 17, 14, 10, 7, 4, 0.4];

/** Deterministic pseudo-random numbers in [0, 1) (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticRoleLeague({
  seed = 7,
  teams = ['ATL', 'BOS', 'DAL', 'NOP', 'PHX', 'SAS'],
  days = 36,
  start = '2026-10-21',
  futureDays = 0,
} = {}): {
  rows: RoleBoxRow[];
  injuries: Map<string, InjuryOutlook>;
  games: ScheduleGame[];
  today: string;
} {
  const rand = random(seed);
  const id = (team: string, n: number) => `${team}-${String(n).padStart(2, '0')}`;
  const [A, B, C, D, E, F] = teams;
  const traded = id(B, 6);

  /** Each game day, teams paired at random (Fisher-Yates), one or two resting. */
  function pairings(from: number, to: number) {
    const games: { day: number; pair: string[]; overtime: boolean }[] = [];
    for (let day = from; day < to; day += 1) {
      if (day % 7 === 6) continue;
      const order = [...teams];
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (let g = 0; g + 1 < order.length - 1; g += 2) {
        games.push({ day, pair: [order[g], order[g + 1]], overtime: rand() < 0.1 });
      }
    }
    return games;
  }
  // Schedule first.
  const games = pairings(0, days);
  const teamDays = new Map(
    teams.map((team) => [team, games.filter((g) => g.pair.includes(team)).map((g) => g.day)])
  );
  /** True on the team's last `n` game days. */
  const lastGames = (team: string, day: number, n: number) =>
    teamDays.get(team)!.slice(-n).includes(day);

  /** His base minutes that day, or null when he does not play. */
  function plan(team: string, playerId: string, spot: number, day: number): number | null {
    if (playerId === traded) return team === (day < 18 ? B : D) ? 26 : null;
    if (playerId === id(A, 2) && lastGames(A, day, 2)) return null; // back, not listed
    if (playerId === id(B, 4) && lastGames(B, day, 1)) return null; // back, still listed
    if (playerId === id(F, 1) && lastGames(F, day, 7)) return null; // gone, not listed
    if (playerId === id(C, 2) && lastGames(C, day, 8)) return null; // gone, out for the season
    if (playerId === id(D, 13)) return lastGames(D, day, 2) ? 12 : null;
    if (playerId === id(E, 11)) return day > 20 ? 10 : 18;
    if (playerId === id(E, 12)) return day > 20 ? 9 : 18;
    return rand() < 0.06 ? null : BASE_MINUTES[spot];
  }
  const forced = new Set([id(D, 13), id(E, 11), id(E, 12)]);

  const rows: RoleBoxRow[] = [];
  for (const { day, pair, overtime } of games) {
    const lines = pair.map((team) => {
      const roster = BASE_MINUTES.map((_, spot) => id(team, spot + 1));
      if (team === D) roster.push(traded);
      const planned = roster.map((playerId, spot) => {
        const base = plan(team, playerId, Math.min(spot, 12), day);
        const free = base !== null && !forced.has(playerId);
        return { playerId, base, weight: free ? base * (0.85 + 0.3 * rand()) : 0 };
      });
      // Forced minutes stand; everyone else shares the rest of 240 (265 with overtime) by weight.
      const fixed = planned.reduce((sum, p) => sum + (p.weight ? 0 : (p.base ?? 0)), 0);
      const share =
        ((overtime ? 265 : 240) - fixed) / planned.reduce((sum, p) => sum + p.weight, 0);
      return planned.flatMap(({ playerId, base, weight }): RoleBoxRow[] => {
        if (playerId === traded && base === null) return [];
        const played = base !== null;
        const min = !played ? 0 : weight ? Math.round(weight * share) : base;
        const m = played ? Math.max(min, 1) : 0;
        const fga = Math.round(m * (0.25 + 0.35 * rand()));
        const fgm = Math.round(fga * (0.35 + 0.25 * rand()));
        const fg3m = Math.min(fgm, Math.round(fgm * 0.6 * rand()));
        const fta = Math.round(m * 0.15 * rand());
        const ftm = Math.round(fta * (0.6 + 0.35 * rand()));
        return [
          {
            gameId: `${pair.join('-')}-${day}`,
            gameDate: addDays(start, day),
            teamCode: team,
            playerId,
            played,
            secondsPlayed: min * 60,
            points: 2 * fgm + fg3m + ftm,
            rebounds: Math.round(m * 0.25 * rand()),
            assists: Math.round(m * 0.2 * rand()),
            steals: Math.round(m * 0.05 * rand()),
            blocks: Math.round(m * 0.04 * rand()),
            turnovers: Math.round(m * 0.08 * rand()),
            threePointersMade: fg3m,
            fieldGoalsMade: fgm,
            fieldGoalsAttempted: fga,
            freeThrowsMade: ftm,
            freeThrowsAttempted: fta,
            plusMinus: played ? Math.round((rand() - 0.5) * 24) : 0,
            teamScore: 0,
            opponentScore: 0,
          },
        ];
      });
    });
    const score = lines.map((team) => team.reduce((sum, row) => sum + row.points, 0));
    lines.forEach((team, side) => {
      for (const row of team)
        rows.push({ ...row, teamScore: score[side], opponentScore: score[1 - side] });
    });
  }
  const injuries = new Map<string, InjuryOutlook>([
    [id(A, 3), { fracNext5: 0.6, gamesOut: 3 }], // played the team's last game: newly out
    [id(B, 4), { fracNext5: 0.2, gamesOut: 1 }],
    [id(C, 2), { fracNext5: 1, gamesOut: 999 }],
  ]);
  const schedule = [...games, ...pairings(days, days + futureDays)].map(({ day, pair }) => ({
    date: addDays(start, day),
    home: pair[0],
    away: pair[1],
    final: day < days,
  }));
  return { rows, injuries, games: schedule, today: addDays(start, days) };
}

/**
 * The 3 seasons before `season` from the same generator (other seeds, without the first team, so
 * its players have no history), as the history inputs: season totals and played tuples.
 */
export function syntheticRoleHistory({
  seed = 7,
  teams = ['ATL', 'BOS', 'DAL', 'NOP', 'PHX', 'SAS'],
  days = 36,
  season = 2027,
} = {}): { totals: SeasonTotals[]; games: HistoryGame[]; presence: Presence[] } {
  const totals: SeasonTotals[] = [];
  const games: HistoryGame[] = [];
  const presence: Presence[] = [];
  for (let ago = 1; ago <= 3; ago += 1) {
    const league = syntheticRoleLeague({
      seed: seed + ago,
      teams: teams.slice(1),
      days,
      start: `${season - ago - 1}-10-21`,
    });
    const byPlayer = new Map<string, SeasonTotals>();
    const summed = [...PROJECTED_STATS, 'fgm', 'ftm', 'minutes', 'games'] as const;
    for (const row of toRoleGameRows(league.rows)) {
      let t = byPlayer.get(row.playerId);
      if (!t) {
        const zeros = Object.fromEntries(summed.map((c) => [c, 0]));
        t = { ...zeros, playerId: row.playerId, season: season - ago } as SeasonTotals;
        byPlayer.set(row.playerId, t);
      }
      for (const c of summed) t[c] += c === 'games' ? 1 : c === 'minutes' ? row.min : row[c];
      presence.push({ team: row.team, date: row.date, playerId: row.playerId });
    }
    totals.push(...byPlayer.values());
    games.push(
      ...league.games.map(({ date, home, away }) => ({ season: season - ago, date, home, away }))
    );
  }
  return { totals, games, presence };
}

/** One played game for the unit tests: 20 % usage and no box-score stats unless given. */
export const gameRow = (
  row: Pick<RoleGameRow, 'date' | 'playerId' | 'team' | 'min'> & Partial<RoleGameRow>
): RoleGameRow => ({
  usg: 20,
  pm: 0,
  margin: 0,
  pts: 0,
  fg3m: 0,
  reb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  fgm: 0,
  fga: 0,
  ftm: 0,
  fta: 0,
  tov: 0,
  ...row,
});
