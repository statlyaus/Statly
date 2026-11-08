/**
 * Role outlook schedule: how much each defence allows, and per player the opponents of his team's
 * next 5 games, his back-to-backs, his chance of sitting a second night and his expected games (the
 * sheet's `scheduleContext_` and `playerSchedule_`). Same summation order as the script. Pure and
 * isomorphic.
 */

import { addDays, type EasternDate } from './fantasyWeeks';
import { PROJECTED_STATS, backToBackNights, type BackToBackRecord } from './playerHistory';
import { logistic } from './roleFeatures';
import type { RoleGameRow } from './roleGameRows';
import { SIT_MODEL, type ProjectedStat } from './roleModelConstants';

/** A season game (cancelled and postponed games left out). */
export interface ScheduleGame {
  date: EasternDate;
  home: string;
  away: string;
  final: boolean;
}

export interface TeamGame {
  date: EasternDate;
  opponent: string;
  final: boolean;
}

export interface ScheduleContext {
  today: EasternDate;
  /** Each team's games in date order. */
  teamGames: ReadonlyMap<string, TeamGame[]>;
  /** Per defence and stat: ln of what it allows per minute vs the league, shrunk n / (n + 10). */
  defence: ReadonlyMap<string, Record<ProjectedStat, number>>;
  /** `playerId|team|date` of every played row. */
  played: ReadonlySet<string>;
}

export interface UpcomingGame {
  date: EasternDate;
  /** (1 − injured) × (1 − P(sits)); unrounded. */
  chancePlays: number;
}

export interface PlayerSchedule {
  /** Mean defence factor of his team's next 5 opponents, per stat (0 with no games left). */
  od: Record<ProjectedStat, number>;
  /** Second nights of a back-to-back in the next 5. */
  backToBacks: number;
  chanceSitsBackToBack: number;
  /** Σ chance he plays over the next 5. */
  expectedGames: number;
  /** His team's games in the next 14 days. */
  upcoming: UpcomingGame[];
}

const zeros = () =>
  Object.fromEntries(PROJECTED_STATS.map((c) => [c, 0])) as Record<ProjectedStat, number>;
export const clamp = (x: number, low: number, high: number) => Math.min(Math.max(x, low), high);
const UPCOMING_DAYS = 14;

/** `games` is the season's schedule; `rows` its played rows; `today` the Eastern date. */
export function buildScheduleContext(
  rows: readonly RoleGameRow[],
  games: readonly ScheduleGame[],
  today: EasternDate
): ScheduleContext {
  const teamGames = new Map<string, TeamGame[]>();
  const opponentOf = new Map<string, string>();
  for (const { date, home, away, final } of games) {
    for (const [team, opponent] of [
      [home, away],
      [away, home],
    ]) {
      const list = teamGames.get(team) ?? [];
      teamGames.set(team, list);
      list.push({ date, opponent, final });
      opponentOf.set(`${team}|${date}`, opponent);
    }
  }
  for (const list of teamGames.values())
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const league = { ...zeros(), min: 0 };
  const allowed = new Map<string, { sums: typeof league; dates: Set<EasternDate> }>();
  for (const row of rows) {
    const opponent = opponentOf.get(`${row.team}|${row.date}`);
    if (!opponent) continue;
    const a = allowed.get(opponent) ?? { sums: { ...zeros(), min: 0 }, dates: new Set() };
    allowed.set(opponent, a);
    for (const c of PROJECTED_STATS) {
      a.sums[c] += row[c];
      league[c] += row[c];
    }
    a.sums.min += row.min;
    league.min += row.min;
    a.dates.add(row.date);
  }
  const defence = new Map<string, Record<ProjectedStat, number>>();
  for (const [team, { sums, dates }] of allowed) {
    const n = dates.size;
    const factors = zeros();
    for (const c of PROJECTED_STATS) {
      let ratio = sums[c] / sums.min / (league[c] / league.min);
      if (!Number.isFinite(ratio)) ratio = 1;
      factors[c] = Math.log((n * ratio + 10) / (n + 10));
    }
    defence.set(team, factors);
  }
  const played = new Set(rows.map((row) => `${row.playerId}|${row.team}|${row.date}`));
  return { today, teamGames, defence, played };
}

/** A team's remaining games: not final, today or later. */
export function upcomingGames(context: ScheduleContext, team: string): TeamGame[] {
  return (context.teamGames.get(team) ?? []).filter(
    (game) => !game.final && game.date >= context.today
  );
}

/**
 * `games` are his rows for `team` in date order; `history` his earlier seasons' back-to-back
 * record; `fracNext5` his injury input (0 when healthy).
 */
export function playerSchedule(
  context: ScheduleContext,
  playerId: string,
  team: string,
  games: readonly RoleGameRow[],
  history: BackToBackRecord | undefined,
  fracNext5: number
): PlayerSchedule {
  const all = context.teamGames.get(team) ?? [];
  const up = upcomingGames(context, team);
  const dates = new Set(all.map((game) => game.date));
  const next5 = up.slice(0, 5);
  const od = zeros();
  for (const c of PROJECTED_STATS) {
    let s = 0;
    for (const game of next5) s += context.defence.get(game.opponent)?.[c] ?? 0;
    od[c] = next5.length ? s / next5.length : 0;
  }

  // History: earlier seasons plus this season's final games, by the same rule.
  let eligible = history?.eligible ?? 0;
  let sits = history?.sits ?? 0;
  const played = (date: EasternDate) => context.played.has(`${playerId}|${team}|${date}`);
  const finals = all.filter((game) => game.final).map((game) => game.date);
  for (const [first, second, next] of backToBackNights(finals)) {
    if (!played(first)) continue;
    eligible += 1;
    if (!played(second) && played(next)) sits += 1;
  }
  const S = SIT_MODEL;
  const C = S.coef;
  const B = S.baseB2b;
  const hist = Math.log((sits + B * S.priorN) / (eligible + S.priorN) / B);
  const recent = games.filter((row) => row.min > 0).slice(-10);
  const mpg = recent.reduce((total, row) => total + row.min, 0) / Math.max(recent.length, 1);
  const m = (mpg - S.mCentre) / S.mScale;
  // prettier-ignore
  const sit = (b2b: number) =>
    logistic(S.intercept + C.b2b * b2b + C.m * m + C.mB2b * m * b2b + C.hist * hist + C.histB2b * hist * b2b);

  let expectedGames = 0;
  let backToBacks = 0;
  const horizon = addDays(context.today, UPCOMING_DAYS);
  const upcoming: UpcomingGame[] = [];
  up.forEach((game, i) => {
    const b2b = dates.has(addDays(game.date, -1)) ? 1 : 0;
    const out = clamp(fracNext5 * 5 - i, 0, 1);
    const chancePlays = (1 - out) * (1 - sit(b2b));
    if (i < 5) {
      expectedGames += chancePlays;
      backToBacks += b2b;
    }
    if (game.date < horizon) upcoming.push({ date: game.date, chancePlays });
  });
  return { od, backToBacks, chanceSitsBackToBack: sit(1), expectedGames, upcoming };
}
