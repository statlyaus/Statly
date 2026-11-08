/**
 * Role outlook: the sheet's Role Model v3 (`RoleModel.gs`, `computeCoreV3_`). For each player's
 * latest game with a team it predicts minutes, USG% and total usage (USG% × MIN / 48) over the
 * team's next 5 games, the chance of a 3-minute or 15 % usage swing, and the minutes his injured or
 * returning teammates move to him, from his own games with and without each of them this season.
 * A rule-for-rule port: same order of summation and quirks, rounded only in the returned rows.
 * Pure and isomorphic.
 */

import type { EasternDate } from './fantasyWeeks';
import {
  UNKNOWN_COACH,
  buildRoleFeatures,
  linear,
  logistic,
  type RoleSequence,
} from './roleFeatures';
import type { RoleGameRow } from './roleGameRows';
import {
  COACH_TRAITS,
  MINUTES_BAND80,
  ROLE_FEATURES,
  ROLE_HEADS,
  WITH_WITHOUT_SHRINK,
  type RoleFeature,
  type RoleHeadName,
  type TeammateFeature,
} from './roleModelConstants';

/** The sheet's rounding: half up, not `toFixed`. Adding 0 turns −0 into 0. */
export const round1 = (x: number) => Math.round(x * 10) / 10 + 0;
export const round2 = (x: number) => Math.round(x * 100) / 100 + 0;

/** A teammate gone longer than this many team games and not on the injury report is ignored. */
const LOOKBACK = 5;

/** The model's injury input: the share of his team's next 5 games a player is expected to miss. */
export interface RoleInjury {
  fracNext5: number;
}

/** A teammate whose absence or return moves this player's minutes by at least one. */
export interface RoleDriver {
  playerId: string;
  /** OUT: on the injury report. BACK: missed the team's latest game and is not on it. */
  status: 'OUT' | 'BACK';
  /** His minutes without that teammate minus with him, shrunk, to 0.1. */
  minutes: number;
}

/** One player-team row, rounded as the sheet shows it (columns A to T). */
export interface RoleRow {
  playerId: string;
  teamCode: string;
  coach: string;
  /** His games for this team. */
  gamesPlayed: number;
  lastGameDate: EasternDate;
  minutesLast5: number;
  minutesNext5: number;
  /** Rounded next 5 minus rounded last 5. */
  minutesChange: number;
  /** 80 % of the time his next-5 average lands in this range. */
  minutesRange80: { low: number; high: number };
  chanceMinutesUp3: number;
  chanceMinutesDown3: number;
  usageLast5: number;
  usageNext5: number;
  totalUsageLast5: number;
  totalUsageNext5: number;
  totalUsageChange: number;
  chanceTotalUsageUp15: number;
  chanceTotalUsageDown15: number;
  /** Minutes added (+) or removed (−) by teammates newly out or coming back. */
  injuryMinutesShift: number;
  drivers: RoleDriver[];
  /** Consecutive games in a clearly bigger role than his recent median. */
  biggerRoleGames: number;
  /** The seven head outputs before rounding. */
  raw: Record<RoleHeadName, number>;
}

/** The 80 % range of a minutes prediction: the first band whose edge reaches it, else the last. */
export function minutesRange80(predicted: number): { low: number; high: number } {
  const band = MINUTES_BAND80.find((b) => predicted <= b.upto) ?? MINUTES_BAND80.at(-1)!;
  return { low: round1(Math.max(0, predicted + band.lo)), high: round1(predicted + band.hi) };
}

/** A sequence across its team's games: played, minutes, total usage, and the roster window. */
interface Timeline {
  played: boolean[];
  min: number[];
  load: number[];
  /** From his first game to his last, or to the team's latest game if injured or seen recently. */
  window: boolean[];
}

function timeline(sequence: RoleSequence, teamGames: number, injured: boolean): Timeline {
  const t: Timeline = {
    played: Array<boolean>(teamGames).fill(false),
    min: Array<number>(teamGames).fill(0),
    load: Array<number>(teamGames).fill(0),
    window: Array<boolean>(teamGames).fill(false),
  };
  for (const { row, teamGame } of sequence.games) {
    t.played[teamGame] = true;
    t.min[teamGame] = row.min;
    t.load[teamGame] = (row.usg * row.min) / 48;
  }
  const lastSeen = sequence.games.at(-1)!.teamGame;
  const end = injured || teamGames - 1 - lastSeen <= LOOKBACK ? teamGames - 1 : lastSeen;
  for (let h = sequence.games[0].teamGame; h <= end; h += 1) t.window[h] = true;
  return t;
}

/** His mean minutes and total usage without the teammate minus with him, team games before `t`. */
function withWithout(me: Timeline, other: Timeline, t: number) {
  let nab = 0;
  let sab = 0;
  let lab = 0;
  let npr = 0;
  let spr = 0;
  let lpr = 0;
  for (let h = 0; h < t; h += 1) {
    if (!me.played[h]) continue;
    if (other.played[h]) {
      npr += 1;
      spr += me.min[h];
      lpr += me.load[h];
    } else if (other.window[h]) {
      nab += 1;
      sab += me.min[h];
      lab += me.load[h];
    }
  }
  if (!nab || !npr) return { rm: 0, rl: 0, nab };
  const k = nab / (nab + WITH_WITHOUT_SHRINK);
  return { rm: (sab / nab - spr / npr) * k, rl: (lab / nab - lpr / npr) * k, nab };
}

/** A teammate's state before team game `t`; null with fewer than 3 games or 10 minutes a game. */
function teammateState(sequence: RoleSequence, t: number) {
  const prior = sequence.games.filter((game) => game.teamGame < t);
  if (prior.length < 3) return null;
  const mpg = prior.reduce((total, game) => total + game.row.min, 0) / prior.length;
  if (mpg < 10) return null;
  const lpg =
    prior.reduce((total, game) => total + (game.row.usg * game.row.min) / 48, 0) / prior.length;
  const atOrBefore = sequence.games.filter((game) => game.teamGame <= t);
  return {
    mpg,
    lpg,
    outNow: sequence.games.some((game) => game.teamGame === t) ? 0 : 1,
    pdrop: atOrBefore.at(-1)!.pdrop,
    lastSeen: sequence.games.at(-1)!.teamGame,
  };
}

/**
 * One row per player-team sequence whose latest game is his third or later for the team, with 10+
 * minutes a game over his last 5; sorted by rounded total usage next 5, descending. A traded
 * player can have a row for each team. `injuries` holds only players on the injury report.
 */
export function runRoleModel(
  rows: readonly RoleGameRow[],
  injuries: ReadonlyMap<string, RoleInjury>
): RoleRow[] {
  const { sequences, lastTeamGame } = buildRoleFeatures(rows);
  const byTeam = new Map<string, RoleSequence[]>();
  const timelines = new Map<RoleSequence, Timeline>();
  for (const sequence of sequences) {
    const team = byTeam.get(sequence.team) ?? [];
    byTeam.set(sequence.team, team);
    team.push(sequence);
    const teamGames = lastTeamGame.get(sequence.team)! + 1;
    timelines.set(sequence, timeline(sequence, teamGames, injuries.has(sequence.playerId)));
  }

  const out: RoleRow[] = [];
  for (const sequence of sequences) {
    const { row, teamGame: t, features: f } = sequence.games.at(-1)!;
    if (!(f.gp >= 3 && f.min_l5 >= 10)) continue;
    const s: Record<TeammateFeature, number> = {
      A_tot: 0,
      U_tot: 0,
      RET_tot: 0,
      S_tot: 0,
      WW_min: 0,
      WW_load: 0,
      WW_ret: 0,
      WW_cov: 0,
      WW_new: 0,
      WW_newl: 0,
    };
    const drivers: RoleDriver[] = [];
    for (const other of byTeam.get(sequence.team)!) {
      if (other.playerId === sequence.playerId) continue;
      const j = teammateState(other, t);
      if (!j) continue;
      const injury = injuries.get(other.playerId);
      if (!injury && lastTeamGame.get(sequence.team)! - j.lastSeen > LOOKBACK) continue;
      const fo = injury ? injury.fracNext5 : 0;
      const ret = Math.max(j.outNow - fo, 0);
      const nw = Math.max(fo - j.outNow, 0);
      const ww = withWithout(timelines.get(sequence)!, timelines.get(other)!, t);
      s.A_tot += j.mpg * fo;
      s.U_tot += j.lpg * fo;
      s.RET_tot += j.mpg * ret;
      s.S_tot += j.mpg * j.pdrop * (1 - fo);
      s.WW_min += fo * ww.rm;
      s.WW_load += fo * ww.rl;
      s.WW_ret += ret * ww.rm;
      s.WW_cov += fo * (ww.nab >= 2 ? 1 : 0);
      s.WW_new += nw * ww.rm;
      s.WW_newl += nw * ww.rl;
      if ((fo > 0 || ret > 0) && Math.abs(ww.rm) >= 1) {
        drivers.push({
          playerId: other.playerId,
          status: fo > 0 ? 'OUT' : 'BACK',
          minutes: round1(ww.rm),
        });
      }
    }

    const all: Record<RoleFeature, number> = { ...f, ...s };
    const raw = Object.fromEntries(
      Object.entries(ROLE_HEADS).map(([name, head]) => {
        const z = linear(head.intercept, head.coef, ROLE_FEATURES, all);
        return [name, head.kind === 'logistic' ? logistic(z) : all[head.base] + z];
      })
    ) as Record<RoleHeadName, number>;
    const minutesLast5 = round1(f.min_l5);
    const minutesNext5 = round1(raw.y5_min);
    const totalUsageLast5 = round1(f.load_l5);
    const totalUsageNext5 = round1(raw.y5_load);
    out.push({
      playerId: sequence.playerId,
      teamCode: sequence.team,
      coach: (COACH_TRAITS[sequence.team] ?? UNKNOWN_COACH)[0],
      gamesPlayed: f.gp,
      lastGameDate: row.date,
      minutesLast5,
      minutesNext5,
      minutesChange: round1(minutesNext5 - minutesLast5),
      minutesRange80: minutesRange80(raw.y5_min),
      chanceMinutesUp3: round2(raw.y_minup),
      chanceMinutesDown3: round2(raw.y_mindrop),
      usageLast5: round1(f.usg_l5),
      usageNext5: round1(raw.y5_usg),
      totalUsageLast5,
      totalUsageNext5,
      totalUsageChange: round1(totalUsageNext5 - totalUsageLast5),
      chanceTotalUsageUp15: round2(raw.y_loadup),
      chanceTotalUsageDown15: round2(raw.y_loaddrop),
      injuryMinutesShift: round1(s.WW_new - s.WW_ret),
      drivers,
      biggerRoleGames: f.role_tenure,
      raw,
    });
  }
  return out.sort((a, b) => b.totalUsageNext5 - a.totalUsageNext5);
}
