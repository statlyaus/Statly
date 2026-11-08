/**
 * Layer A parity for the projections: next 5 stats and schedule, and rest of season, against the
 * owner's `RoleModel.gs` (`statProj_`, `playerSchedule_`, `rosProj_`) on identical synthetic rows,
 * schedule, injuries and history tables (the port's own `playerHistory` output, fed to both). CI
 * checks the port against `__fixtures__/roleProjectionExpected.json`, the script's own output on
 * the generated league. With `ROLE_MODEL_GS_DIR` set to a folder holding `RoleModel.gs` (never
 * committed), the script runs here in `node:vm` and must reproduce that file and a 30-team league;
 * `ROLE_MODEL_WRITE_EXPECTED=1` rewrites the file from the script.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { syntheticRoleHistory, syntheticRoleLeague } from './__fixtures__/roleModelLeague';
import { addDays } from './fantasyWeeks';
import {
  PROJECTED_STATS,
  backToBackHistory,
  careerPriors,
  lastSeasonLines,
  type PlayerHistory,
} from './playerHistory';
import { projectRestOfSeason } from './restOfSeason';
import { toRoleGameRows } from './roleGameRows';
import { round1, runRoleModel } from './roleModel';
import { COACH_TRAITS } from './roleModelConstants';
import { buildScheduleContext } from './roleSchedule';
import { projectNextFive, type StatLine } from './roleStatProjection';

const GS_DIR = process.env.ROLE_MODEL_GS_DIR;
const EXPECTED = join(process.cwd(), 'src/lib/basketball/__fixtures__/roleProjectionExpected.json');
const SEASON = 2027;
const TO_SCRIPT: Record<string, string> = { NOP: 'NOR', PHX: 'PHO' };
const FROM_SCRIPT: Record<string, string> = { NOR: 'NOP', PHO: 'PHX' };
const RAW_NEXT5 = [...PROJECTED_STATS, 'oppDefence', 'pSitB2b', 'expGames5', 'expGamesWeek'];
const RAW_ROS = ['minutes', 'expGames', ...PROJECTED_STATS, 'teammateShift'];

/** Player, team, the sheet's columns U–AM and AN–BB as shown, then the raw values compared. */
type Row = [string, string, number[], number[], number[], number[]];

type League = ReturnType<typeof league>;

function league(options?: { seed?: number; teams?: string[]; days?: number }) {
  const { rows, injuries, games, today } = syntheticRoleLeague({ ...options, futureDays: 21 });
  const past = syntheticRoleHistory(options);
  const history: PlayerHistory = {
    priors: careerPriors(past.totals, SEASON),
    lastSeason: lastSeasonLines(past.totals, SEASON),
    backToBack: backToBackHistory(past.games, past.presence, SEASON),
  };
  return { rows: toRoleGameRows(rows), injuries, games, today, history };
}

/** The script's fantasy week end: the next Sunday. */
function weekEnd(today: string) {
  return addDays(today, (7 - new Date(`${today}T12:00:00Z`).getUTCDay()) % 7);
}

/** The sheet's stat columns: PTS, 3PTM, REB, AST, STL, BLK, TO, FG%, FGA, FT%, FTA. */
const line = (s: StatLine, fgPct: number, ftPct: number) => [
  s.pts,
  s.fg3m,
  s.reb,
  s.ast,
  s.stl,
  s.blk,
  s.tov,
  fgPct,
  s.fga,
  ftPct,
  s.fta,
];

function fromPort({ rows, injuries, games, today, history }: League): Row[] {
  const roles = runRoleModel(rows, injuries);
  const context = buildScheduleContext(rows, games, today);
  const next5 = projectNextFive(rows, roles, context, history, injuries);
  const ros = projectRestOfSeason(rows, roles, context, history, injuries);
  const end = weekEnd(today);
  return roles.map((role, i) => {
    const n = next5[i];
    const r = ros[i];
    const week = n.upcoming
      .filter((game) => game.date <= end)
      .reduce((sum, game) => sum + game.chancePlays, 0);
    const { pts, reb, ast } = n.vsSeason;
    return [
      role.playerId,
      role.teamCode,
      [...line(n.stats, n.fgPct, n.ftPct), pts, reb, ast, n.oppDefence, n.backToBacks].concat([
        n.chanceSitsBackToBack,
        n.expectedGames,
        round1(week),
      ]),
      [r.minutes, r.expectedGames, ...line(r.stats, r.fgPct, r.ftPct), r.teamGamesLeft].concat([
        r.teammateShift,
      ]),
      [...PROJECTED_STATS.map((c) => n.raw.stats[c]), n.raw.oppDefence].concat([
        n.raw.chanceSitsBackToBack,
        n.raw.expectedGames,
        week,
      ]),
      [r.raw.minutes, r.raw.expectedGames, ...PROJECTED_STATS.map((c) => r.raw.stats[c])].concat([
        r.raw.teammateShift,
      ]),
    ];
  });
}

/** `runRoleModelV3` up to the projections, once as shown and once with its rounding removed. */
function fromScript(dir: string, { rows, injuries, games, today, history }: League): Row[] {
  const context = vm.createContext({ Utilities: { formatDate: () => today } });
  vm.runInContext(readFileSync(join(dir, 'RoleModel.gs'), 'utf8'), context);
  const byId = <T>(map: ReadonlyMap<string, T>, value: (v: T) => unknown) =>
    Object.fromEntries([...map].map(([id, v]) => [id, value(v)]));
  const team = (code: string) => TO_SCRIPT[code] ?? code;
  context.input = {
    rows: rows.map(({ playerId, ...row }) => ({ ...row, name: playerId, team: team(row.team) })),
    sched: games.map((g) => ({
      date: g.date,
      home: team(g.home),
      away: team(g.away),
      done: g.final,
    })),
    frac: byId(injuries, (i) => i.fracNext5),
    gout: byId(injuries, (i) => i.gamesOut),
    prior: byId(history.priors, (p) => [
      ...PROJECTED_STATS.map((c) => p.rates[c]),
      p.fgm,
      p.fga,
      p.ftm,
      p.fta,
    ]),
    prev: byId(history.lastSeason, (l) => [l.mpg, l.share]),
    b2b: byId(history.backToBack, (b) => [b.eligible, b.sits]),
  };
  const out = JSON.parse(
    vm.runInContext(
      `(function () {
        // Players are joined by ID: no name normalisation or aliases.
        normName_ = function (s) { return s; };
        CAREER_ALIAS_ = {}; CAREER_PRIOR_ = input.prior; ROS_PREV_ = input.prev; B2B_HIST_ = input.b2b;
        var out = computeCoreV3_(input.rows, input.frac, ROLE_MODEL)
          .map(function (r) { return r.slice(0, 19); })
          .sort(function (a, b) { return b[13] - a[13]; });
        function run() {
          var ctx = scheduleContext_(input.rows, input.sched);
          return [statProj_(input.rows, out, ctx, input.frac), rosProj_(input.rows, out, ctx, input.gout)];
        }
        var shown = run(), r1 = r1_, r2 = r2_;
        r1_ = r2_ = function (x) { return x; };
        var raw = run();
        r1_ = r1; r2_ = r2;
        return JSON.stringify(out.map(function (r, i) {
          return [r[0], r[1], shown[0][i], shown[1][i], raw[0][i], raw[1][i]];
        }));
      })()`,
      context
    )
  ) as [string, string, number[], number[], number[], number[]][];
  const pick = (values: number[], indexes: number[]) => indexes.map((i) => values[i]);
  return out.map(([id, code, next5, ros, rawNext5, rawRos]) => [
    id,
    FROM_SCRIPT[code] ?? code,
    next5,
    ros,
    pick(rawNext5, [0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 16, 17, 18]),
    pick(rawRos, [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14]),
  ]);
}

/** Shown columns equal; the largest raw difference per output. */
function compare(actual: Row[], expected: Row[]): Record<string, number> {
  expect(actual.map((row) => row.slice(0, 4))).toEqual(expected.map((row) => row.slice(0, 4)));
  const max = (column: 4 | 5, k: number) =>
    Math.max(...actual.map((row, i) => Math.abs(row[column][k] - expected[i][column][k])));
  return Object.fromEntries([
    ...RAW_NEXT5.map((name, k) => [`next5 ${name}`, max(4, k)]),
    ...RAW_ROS.map((name, k) => [`ros ${name}`, max(5, k)]),
  ]);
}

describe('role projection parity (Layer A)', () => {
  describe.skipIf(!GS_DIR)('against RoleModel.gs', () => {
    it('commits the script’s own output as the expectation', () => {
      const output = fromScript(GS_DIR!, league());
      if (process.env.ROLE_MODEL_WRITE_EXPECTED === '1') {
        writeFileSync(EXPECTED, `[\n${output.map((row) => JSON.stringify(row)).join(',\n')}\n]\n`);
      }
      const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as Row[];
      for (const difference of Object.values(compare(output, expected))) expect(difference).toBe(0);
    });

    it('matches the script on a 30-team league', () => {
      const big = league({ seed: 11, teams: Object.keys(COACH_TRAITS), days: 150 });
      const port = fromPort(big);
      const maxRaw = compare(port, fromScript(GS_DIR!, big));
      console.info(
        `Layer A projections: ${port.length} rows; max |raw Δ| ${Object.entries(maxRaw)
          .map(([name, d]) => `${name} ${d}`)
          .join(', ')}`
      );
      for (const difference of Object.values(maxRaw)) expect(difference).toBeLessThan(1e-9);
    });
  });

  // After the block above, so a rewrite of the expectation is checked in the same run.
  it('reproduces the script’s output on the synthetic league', () => {
    const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as Row[];
    const maxRaw = compare(fromPort(league()), expected);
    for (const difference of Object.values(maxRaw)) expect(difference).toBeLessThan(1e-9);
  });
});
