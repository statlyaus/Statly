/**
 * Role outlook stat projection: per-game stats over a player's team's next 5 games (the sheet's
 * `statProj_`). Per-minute rates blend his last 5, last 10 and season with his career early in the
 * season and his predicted usage and minutes change, times his predicted minutes, then adjust for
 * the next 5 opponents. Same summation order as the script. Pure and isomorphic.
 */

import type { InjuryOutlook } from './injuryOutlook';
import { PROJECTED_STATS, type CareerPrior, type PlayerHistory } from './playerHistory';
import type { RoleGameRow } from './roleGameRows';
import { round1, round2, type RoleRow } from './roleModel';
import { OPP_COEF, STAT_PROJ, type ProjectedStat } from './roleModelConstants';
import { clamp, playerSchedule, type ScheduleContext, type UpcomingGame } from './roleSchedule';

export type StatLine = Record<ProjectedStat, number>;

export interface NextFiveProjection {
  playerId: string;
  teamCode: string;
  /** Per game, to 0.1. */
  stats: StatLine;
  /** Season makes shrunk to his career %, to 0.001. */
  fgPct: number;
  ftPct: number;
  /** Projected per game minus his season average for this team. */
  vsSeason: { pts: number; reb: number; ast: number };
  /** % more (+) or fewer (−) points his next 5 opponents allow than average. */
  oppDefence: number;
  backToBacks: number;
  chanceSitsBackToBack: number;
  expectedGames: number;
  /** His team's games in the next 14 days with the chance he plays each, for weekly totals. */
  upcoming: UpcomingGame[];
  /** Before rounding. */
  raw: { stats: StatLine; oppDefence: number; chanceSitsBackToBack: number; expectedGames: number };
}

/** The role model fields a projection reads: its rounded predictions, as the sheet feeds them. */
export type RoleInput = Pick<RoleRow, 'playerId' | 'teamCode' | 'minutesNext5' | 'usageNext5'>;

/** Σ of a field from 0 in row order, as the script adds. */
export const total = (
  rows: readonly RoleGameRow[],
  field: ProjectedStat | 'min' | 'usg' | 'fgm' | 'ftm'
) => rows.reduce((sum, row) => sum + row[field], 0);

/** The career prior's weight: 1 in his first game, 0 from his 21st. */
export const earlyWeight = (games: number) => clamp(1 - (games - 1) / 20, 0, 1);

/** Rows by key, each group in date order. */
export function groupBy(rows: readonly RoleGameRow[], key: (row: RoleGameRow) => string) {
  const groups = new Map<string, RoleGameRow[]>();
  for (const row of rows) {
    const group = groups.get(key(row)) ?? [];
    groups.set(key(row), group);
    group.push(row);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  return groups;
}

export const mapStats = (f: (stat: ProjectedStat) => number) =>
  Object.fromEntries(PROJECTED_STATS.map((c) => [c, f(c)])) as StatLine;

/**
 * FG% and FT%: his makes and attempts shrunk towards his career % (itself shrunk to the league's
 * 46.3 % and 77.4 %, 25 FGA and 12.5 FTA; career used from 50 FGA, 25 FTA) with 100 FGA and 50 FTA.
 */
export function shootingPercentages(games: readonly RoleGameRow[], prior: CareerPrior | undefined) {
  const fgPrior = prior && prior.fga >= 50 ? (prior.fgm + 0.463 * 25) / (prior.fga + 25) : 0.463;
  const ftPrior =
    prior && prior.fta >= 25 ? (prior.ftm + 0.774 * 12.5) / (prior.fta + 12.5) : 0.774;
  const fgPct = (total(games, 'fgm') + fgPrior * 100) / (total(games, 'fga') + 100);
  const ftPct = (total(games, 'ftm') + ftPrior * 50) / (total(games, 'fta') + 50);
  return { fgPct: Math.round(fgPct * 1000) / 1000, ftPct: Math.round(ftPct * 1000) / 1000 };
}

/** Points from the shooting line: 2·FG%·FGA + 3PM + FT%·FTA. */
export const pointsFrom = (p: StatLine, fgPct: number, ftPct: number) =>
  2 * fgPct * p.fga + p.fg3m + ftPct * p.fta;

/** One projection per role row, in its order; `rows` are the season's played rows. */
export function projectNextFive(
  rows: readonly RoleGameRow[],
  roles: readonly RoleInput[],
  context: ScheduleContext,
  history: PlayerHistory,
  injuries: ReadonlyMap<string, InjuryOutlook>
): NextFiveProjection[] {
  const bySequence = groupBy(rows, (row) => `${row.playerId}|${row.team}`);
  return roles.map(({ playerId, teamCode, minutesNext5, usageNext5 }) => {
    const g = bySequence.get(`${playerId}|${teamCode}`) ?? [];
    const n = g.length;
    const pMin = Math.max(0, minutesNext5);
    const l5 = g.slice(-5);
    const l10 = g.slice(-10);
    const m5 = Math.max(total(l5, 'min'), 1);
    const m10 = Math.max(total(l10, 'min'), 1);
    const ms = Math.max(total(g, 'min'), 1);
    const early = earlyWeight(n);
    const lu = Math.log(clamp(usageNext5, 5, 45) / clamp(total(g, 'usg') / n, 5, 45));
    const lm = Math.log(clamp(pMin, 5, 44) / clamp(total(g, 'min') / n, 5, 44));
    const prior = history.priors.get(playerId);
    const p = mapStats((c) => {
      const b = STAT_PROJ[c];
      const r5 = total(l5, c) / m5;
      const r10 = total(l10, c) / m10;
      const rs = total(g, c) / ms;
      const rp = prior?.rates[c] ?? rs;
      // prettier-ignore
      const rate = b[0] + b[1] * r5 + b[2] * r10 + b[3] * rs + b[4] * rp * early + b[5] * rs * early +
        b[6] * rs * lu + b[7] * rs * lm;
      return Math.max(0, rate) * pMin;
    });
    const { fgPct, ftPct } = shootingPercentages(g, prior);
    p.pts = pointsFrom(p, fgPct, ftPct);
    const s = playerSchedule(
      context,
      playerId,
      teamCode,
      g,
      history.backToBack.get(playerId),
      injuries.get(playerId)?.gamesOut ?? 0
    );
    for (const c of PROJECTED_STATS) p[c] *= Math.exp(OPP_COEF[c] * s.od[c]);
    const vs = (c: ProjectedStat) => round1(p[c] - total(g, c) / n);
    const raw = {
      stats: p,
      oppDefence: (Math.exp(s.od.pts) - 1) * 100,
      chanceSitsBackToBack: s.chanceSitsBackToBack,
      expectedGames: s.expectedGames,
    };
    return {
      playerId,
      teamCode,
      stats: mapStats((c) => round1(p[c])),
      fgPct,
      ftPct,
      vsSeason: { pts: vs('pts'), reb: vs('reb'), ast: vs('ast') },
      oppDefence: round1(raw.oppDefence),
      backToBacks: s.backToBacks,
      chanceSitsBackToBack: round2(s.chanceSitsBackToBack),
      expectedGames: round1(s.expectedGames),
      upcoming: s.upcoming,
      raw,
    };
  });
}
