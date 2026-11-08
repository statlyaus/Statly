/**
 * Role outlook features: the 50 per-game role features of the sheet's Role Model (`RoleModel.gs`,
 * `buildFeats_`) for every game of every player-team sequence, and each game's teammate
 * minutes-drop probability. A rule-for-rule port: same windows, same summation order, same quirks
 * (team margin over 10 games is divided by 10 however few games there are). Pure and isomorphic.
 */

import type { RoleGameRow } from './roleGameRows';
import { COACH_TRAITS, PDROP_FEATURES, PDROP_MODEL } from './roleModelConstants';

export type RoleFeatureValues = Record<(typeof PDROP_FEATURES)[number], number>;

export interface RoleFeatureGame {
  row: RoleGameRow;
  /** The game's index in the team's season, by date, from 0. */
  teamGame: number;
  features: RoleFeatureValues;
  /** P(his minutes drop), the teammate input of the injury block. */
  pdrop: number;
}

/** One player's games for one team, in order. A traded player has one sequence per team. */
export interface RoleSequence {
  playerId: string;
  team: string;
  games: RoleFeatureGame[];
}

export interface RoleFeatureSet {
  /** In order of each sequence's first row. */
  sequences: RoleSequence[];
  /** Each team's latest team game index. */
  lastTeamGame: Map<string, number>;
}

const UNKNOWN_COACH = ['?', 0, 0, 0, 0, 0] as const;

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: readonly number[]) => sum(values) / values.length;

function sd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((total, x) => total + (x - m) * (x - m), 0) / (values.length - 1));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** intercept + Σ coef·feature in coefficient order, a missing or non-finite feature as 0. */
export function linear(
  intercept: number,
  coef: readonly number[],
  names: readonly string[],
  features: Readonly<Record<string, number>>
): number {
  let z = intercept;
  names.forEach((name, index) => {
    const value = features[name];
    z += coef[index] * (Number.isFinite(value) ? value : 0);
  });
  return z;
}

export const logistic = (z: number) => 1 / (1 + Math.exp(-z));

const load = (row: RoleGameRow) => (row.usg * row.min) / 48;

/** Team game index by date, per team. */
function teamGameIndex(rows: readonly RoleGameRow[]): Map<string, number> {
  const dates = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = dates.get(row.team) ?? new Set<string>();
    dates.set(row.team, set);
    set.add(row.date);
  }
  const index = new Map<string, number>();
  for (const [team, set] of dates) {
    [...set].sort().forEach((date, i) => index.set(`${team}|${date}`, i));
  }
  return index;
}

/**
 * Per team game: [minutes per game, before this game, of the team's top 8 by minutes so far who
 * are absent, the mean of that over the team's last 3 games]. Anyone who has played for the team
 * counts, departed players included.
 */
function rotationMissing(
  rows: readonly RoleGameRow[],
  index: ReadonlyMap<string, number>
): Map<string, [number, number]> {
  const byTeam = new Map<string, RoleGameRow[][]>();
  for (const row of rows) {
    const games = byTeam.get(row.team) ?? [];
    byTeam.set(row.team, games);
    const i = index.get(`${row.team}|${row.date}`)!;
    (games[i] ??= []).push(row);
  }
  const result = new Map<string, [number, number]>();
  for (const [team, games] of byTeam) {
    const minutes = new Map<string, number>();
    const played = new Map<string, number>();
    const history: number[] = [];
    games.forEach((game, i) => {
      const top = [...minutes.keys()].sort((a, b) => minutes.get(b)! - minutes.get(a)!).slice(0, 8);
      const present = new Set(game.map((row) => row.playerId));
      let missing = 0;
      for (const id of top) if (!present.has(id)) missing += minutes.get(id)! / played.get(id)!;
      history.push(missing);
      result.set(`${team}|${i}`, [missing, mean(history.slice(-3))]);
      for (const row of game) {
        minutes.set(row.playerId, (minutes.get(row.playerId) ?? 0) + row.min);
        played.set(row.playerId, (played.get(row.playerId) ?? 0) + 1);
      }
    });
  }
  return result;
}

// prettier-ignore
const WINDOW_STATS = [
  'pts', 'fgm', 'fga', 'fg3m', 'ftm', 'fta', 'reb', 'ast', 'stl', 'blk', 'tov', 'min', 'pm', 'relPm', 'margin',
] as const;

type WindowRow = RoleGameRow & { relPm: number };

/** The per-36, shooting and plus-minus features over his last `w` games. */
function windowFeatures(window: readonly WindowRow[], w: number) {
  const s = Object.fromEntries(
    WINDOW_STATS.map((stat) => [stat, window.reduce((total, row) => total + row[stat], 0)])
  ) as Record<(typeof WINDOW_STATS)[number], number>;
  const m36 = 36 / Math.max(s.min, 1);
  return {
    pts36: s.pts * m36,
    fga36: s.fga * m36,
    fta36: s.fta * m36,
    reb36: s.reb * m36,
    ast36: s.ast * m36,
    stocks36: (s.stl + s.blk) * m36,
    tov36: s.tov * m36,
    fg3aProxy36: s.fg3m * m36,
    ts: s.pts / Math.max(2 * (s.fga + 0.44 * s.fta), 1),
    efg: (s.fgm + 0.5 * s.fg3m) / Math.max(s.fga, 1),
    ftp: s.ftm / Math.max(s.fta, 1),
    tovr: s.tov / Math.max(s.fga + 0.44 * s.fta + s.tov, 1),
    pm36: s.pm * m36,
    relPm36: s.relPm * m36,
    teamMargin: s.margin / w,
  };
}

export function buildRoleFeatures(rows: readonly RoleGameRow[]): RoleFeatureSet {
  const index = teamGameIndex(rows);
  const rotMissing = rotationMissing(rows, index);
  const lastTeamGame = new Map<string, number>();
  const bySequence = new Map<string, { row: WindowRow; teamGame: number }[]>();
  for (const row of rows) {
    const teamGame = index.get(`${row.team}|${row.date}`)!;
    lastTeamGame.set(row.team, Math.max(lastTeamGame.get(row.team) ?? 0, teamGame));
    const key = `${row.playerId}|${row.team}`;
    const games = bySequence.get(key) ?? [];
    bySequence.set(key, games);
    games.push({ row: { ...row, relPm: row.pm - (row.margin * row.min) / 48 }, teamGame });
  }

  const sequences: RoleSequence[] = [];
  for (const games of bySequence.values()) {
    games.sort((a, b) => a.teamGame - b.teamGame);
    const { playerId, team } = games[0].row;
    const [, vol, depth, expand, swing, priorSeasons] = COACH_TRAITS[team] ?? UNKNOWN_COACH;
    // Running totals add in the script's order, so season means equal its prefix sums exactly.
    const totals = { min: 0, usg: 0, load: 0, pts: 0, fga: 0, fta: 0 };
    let tenure = 0;
    const out = games.map(({ row, teamGame }, i): RoleFeatureGame => {
      const last = (w: number) => games.slice(Math.max(0, i + 1 - w), i + 1).map((g) => g.row);
      const meanOf = (w: number, value: (r: RoleGameRow) => number) => mean(last(w).map(value));
      totals.min += row.min;
      totals.usg += row.usg;
      totals.load += load(row);
      totals.pts += row.pts;
      totals.fga += row.fga;
      totals.fta += row.fta;
      const n = i + 1;
      const before = games.slice(Math.max(0, i - 10), i).map((g) => g.row.min);
      tenure = before.length >= 5 && row.min >= median(before) + 4 ? tenure + 1 : 0;
      const l5 = windowFeatures(last(5), 5);
      const l10 = windowFeatures(last(10), 10);
      const minSzn = totals.min / n;
      const usgSzn = totals.usg / n;
      const loadSzn = totals.load / n;
      const tsSzn = totals.pts / Math.max(2 * (totals.fga + 0.44 * totals.fta), 1);
      const pts36Szn = (totals.pts * 36) / Math.max(totals.min, 1);
      const [rotMiss, rotMissL3] = rotMissing.get(`${team}|${teamGame}`)!;
      const minL5 = meanOf(5, (r) => r.min);
      const usgL5 = meanOf(5, (r) => r.usg);
      const loadL5 = meanOf(5, load);
      const features: RoleFeatureValues = {
        min_l1: row.min,
        min_l3: meanOf(3, (r) => r.min),
        min_l5: minL5,
        min_l10: meanOf(10, (r) => r.min),
        min_szn: minSzn,
        min_sd10: sd(last(10).map((r) => r.min)),
        usg_l1: row.usg,
        usg_l3: meanOf(3, (r) => r.usg),
        usg_l5: usgL5,
        usg_l10: meanOf(10, (r) => r.usg),
        usg_szn: usgSzn,
        usg_sd10: sd(last(10).map((r) => r.usg)),
        load_l3: meanOf(3, load),
        load_l5: loadL5,
        load_l10: meanOf(10, load),
        load_szn: loadSzn,
        min_gap: minL5 - minSzn,
        usg_gap: usgL5 - usgSzn,
        load_gap: loadL5 - loadSzn,
        gp: n,
        gap: i === 0 ? 0 : teamGame - games[i - 1].teamGame - 1,
        role_tenure: tenure,
        team_min_rank: 0,
        rot_missing: rotMiss,
        rot_missing_l3: rotMissL3,
        pts36_l5: l5.pts36,
        pts36_l10: l10.pts36,
        fga36_l10: l10.fga36,
        fta36_l10: l10.fta36,
        reb36_l10: l10.reb36,
        ast36_l10: l10.ast36,
        stocks36_l10: l10.stocks36,
        tov36_l10: l10.tov36,
        fg3a_proxy36_l10: l10.fg3aProxy36,
        ts_l5: l5.ts,
        ts_l10: l10.ts,
        efg_l10: l10.efg,
        ftp_l10: l10.ftp,
        tovr_l10: l10.tovr,
        ts_d5: l5.ts - tsSzn,
        pts36_d5: l5.pts36 - pts36Szn,
        pm36_l10: l10.pm36,
        relpm36_l5: l5.relPm36,
        relpm36_l10: l10.relPm36,
        teammargin_l10: l10.teamMargin,
        coach_vol: vol,
        coach_depth: depth,
        coach_expand: expand,
        coach_swing: swing,
        coach_prior_seasons: priorSeasons,
        nx_rot_missing: rotMiss,
        d_nx: 0,
      };
      return { row, teamGame, features, pdrop: 0 };
    });
    sequences.push({ playerId, team, games: out });
  }

  // Rank of season minutes within each team game, descending, ties averaged.
  const byTeamGame = new Map<string, RoleFeatureValues[]>();
  for (const sequence of sequences) {
    for (const game of sequence.games) {
      const key = `${sequence.team}|${game.teamGame}`;
      const group = byTeamGame.get(key) ?? [];
      byTeamGame.set(key, group);
      group.push(game.features);
    }
  }
  for (const group of byTeamGame.values()) {
    for (const x of group) {
      const greater = group.filter((y) => y.min_szn > x.min_szn).length;
      const equal = group.filter((y) => y.min_szn === x.min_szn).length;
      x.team_min_rank = greater + (equal + 1) / 2;
    }
  }
  for (const sequence of sequences) {
    for (const game of sequence.games) {
      game.pdrop = logistic(
        linear(PDROP_MODEL.intercept, PDROP_MODEL.coef, PDROP_FEATURES, game.features)
      );
    }
  }
  return { sequences, lastTeamGame };
}
