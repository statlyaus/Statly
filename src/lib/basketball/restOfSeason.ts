/**
 * Role outlook rest of season (the sheet's `rosProj_` and `rosTeammates_`): minutes per game from
 * his season, last season and the teammates expected to miss games, per-minute rates blended with
 * his career, and expected games from his availability and injury. A player's rows from every team
 * count, as in the script. Same summation order as the script. Pure and isomorphic.
 */

import type { InjuryOutlook } from './injuryOutlook';
import type { PlayerHistory } from './playerHistory';
import type { RoleGameRow } from './roleGameRows';
import { round1, type RoleRow } from './roleModel';
import { ROS_ABS, ROS_MODEL } from './roleModelConstants';
import { clamp, upcomingGames, type ScheduleContext } from './roleSchedule';
import {
  earlyWeight,
  groupBy,
  mapStats,
  pointsFrom,
  shootingPercentages,
  total,
  type StatLine,
} from './roleStatProjection';

export interface RestOfSeasonProjection {
  playerId: string;
  teamCode: string;
  /** Per game played, to 0.1. */
  minutes: number;
  expectedGames: number;
  /** Per game played, to 0.1; no opponent adjustment. */
  stats: StatLine;
  fgPct: number;
  ftPct: number;
  teamGamesLeft: number;
  /** Minutes per game added (+) or removed (−) by teammates expected to miss games. */
  teammateShift: number;
  /** Before rounding. */
  raw: { minutes: number; expectedGames: number; stats: StatLine; teammateShift: number };
}

interface TeamSeason {
  dates: string[];
  /** Per player, in order of first appearance: minutes by date. */
  players: Map<string, Map<string, number>>;
}

function teamSeasons(rows: readonly RoleGameRow[]): Map<string, TeamSeason> {
  const teams = new Map<string, TeamSeason>();
  for (const row of rows) {
    const team: TeamSeason = teams.get(row.team) ?? { dates: [], players: new Map() };
    teams.set(row.team, team);
    team.dates.push(row.date);
    const player = team.players.get(row.playerId) ?? new Map<string, number>();
    team.players.set(row.playerId, player.set(row.date, row.min));
  }
  for (const team of teams.values()) team.dates = [...new Set(team.dates)].sort();
  return teams;
}

/**
 * Σ over teammates of D·P(absent rest of season), D·share of his games without them, D·share of
 * his last 5 without them; D = his minutes without minus with, shrunk Na / (Na + 3), ±12.
 */
function teammateTerms(
  playerId: string,
  team: TeamSeason | undefined,
  injuries: ReadonlyMap<string, InjuryOutlook>,
  left: number
): [number, number, number] {
  const me = team?.players.get(playerId);
  if (!team || !me) return [0, 0, 0];
  const L = team.dates;
  const A = ROS_ABS;
  const myGames = L.filter((d) => me.has(d));
  const last5 = myGames.slice(-5);
  const out: [number, number, number] = [0, 0, 0];
  for (const [other, theirs] of team.players) {
    if (other === playerId) continue;
    const first = L.findIndex((d) => theirs.has(d));
    let sa = 0;
    let na = 0;
    let sp = 0;
    let np = 0;
    for (let k = first; k < L.length; k += 1) {
      const mine = me.get(L[k]);
      if (mine === undefined) continue;
      if (theirs.has(L[k])) {
        sp += mine;
        np += 1;
      } else {
        sa += mine;
        na += 1;
      }
    }
    if (!na || !np) continue;
    const D = clamp(((sa / na - sp / np) * na) / (na + 3), -12, 12);
    const hs = na / Math.max(myGames.length, 1);
    const a5 =
      last5.filter((d) => L.indexOf(d) >= first && !theirs.has(d)).length /
      Math.max(last5.length, 1);
    let played = 0;
    let mins = 0;
    let streak = 0;
    for (let k = first; k < L.length; k += 1) {
      const m = theirs.get(L[k]);
      if (m === undefined) streak += 1;
      else {
        played += 1;
        mins += m;
        streak = 0;
      }
    }
    const so = played / Math.max(L.length - first, 1);
    const mpg = mins / Math.max(played, 1);
    const pred = (streak: number) => {
      const st = Math.min(streak, 20);
      // prettier-ignore
      return clamp(A[0] + A[1] * so + A[2] * Math.log(1 + st) + A[3] * (st >= 5 ? 1 : 0) +
        A[4] * (st >= 10 ? 1 : 0) + A[5] * mpg, 0, 1);
    };
    const gamesOut = injuries.get(other)?.gamesOut;
    let absent: number;
    if (gamesOut && left > 0) {
      const q = Math.min(gamesOut, left) / left;
      absent = q + (1 - q) * pred(0);
    } else absent = pred(streak);
    out[0] += D * absent;
    out[1] += D * hs;
    out[2] += D * a5;
  }
  return out;
}

/** One projection per role row, in its order; `rows` are the season's played rows. */
export function projectRestOfSeason(
  rows: readonly RoleGameRow[],
  roles: readonly Pick<RoleRow, 'playerId' | 'teamCode'>[],
  context: ScheduleContext,
  history: PlayerHistory,
  injuries: ReadonlyMap<string, InjuryOutlook>
): RestOfSeasonProjection[] {
  const byPlayer = groupBy(rows, (row) => row.playerId);
  const teams = teamSeasons(rows);
  const R = ROS_MODEL;
  return roles.map(({ playerId, teamCode }) => {
    const g = byPlayer.get(playerId) ?? [];
    const n = g.length;
    const l5 = g.slice(-5);
    const l10 = g.slice(-10);
    const m5 = total(l5, 'min') / l5.length;
    const m10 = total(l10, 'min') / l10.length;
    const ms = total(g, 'min') / n;
    const early = earlyWeight(n);
    const last = history.lastSeason.get(playerId);
    const hp = last ? 1 : 0;
    const pm = last ? last.mpg : ms;
    const up = upcomingGames(context, teamCode);
    const tm = teammateTerms(playerId, teams.get(teamCode), injuries, up.length);
    const b = R.min;
    // prettier-ignore
    const base = b[0] + b[1] * m5 + b[2] * m10 + b[3] * ms + b[4] * pm + b[5] * hp + b[6] * pm * early +
      b[7] * ms * early;
    const shift = b[8] * tm[0] + b[9] * tm[1] + b[10] * tm[2];
    const minutes = Math.max(0, base + shift);

    const prior = history.priors.get(playerId);
    const M5 = Math.max(total(l5, 'min'), 1);
    const M10 = Math.max(total(l10, 'min'), 1);
    const MS = Math.max(total(g, 'min'), 1);
    const p = mapStats((c) => {
      const k = R[c];
      const r5 = total(l5, c) / M5;
      const r10 = total(l10, c) / M10;
      const rs = total(g, c) / MS;
      const rp = prior?.rates[c] ?? rs;
      // prettier-ignore
      const rate = k[0] + k[1] * r5 + k[2] * r10 + k[3] * rs + k[4] * rp + k[5] * rp * early +
        k[6] * rs * early;
      return Math.max(0, rate) * minutes;
    });
    const { fgPct, ftPct } = shootingPercentages(g, prior);
    p.pts = pointsFrom(p, fgPct, ftPct);

    // Availability: share of team games played so far, last season's share and minutes.
    const done = (context.teamGames.get(teamCode) ?? []).filter((game) => game.final).length;
    const so = Math.min(n / Math.max(done, 1), 1);
    const pg = last ? last.share : so;
    const a = R.avail;
    const lowx = (1 - pg) * Math.min(Math.max(pm / 30, 0), 1.3);
    // prettier-ignore
    const rate = clamp(a[0] + a[1] * so + a[2] * pg + a[3] * hp + a[4] * so * early + a[5] * pg * early +
      a[6] * ms + a[7] * early + a[8] * pm + a[9] * lowx + a[10] * lowx * early, 0, 1);
    const gamesOut = injuries.get(playerId)?.gamesOut ?? 0;
    let expectedGames = 0;
    up.forEach((_, i) => {
      expectedGames += (1 - clamp(gamesOut - i, 0, 1)) * rate;
    });

    return {
      playerId,
      teamCode,
      minutes: round1(minutes),
      expectedGames: round1(expectedGames),
      stats: mapStats((c) => round1(p[c])),
      fgPct,
      ftPct,
      teamGamesLeft: up.length,
      teammateShift: round1(shift),
      raw: { minutes, expectedGames, stats: p, teammateShift: shift },
    };
  });
}
