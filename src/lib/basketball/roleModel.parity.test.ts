/**
 * Layer A parity: the TypeScript port against the owner's `RoleModel.gs` on identical synthetic
 * rows. CI checks the port against `__fixtures__/roleModelExpected.json`, which is the script's own
 * output on the generated league. With `ROLE_MODEL_GS_DIR` set to a folder holding `RoleModel.gs`
 * (never committed), the script runs here in `node:vm` and must reproduce that file, every fitted
 * constant and a larger league; `ROLE_MODEL_WRITE_EXPECTED=1` rewrites the file from the script.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { syntheticRoleLeague } from './__fixtures__/roleModelLeague';
import { toRoleGameRows, type RoleGameRow } from './roleGameRows';
import { runRoleModel, round1, type RoleInjury, type RoleRow } from './roleModel';
import * as constants from './roleModelConstants';

const GS_DIR = process.env.ROLE_MODEL_GS_DIR;
const EXPECTED = join(process.cwd(), 'src/lib/basketball/__fixtures__/roleModelExpected.json');
const HEADS = ['y5_min', 'y5_usg', 'y5_load', 'y_mindrop', 'y_minup', 'y_loaddrop', 'y_loadup'];
const TO_SCRIPT: Record<string, string> = { NOP: 'NOR', PHX: 'PHO' };
const FROM_SCRIPT: Record<string, string> = { NOR: 'NOP', PHO: 'PHX' };

/** The sheet's columns A to T (both change columns, range split in two), then the raw heads. */
type Row = [...(string | number)[], number[]];

const PORT_COLUMNS = [
  ['playerId', 'teamCode', 'coach', 'gamesPlayed', 'lastGameDate'],
  ['minutesLast5', 'minutesNext5', 'minutesChange'],
  ['chanceMinutesUp3', 'chanceMinutesDown3', 'usageLast5', 'usageNext5', 'totalUsageLast5'],
  ['totalUsageNext5', 'totalUsageChange', 'chanceTotalUsageUp15', 'chanceTotalUsageDown15'],
  ['injuryMinutesShift'],
].flat() as (keyof RoleRow)[];

function fromPort(row: RoleRow): Row {
  const drivers = row.drivers
    .map((d) => `${d.playerId} ${d.status.toLowerCase()} ${d.minutes > 0 ? '+' : ''}${d.minutes}`)
    .join('; ');
  const values = PORT_COLUMNS.map((column) => row[column] as string | number);
  const { low, high } = row.minutesRange80;
  return [
    ...values.slice(0, 8),
    low,
    high,
    ...values.slice(8),
    drivers,
    row.biggerRoleGames,
    HEADS.map((head) => row.raw[head as keyof RoleRow['raw']]),
  ];
}

/** A head as the script stores it: coefficients keyed by feature name. */
interface ScriptHead {
  kind: string;
  base?: string;
  intercept: number;
  coef: Record<string, number>;
  test: Record<string, number>;
}

function loadScript(dir: string): vm.Context {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(join(dir, 'RoleModel.gs'), 'utf8'), context);
  return context;
}

/** `runRoleModelV3`'s core on the same rows: computeCoreV3_, its sort, its change columns. */
function fromScript(context: vm.Context, rows: RoleGameRow[], injuries: Map<string, RoleInjury>) {
  context.input = {
    rows: rows.map(({ playerId, team, ...row }) => ({
      ...row,
      name: playerId,
      team: TO_SCRIPT[team] ?? team,
    })),
    frac: Object.fromEntries(
      [...injuries].map(([playerId, { fracNext5 }]) => [playerId, fracNext5])
    ),
  };
  const out = JSON.parse(
    vm.runInContext(
      `JSON.stringify(computeCoreV3_(input.rows, input.frac, ROLE_MODEL)
        .sort(function (a, b) { return b[13] - a[13]; }))`,
      context
    )
  ) as unknown[][];
  return out.map((r): Row => {
    const at = (...indexes: number[]) => indexes.map((i) => r[i] as string | number);
    const n = (i: number) => r[i] as number;
    const [low, high] = String(r[7]).split('–').map(Number);
    const team = r[1] as string;
    return [
      r[0] as string,
      FROM_SCRIPT[team] ?? team,
      ...at(2, 3, 4, 5, 6),
      round1(n(6) - n(5)),
      low,
      high,
      ...at(8, 9, 10, 11, 12, 13),
      round1(n(13) - n(12)),
      ...at(14, 15, 16, 17, 18),
      HEADS.map((head) => (r[19] as { raw: Record<string, number> }).raw[head]),
    ];
  });
}

/** Displayed columns equal; the largest raw head difference, per head. */
function compare(actual: Row[], expected: Row[]) {
  expect(actual.map((row) => row.slice(0, -1))).toEqual(expected.map((row) => row.slice(0, -1)));
  return HEADS.map((head, h) =>
    Math.max(
      ...actual.map((row, i) =>
        Math.abs((row.at(-1) as number[])[h] - (expected[i].at(-1) as number[])[h])
      )
    )
  );
}

function league(options?: Parameters<typeof syntheticRoleLeague>[0]) {
  const { rows, injuries } = syntheticRoleLeague(options);
  return { rows: toRoleGameRows(rows), injuries };
}

describe('role model parity (Layer A)', () => {
  describe.skipIf(!GS_DIR)('against RoleModel.gs', () => {
    let loaded: vm.Context | undefined;
    const script = () => (loaded ??= loadScript(GS_DIR!));
    const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

    it('commits the script’s own output as the expectation', () => {
      const { rows, injuries } = league();
      const output = fromScript(script(), rows, injuries);
      if (process.env.ROLE_MODEL_WRITE_EXPECTED === '1') {
        writeFileSync(EXPECTED, `[\n${output.map((row) => JSON.stringify(row)).join(',\n')}\n]\n`);
      }
      const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as Row[];
      expect(compare(output, expected)).toEqual(HEADS.map(() => 0));
    });

    it('matches the script on a 30-team league', () => {
      const { rows, injuries } = league({
        seed: 11,
        teams: Object.keys(constants.COACH_TRAITS),
        days: 150,
      });
      const port = runRoleModel(rows, injuries).map(fromPort);
      const maxRaw = compare(port, fromScript(script(), rows, injuries));
      console.info(
        `Layer A: ${port.length} rows; max |raw Δ| ${HEADS.map((h, i) => `${h} ${maxRaw[i]}`).join(', ')}`
      );
      for (const difference of maxRaw) expect(difference).toBeLessThan(1e-9);
    });

    it('carries every fitted constant exactly', () => {
      const M = plain(vm.runInContext('ROLE_MODEL', script()));
      const inOrder = (coef: Record<string, number>, names: string[]) => names.map((f) => coef[f]);
      expect(constants.ROLE_FEATURES).toEqual(M.features);
      expect(constants.PDROP_FEATURES).toEqual(M.v1_features);
      expect(constants.PDROP_MODEL).toEqual({
        intercept: M.aux.pdrop.intercept,
        coef: inOrder(M.aux.pdrop.coef, M.v1_features),
      });
      for (const [name, m] of Object.entries<ScriptHead>(M.models)) {
        expect(constants.ROLE_HEADS[name as constants.RoleHeadName]).toEqual({
          kind: m.kind,
          ...(m.kind === 'delta_linear'
            ? { base: m.base, test: { mae: m.test.MAE, r2: m.test.R2 } }
            : { test: { auc: m.test.AUC, baseRate: m.test.base_rate } }),
          intercept: m.intercept,
          coef: inOrder(m.coef, M.features),
        });
      }
      expect(constants.MINUTES_BAND80).toEqual(M.models.y5_min.band80);
      expect(constants.WITH_WITHOUT_SHRINK).toBe(M.ww_shrink);
      expect(constants.COACH_TRAITS).toEqual(
        Object.fromEntries(
          Object.entries<Record<string, number>>(M.coach_traits).map(([team, c]) => [
            FROM_SCRIPT[team] ?? team,
            [
              c.coach,
              c.coach_vol,
              c.coach_depth,
              c.coach_expand,
              c.coach_swing,
              c.coach_prior_seasons,
            ],
          ])
        )
      );
      const S = plain(vm.runInContext('SIT_MODEL_', script()));
      expect(constants.SIT_MODEL).toEqual({
        intercept: S.intercept,
        coef: {
          b2b: S.coef.b2b,
          m: S.coef.m,
          mB2b: S.coef.m_b2b,
          hist: S.coef.hist,
          histB2b: S.coef.hist_b2b,
        },
        baseB2b: S.base_b2b,
        priorN: S.prior_n,
        mCentre: S.m_center,
        mScale: S.m_scale,
      });
      expect(constants.STAT_PROJ).toEqual(plain(vm.runInContext('STAT_PROJ_', script())));
      expect(constants.OPP_COEF).toEqual(plain(vm.runInContext('OPP_COEF_', script())));
      expect(constants.ROS_MODEL).toEqual(plain(vm.runInContext('ROS_MODEL_', script())));
      expect(constants.ROS_ABS).toEqual(plain(vm.runInContext('ROS_ABS_', script())));
    });
  });

  // After the block above, so a rewrite of the expectation is checked in the same run.
  it('reproduces the script’s output on the synthetic league', () => {
    const { rows, injuries } = league();
    const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as Row[];
    const maxRaw = compare(runRoleModel(rows, injuries).map(fromPort), expected);
    for (const difference of maxRaw) expect(difference).toBeLessThan(1e-9);
  });
});
