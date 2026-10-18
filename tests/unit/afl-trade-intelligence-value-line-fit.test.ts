import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { storeLocalAflTradeEvidence } from '@/server/aflTradeIntelligence/development/localEvidenceStorage';
import {
  buildAflTradePlayerSeasonGames,
  type AflTradePlayerSeasonGamesRows,
} from '@/server/aflTradeIntelligence/modeling/playerSeasonGames';
import { hpnDpv3ValueForPick } from '@/server/aflTradeIntelligence/modeling/hpnPickValueBenchmark';
import {
  AFL_TRADE_VALUE_LINE_FIT_SCHEMA_VERSION,
  fitAflTradeValueLine,
  type AflTradeValueLineFitSelection,
} from '@/server/aflTradeIntelligence/modeling/valueLineFit';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { loadAflTradeValueLineFitInputs } from '@/server/aflTradeIntelligence/modeling/postgresValueLineFitInputs';

import {
  parseFitValueLineArguments,
  runFitValueLineCommand,
  storeValueLineFit,
} from '../../Scripts/fit-value-line';

vi.mock('@/server/aflTradeIntelligence/development/localEvidenceStorage', () => ({
  storeLocalAflTradeEvidence: vi.fn(async () => ({ custody: 'recorded' })),
}));

const LAST_SEASON = 2026;
const CLUBS = ['adelaide', 'brisbane', 'carlton', 'geelong'];

type Row = { season: number; playerId: string; clubId: string; games: number; pav: number };

/** A seeded linear congruential generator, so the fixture is the same on every run. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/**
 * Fourteen classes of 40 picks (2011-2024). An earlier pick plays more and better, and stays longer;
 * some picks never play, some move to another club, and each player's form is a fixed multiplier.
 */
function fixture() {
  const next = random(7);
  const selections: AflTradeValueLineFitSelection[] = [];
  const rows: Row[] = [];
  for (let year = 2011; year <= 2024; year++)
    for (let slot = 1; slot <= 40; slot++) {
      const playerId = `p-${year}-${slot}`;
      const clubId = CLUBS[(year + slot) % CLUBS.length]!;
      selections.push({
        selectionId: `s-${year}-${slot}`,
        draftYear: year,
        slot,
        clubId,
        playerId,
      });
      const quality = 1 / (1 + slot / 12);
      const form = 0.6 + 0.8 * next();
      if (next() < 0.12 + slot / 200) continue; // never plays
      for (let season = year + 1; season <= LAST_SEASON; season++) {
        const tenure = season - year;
        if (next() < 0.04 + (1 - quality) * 0.12) {
          // Moves on: plays the rest of this run for another club, or retires.
          if (next() < 0.5) {
            const other = CLUBS[(CLUBS.indexOf(clubId) + 1) % CLUBS.length]!;
            rows.push({ season, playerId, clubId: other, games: 10, pav: 4 });
          }
          break;
        }
        const games = Math.round(22 * quality * Math.min(1, tenure / 3) * (0.5 + next()));
        if (games > 0)
          rows.push({ season, playerId, clubId, games, pav: games * 0.6 * quality * form });
      }
    }
  return { selections, rows };
}

function model(rows: readonly Row[], seasons = range(2012, LAST_SEASON)) {
  const raw: AflTradePlayerSeasonGamesRows = {
    heads: seasons.map((season) => ({
      season_year: season,
      calculation_id: `hpn-pav-season:${season}`,
      status: 'finalized',
      finalized_at: '2026-10-01T00:00:00.000Z',
    })),
    players: rows.map((row, index) => ({
      season_year: row.season,
      spell_version_id: `acquisition-spell-version:${index}`,
      player_id: row.playerId,
      team_id: row.clubId,
      games_played: row.games,
      total_pav: row.pav,
    })),
    appearances: rows.map((row) => ({
      season_year: row.season,
      player_id: row.playerId,
      club_id: row.clubId,
      matches: row.games,
    })),
  };
  return buildAflTradePlayerSeasonGames(
    { methodId: `hpn-pav-method:${'b'.repeat(64)}`, seasons },
    raw
  );
}

function range(from: number, through: number) {
  return Array.from({ length: through - from + 1 }, (_, index) => from + index);
}

const { selections, rows } = fixture();
const fit = fitAflTradeValueLine({ selections, games: model(rows) });

describe('fitAflTradeValueLine', () => {
  it('publishes every parameter with its fit window', () => {
    const { content } = fit;
    expect(fit.fitId).toMatch(/^value-line-fit:[0-9a-f]{64}$/);
    expect(content.schemaVersion).toBe(AFL_TRADE_VALUE_LINE_FIT_SCHEMA_VERSION);
    expect(content.fitWindow.draftClasses).toEqual({ from: 2011, through: 2024 });
    expect(content.fitWindow.seasons).toHaveLength(15);
    expect(content.fitWindow.selectionsByClass[0]).toEqual({
      draftYear: 2011,
      selections: 40,
      observedSeasons: 15,
    });
    for (const curve of [
      content.parameters.survivalHazardLogit,
      content.parameters.gamesWhenInStintLog,
      content.parameters.pavPerGameLog,
    ]) {
      expect(curve.interceptsByTenure.map(({ tenure }) => tenure)).toEqual([
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        '10+',
      ]);
      expect(curve.lnSlotSlopes).toHaveLength(3);
    }
    expect(content.parameters.rateCredibilityGames).toBeGreaterThanOrEqual(0);
    expect(content.parameters.gamesCredibilitySeasons).toBeGreaterThanOrEqual(0);
  });

  it('fits a pick curve that falls with the slot, beside DPVC', () => {
    const curve = fit.content.pickCurve;
    expect(curve).toHaveLength(90);
    expect(curve[0]!.expectedFirstStintPav).toBeGreaterThan(curve[9]!.expectedFirstStintPav);
    expect(curve[9]!.expectedFirstStintPav).toBeGreaterThan(curve[39]!.expectedFirstStintPav);
    expect(curve[4]!.hpnDpvcV3).toBeCloseTo(hpnDpv3ValueForPick(5), 3);
    expect(curve[0]!.stillInStintAfterSeasons['3']).toBeGreaterThan(
      curve[0]!.stillInStintAfterSeasons['10']
    );
  });

  it('holds out each class with six observed seasons, at draft, year 1 and year 3', () => {
    const { backTest } = fit.content;
    expect(backTest.heldOutClasses).toEqual(range(2011, 2020));
    expect(backTest.matureClasses).toEqual(range(2011, 2014));
    expect(
      backTest.byRangeAndCheckpoint.map(({ range, checkpoint }) => `${checkpoint}:${range}`)
    ).toEqual(
      [0, 1, 3].flatMap((checkpoint) =>
        ['1-10', '11-30', '31+', 'all'].map((label) => `${checkpoint}:${label}`)
      )
    );
    const all = backTest.byRangeAndCheckpoint.find(
      ({ range, checkpoint }) => range === 'all' && checkpoint === 0
    )!;
    expect(all.selections).toBe(400);
    expect(all.bias).toBeCloseTo(all.meanPredicted - all.meanRealized, 2);
    const prior = backTest.priorAtDraft.allHeldOut.find(({ range }) => range === 'all')!;
    expect(prior.fittedFirstStintCurve.selections).toBe(prior.hpnDpvcV3.selections);
  });

  it('cuts stints on a move, a re-draft and three seasons without a game', () => {
    const cut = fitAflTradeValueLine({
      selections: [
        ...selections,
        // Drafted in 2012 by Adelaide, then again in 2015 by Brisbane.
        { selectionId: 'r1', draftYear: 2012, slot: 41, clubId: 'adelaide', playerId: 'redraft' },
        { selectionId: 'r2', draftYear: 2015, slot: 41, clubId: 'brisbane', playerId: 'redraft' },
        // Three empty seasons (2015-2017) close the stint; the 2018 return is not first-stint PAV.
        { selectionId: 'g1', draftYear: 2013, slot: 42, clubId: 'carlton', playerId: 'gap' },
      ],
      games: model([
        ...rows,
        { season: 2013, playerId: 'redraft', clubId: 'adelaide', games: 5, pav: 2 },
        { season: 2016, playerId: 'redraft', clubId: 'brisbane', games: 20, pav: 9 },
        { season: 2014, playerId: 'gap', clubId: 'carlton', games: 12, pav: 5 },
        { season: 2018, playerId: 'gap', clubId: 'carlton', games: 15, pav: 7 },
      ]),
    });
    const before = fit.content.stints;
    const after = cut.content.stints;
    expect(after.closedRedrafted).toBe(before.closedRedrafted + 1);
    expect(after.inactiveClosuresWithLaterGames).toBe(before.inactiveClosuresWithLaterGames + 1);
    expect(after.pavAfterInactiveClosure).toBeCloseTo(before.pavAfterInactiveClosure + 7, 3);
    // 2 (Adelaide), 9 (Brisbane, open), 5 (Carlton); the 2018 Carlton return is excluded.
    expect(after.firstStintPav).toBeCloseTo(before.firstStintPav + 16, 3);
  });

  it('uses only the held-out class seasons up to each checkpoint', () => {
    // A 2011 pick's 2016 season moves its realized PAV, never its value at draft, year 1 or year 3.
    const changed = rows.map((row) =>
      row.playerId === 'p-2011-3' && row.season === 2016 ? { ...row, pav: row.pav + 50 } : row
    );
    expect(changed).not.toEqual(rows);
    const refit = fitAflTradeValueLine({ selections, games: model(changed) });
    const before = fit.content.backTest.classes.find(({ draftYear }) => draftYear === 2011)!;
    const after = refit.content.backTest.classes.find(({ draftYear }) => draftYear === 2011)!;
    expect(after.realized).toBeCloseTo(before.realized + 50, 3);
    expect(after.fittedAtDraft).toBe(before.fittedAtDraft);
    expect(after.fittedAtYear1).toBe(before.fittedAtYear1);
    expect(after.fittedAtYear3).toBe(before.fittedAtYear3);
  });

  it('is deterministic and independent of input order', () => {
    const again = fitAflTradeValueLine({
      selections: [...selections].reverse(),
      games: model([...rows].reverse()),
    });
    expect(again.fitId).toBe(fit.fitId);
  });

  it('refuses inputs the specification excludes', () => {
    const games = model(rows);
    expect(() =>
      fitAflTradeValueLine({
        selections: [...selections, { ...selections[0]!, selectionId: 'x' }],
        games,
      })
    ).toThrow(/duplicated/);
    expect(() =>
      fitAflTradeValueLine({
        selections: [{ ...selections[0]!, draftYear: 2026 }],
        games,
      })
    ).toThrow(/no season observed after it/);
    expect(() =>
      fitAflTradeValueLine({
        selections,
        games: {
          ...games,
          discrepancies: [
            { playerId: 'p', season: 2020, clubId: 'c', games: 1, factualMatches: 2 },
          ],
        },
      })
    ).toThrow(/discrepancies/);
    expect(() =>
      fitAflTradeValueLine({
        selections,
        games: {
          ...games,
          seasons: games.seasons.map((season) =>
            season.season === 2015 ? { ...season, availability: 'no_head' as const } : season
          ),
        },
      })
    ).toThrow(/2015 are not available/);
    expect(() =>
      fitAflTradeValueLine({
        selections,
        games: model(
          rows.filter(({ season }) => season >= 2013),
          range(2013, 2026)
        ),
      })
    ).toThrow(/Read every season from 2012/);
  });
});

/** A client answering the selection read with `selectionRows` and the games read with one season. */
function fakeClient(selectionRows: readonly Record<string, unknown>[]) {
  const statements: { sql: string; parameters: unknown[] | undefined }[] = [];
  const query = async (sql: string, parameters?: unknown[]) => {
    statements.push({ sql, parameters });
    if (sql.includes('outcome_current_canonical_draft_selection_picks'))
      return { rows: selectionRows };
    if (sql.includes('outcome_hpn_pav_calculation_head'))
      return {
        rows: [
          {
            season_year: 2025,
            calculation_id: 'hpn-pav-season:2025',
            status: 'finalized',
            finalized_at: '2026-10-01T00:00:00.000Z',
          },
        ],
      };
    return { rows: [] };
  };
  const client = {
    query,
    transaction: async <T>(work: (transaction: { query: typeof query }) => Promise<T>) =>
      work({ query }),
  } as unknown as AflOutcomeSqlClient;
  return { client, statements };
}

describe('loadAflTradeValueLineFitInputs', () => {
  const options = { methodId: 'hpn-pav-method:m', draftYears: [2024], lastSeason: 2025 };
  const row = {
    selection_id: 's1',
    draft_year: 2024,
    selection_number: 3,
    club_id: 'carlton',
    player_id: 'p1',
  };

  it('reads current national selections of the classes, then the seasons after them', async () => {
    const { client, statements } = fakeClient([row]);
    const inputs = await loadAflTradeValueLineFitInputs(client, options);
    expect(inputs.selections).toEqual([
      { selectionId: 's1', draftYear: 2024, slot: 3, clubId: 'carlton', playerId: 'p1' },
    ]);
    expect(statements[0]!.sql).toBe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    expect(statements[1]!.sql).toMatch(
      /draft_type = 'national' AND draft_year BETWEEN \$1 AND \$2/
    );
    expect(statements[1]!.parameters).toEqual([2024, 2024]);
    expect(inputs.games.seasons).toEqual([
      { season: 2025, availability: 'available', calculationId: 'hpn-pav-season:2025' },
    ]);
  });

  it('refuses a selection with no player, a class with none, and a gap in the classes', async () => {
    await expect(
      loadAflTradeValueLineFitInputs(fakeClient([{ ...row, player_id: null }]).client, options)
    ).rejects.toThrow(/no canonical player/);
    await expect(loadAflTradeValueLineFitInputs(fakeClient([]).client, options)).rejects.toThrow(
      /No national draft selections for 2024/
    );
    await expect(
      loadAflTradeValueLineFitInputs(fakeClient([row]).client, {
        ...options,
        draftYears: [2022, 2024],
      })
    ).rejects.toThrow(/consecutive/);
  });
});

const loopback = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@127.0.0.1:55436/outcomes' };
const argv = (out: string) => [
  '--method',
  `hpn-pav-method:${'b'.repeat(64)}`,
  '--draft-years',
  '2011-2025',
  '--last-season',
  '2026',
  '--store-id',
  'statly-grading-1-artifacts',
  '--out',
  out,
];

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('fit-value-line', () => {
  it('parses the fit window and the store', () => {
    expect(parseFitValueLineArguments(argv('/receipts/fit.json'), loopback)).toMatchObject({
      draftYears: range(2011, 2025),
      lastSeason: 2026,
      storeId: 'statly-grading-1-artifacts',
      dryRun: false,
    });
    expect(() =>
      parseFitValueLineArguments(
        [
          '--method',
          'm',
          '--draft-years',
          '2011-2025',
          '--last-season',
          '2025,2026',
          '--dry-run',
          '--out',
          '/x.json',
        ],
        loopback
      )
    ).toThrow(/one season/);
    expect(() =>
      parseFitValueLineArguments(
        argv('/receipts/fit.json').slice(0, 6).concat('--out', '/x.json'),
        loopback
      )
    ).toThrow(/--store-id is required/);
  });

  it('stores the fit as private derived output in its own repository', async () => {
    const client = {} as AflOutcomeSqlClient;
    const bytes = new TextEncoder().encode('{"fitId":"x"}');
    await storeValueLineFit(client, 'statly-grading-1-artifacts', bytes);
    expect(storeLocalAflTradeEvidence).toHaveBeenCalledWith(client, {
      storeId: 'statly-grading-1-artifacts',
      repositoryId: 'value-line-fits',
      artifactClass: 'derived_private',
      bytes,
      mediaType: 'application/json',
      maximumObjectBytes: 8 * 1024 * 1024,
    });
  });

  it('refuses an existing --out before it opens the database', async () => {
    directory = await mkdtemp(join(tmpdir(), 'value-line-fit-'));
    const out = join(directory, 'fit.json');
    await writeFile(out, '{}');
    await expect(runFitValueLineCommand({ argv: argv(out), env: loopback })).rejects.toThrow(
      /a fit is never overwritten/
    );
  });

  it('takes the genuine database only on loopback', async () => {
    await expect(
      runFitValueLineCommand({
        argv: argv('/receipts/fit.json'),
        env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@10.0.0.5:5432/outcomes' },
      })
    ).rejects.toThrow(/loopback/);
  });
});
