/**
 * A synthetic league for the role outlook tests: made-up players, box scores from a seeded
 * generator, no real data. Six teams by default (a new coach, both remapped team codes) with 13
 * players each. Built in: a traded player, cameos (played, 0 seconds), overtime games, DNP rows, a
 * teammate newly out, two coming back, two gone more than 5 team games (one on the injury report),
 * a player with 2 games and two either side of 10 minutes over the last 5.
 */

import { addDays } from '../fantasyWeeks';
import type { RoleBoxRow } from '../roleGameRows';
import type { RoleInjury } from '../roleModel';

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
} = {}): { rows: RoleBoxRow[]; injuries: Map<string, RoleInjury> } {
  const rand = random(seed);
  const id = (team: string, n: number) => `${team}-${String(n).padStart(2, '0')}`;
  const [A, B, C, D, E, F] = teams;
  const traded = id(B, 6);

  // Schedule first: each game day, teams paired at random (Fisher-Yates), one or two resting.
  const games: { day: number; pair: string[]; overtime: boolean }[] = [];
  for (let day = 0; day < days; day += 1) {
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
            gameDate: addDays('2026-10-21', day),
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
  const injuries = new Map<string, RoleInjury>([
    [id(A, 3), { fracNext5: 0.6 }], // played the team's last game: newly out
    [id(B, 4), { fracNext5: 0.2 }],
    [id(C, 2), { fracNext5: 1 }],
  ]);
  return { rows, injuries };
}
