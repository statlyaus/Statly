/**
 * Role outlook history: the per-player tables the sheet embeds (`CAREER_PRIOR_`, `ROS_PREV_`,
 * `B2B_HIST_`), recomputed from earlier seasons' stored box scores. Joined by player ID. Pure and
 * isomorphic; the read model supplies the season totals and played tuples.
 */

import { addDays, type EasternDate } from './fantasyWeeks';
import { STAT_PROJ, type ProjectedStat } from './roleModelConstants';

/** One player's played games in one season (cameos as 0.25 minutes), all teams together. */
export interface SeasonTotals extends Record<ProjectedStat | 'fgm' | 'ftm', number> {
  playerId: string;
  season: number;
  minutes: number;
  games: number;
}

/** Decay-weighted career: per-minute rates and weighted makes and attempts. */
export interface CareerPrior {
  rates: Record<ProjectedStat, number>;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
}

export interface LastSeasonLine {
  mpg: number;
  /** Games played ÷ 82. */
  share: number;
}

export interface BackToBackRecord {
  /** Second nights after a first night he played for the team. */
  eligible: number;
  /** Of those, second nights he sat before playing the team's next game. */
  sits: number;
}

export interface HistoryGame {
  season: number;
  date: EasternDate;
  home: string;
  away: string;
}

/** A player who played for a team on a date. */
export interface Presence {
  team: string;
  date: EasternDate;
  playerId: string;
}

/** The history inputs of the stat, schedule and rest-of-season projections. */
export interface PlayerHistory {
  priors: ReadonlyMap<string, CareerPrior>;
  lastSeason: ReadonlyMap<string, LastSeasonLine>;
  backToBack: ReadonlyMap<string, BackToBackRecord>;
}

/** The projected stats, in the script's order. */
export const PROJECTED_STATS = Object.keys(STAT_PROJ) as ProjectedStat[];
const SUMMED = [...PROJECTED_STATS, 'fgm', 'ftm', 'minutes'] as const;
const CAREER_SEASONS = 13;
const MIN_CAREER_MINUTES = 100;

/**
 * Up to the 13 seasons before `season`, weighted 1 for last season, then 0.5, 0.25, …; absent
 * (a rookie for the model) under 100 minutes in all.
 */
export function careerPriors(
  totals: readonly SeasonTotals[],
  season: number
): Map<string, CareerPrior> {
  const sums = new Map<string, { minutes: number; w: Record<(typeof SUMMED)[number], number> }>();
  for (const t of totals) {
    if (t.season >= season || t.season < season - CAREER_SEASONS) continue;
    const weight = 0.5 ** (season - t.season - 1);
    const sum = sums.get(t.playerId) ?? {
      minutes: 0,
      w: Object.fromEntries(SUMMED.map((c) => [c, 0])) as Record<(typeof SUMMED)[number], number>,
    };
    sums.set(t.playerId, sum);
    sum.minutes += t.minutes;
    for (const c of SUMMED) sum.w[c] += weight * t[c];
  }
  const priors = new Map<string, CareerPrior>();
  for (const [playerId, { minutes, w }] of sums) {
    if (minutes < MIN_CAREER_MINUTES) continue;
    const rates = Object.fromEntries(PROJECTED_STATS.map((c) => [c, w[c] / w.minutes]));
    priors.set(playerId, {
      rates: rates as Record<ProjectedStat, number>,
      fgm: w.fgm,
      fga: w.fga,
      ftm: w.ftm,
      fta: w.fta,
    });
  }
  return priors;
}

/** Last season's minutes per game and share of 82 games; absent when he did not play. */
export function lastSeasonLines(
  totals: readonly SeasonTotals[],
  season: number
): Map<string, LastSeasonLine> {
  return new Map(
    totals
      .filter((t) => t.season === season - 1 && t.games > 0)
      .map((t) => [t.playerId, { mpg: t.minutes / t.games, share: t.games / 82 }])
  );
}

/**
 * A team's back-to-back second nights that have a next game, as [first night, second night, next
 * game]; `dates` is the team's games in date order.
 */
export function backToBackNights(
  dates: readonly EasternDate[]
): [EasternDate, EasternDate, EasternDate][] {
  const nights: [EasternDate, EasternDate, EasternDate][] = [];
  for (let i = 1; i < dates.length - 1; i += 1) {
    if (dates[i - 1] === addDays(dates[i], -1)) nights.push([dates[i - 1], dates[i], dates[i + 1]]);
  }
  return nights;
}

/** Back-to-back record over the 3 seasons before `season`, each team season on its own. */
export function backToBackHistory(
  games: readonly HistoryGame[],
  presence: readonly Presence[],
  season: number
): Map<string, BackToBackRecord> {
  const teamSeasons = new Map<string, { team: string; dates: EasternDate[] }>();
  for (const game of games) {
    if (game.season >= season || game.season < season - 3) continue;
    for (const team of [game.home, game.away]) {
      const key = `${game.season}|${team}`;
      const teamSeason = teamSeasons.get(key) ?? { team, dates: [] };
      teamSeasons.set(key, teamSeason);
      teamSeason.dates.push(game.date);
    }
  }
  const present = new Map<string, Set<string>>();
  for (const { team, date, playerId } of presence) {
    const key = `${team}|${date}`;
    present.set(key, (present.get(key) ?? new Set()).add(playerId));
  }
  const records = new Map<string, BackToBackRecord>();
  for (const { team, dates } of teamSeasons.values()) {
    const at = (date: EasternDate) => present.get(`${team}|${date}`) ?? new Set<string>();
    for (const [first, second, next] of backToBackNights(dates.sort())) {
      for (const playerId of at(first)) {
        const record = records.get(playerId) ?? { eligible: 0, sits: 0 };
        records.set(playerId, record);
        record.eligible += 1;
        if (!at(second).has(playerId) && at(next).has(playerId)) record.sits += 1;
      }
    }
  }
  return records;
}
