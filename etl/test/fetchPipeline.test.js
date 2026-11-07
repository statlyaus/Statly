const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const { resolveEtlRuntimePaths, resolveFetchPipelineTimeout } = require('../dist/fetchPipeline');
const { normalizePlayerRow } = require('../dist/normalizePlayerRow');

test('compiled ETL resolves the same assets from source and build directories', () => {
  const expected = {
    etlRoot: path.join(path.sep, 'workspace', 'etl'),
    fetcher: path.join(path.sep, 'workspace', 'etl', 'fetch_fw_round.R'),
    processor: path.join(path.sep, 'workspace', 'etl', 'dist', 'processFootywireData.js'),
  };

  assert.deepEqual(resolveEtlRuntimePaths(expected.etlRoot), expected);
  assert.deepEqual(resolveEtlRuntimePaths(path.join(expected.etlRoot, 'dist')), expected);
});

test('compiled ETL applies bounded live and unbounded backfill timeouts', () => {
  assert.equal(resolveFetchPipelineTimeout({ season: 2026 }), 300_000);
  assert.equal(resolveFetchPipelineTimeout({ season: 2026, backfillMode: true }), null);
  assert.equal(
    resolveFetchPipelineTimeout({ season: 2026, backfillMode: true, timeoutMs: 60_000 }),
    60_000
  );
  assert.equal(resolveFetchPipelineTimeout({ season: 2026, timeoutMs: 0 }), null);
});

test('compiled ETL rejects invalid timeout configuration before starting processes', () => {
  assert.throws(
    () => resolveFetchPipelineTimeout({ season: 2026, timeoutMs: -1 }),
    /non-negative finite number or null/
  );
  assert.throws(
    () => resolveFetchPipelineTimeout({ season: 2026, timeoutMs: Number.POSITIVE_INFINITY }),
    /non-negative finite number or null/
  );
});

test('compiled ETL normalizes required identity fields and supported numeric values', () => {
  const normalized = normalizePlayerRow({
    season: '2026',
    round: '7',
    team: 'Carlton',
    opposition: ' Richmond ',
    player_name: ' Test Player ',
    kicks: '14',
    disposals: '27',
    tog_pct: '81.5',
    goals: null,
    behinds: 0,
  });

  assert.deepEqual(
    {
      season: normalized.season,
      round: normalized.round,
      team: normalized.team,
      opposition: normalized.opposition,
      player_name: normalized.player_name,
      kicks: normalized.kicks,
      disposals: normalized.disposals,
      tog_pct: normalized.tog_pct,
      goals: normalized.goals,
      behinds: normalized.behinds,
    },
    {
      season: 2026,
      round: 7,
      team: 'Carlton',
      opposition: 'Richmond',
      player_name: 'Test Player',
      kicks: 14,
      disposals: 27,
      tog_pct: 81.5,
      goals: undefined,
      behinds: 0,
    }
  );
  assert.equal(Object.hasOwn(normalized, 'goals'), false);
  assert.equal(Object.hasOwn(normalized, 'behinds'), true);
});

test('compiled ETL rejects malformed player rows before persistence', () => {
  assert.throws(() => normalizePlayerRow(null), /Player row must be an object/);
  assert.throws(
    () => normalizePlayerRow({ season: '', round: 7, team: 'Carlton', player_name: 'Player' }),
    /season is required/
  );
  assert.throws(
    () =>
      normalizePlayerRow({
        season: 2026,
        round: 7,
        team: 'Carlton',
        player_name: 'Player',
        kicks: 'many',
      }),
    /kicks must be a finite number/
  );
});

const FETCHER = path.join(__dirname, '..', 'fetch_fw_round.R');
const FITZROY_FIXTURE = path.join(__dirname, 'fixtures', 'fitzroy-footywire-player-stats.csv');
const PRESET_STATS = [
  'goals',
  'tackles',
  'inside_50s',
  'intercepts',
  'contested_marks',
  'rebound_50s',
  'contested_possessions',
  'effective_disposals',
  'score_involvements',
];

// Sources the fetcher (which must not fetch when sourced) and maps rows recorded from fitzRoy's
// fetch_player_stats(source = "footywire"), with the column names exactly as fitzRoy returns them.
function exportFixtureRows({ round = 'NA_integer_', dropColumn } = {}) {
  const drop = dropColumn ? `fixture[[${JSON.stringify(dropColumn)}]] <- NULL;` : '';
  const expression = [
    `source(${JSON.stringify(FETCHER)});`,
    `fixture <- read.csv(${JSON.stringify(FITZROY_FIXTURE)}, check.names = FALSE, stringsAsFactors = FALSE);`,
    drop,
    `write.csv(footywire_export_rows(fixture, ${round}), stdout(), row.names = FALSE)`,
  ].join(' ');
  const result = spawnSync('Rscript', ['--vanilla', '-e', expression], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

function parseCsv(text) {
  const [header, ...lines] = text.trim().split('\n');
  const cells = (line) => line.split(',').map((cell) => cell.replace(/^"|"$/g, ''));
  const keys = cells(header);
  return lines.map((line) => Object.fromEntries(cells(line).map((value, i) => [keys[i], value])));
}

test('fetcher maps fitzRoy Footywire columns into rows the normalizer accepts', () => {
  const result = exportFixtureRows({ round: '5L' });
  assert.equal(result.status, 0, result.stderr);

  const rows = parseCsv(result.stdout).map(normalizePlayerRow);
  assert.deepEqual(
    rows.map((row) => [row.season, row.round, row.team, row.opposition, row.player_name]),
    [
      [2025, 5, 'Adelaide', 'Geelong', 'Matt Crouch'],
      [2025, 5, 'Adelaide', 'Geelong', 'Mitchell Hinge'],
    ]
  );
  for (const row of rows) {
    for (const stat of PRESET_STATS) {
      assert.equal(typeof row[stat], 'number', `${row.player_name} is missing ${stat}`);
    }
  }
  const [crouch] = rows;
  assert.deepEqual(
    Object.fromEntries(
      [...PRESET_STATS, 'kicks', 'handballs', 'disposals', 'tog_pct'].map((stat) => [
        stat,
        crouch[stat],
      ])
    ),
    {
      goals: 0,
      tackles: 2,
      inside_50s: 4,
      intercepts: 0,
      contested_marks: 0,
      rebound_50s: 0,
      contested_possessions: 14,
      effective_disposals: 20,
      score_involvements: 4,
      kicks: 10,
      handballs: 18,
      disposals: 28,
      tog_pct: 63,
    }
  );
});

test('fetcher without a requested round exports only the latest numbered round', () => {
  const result = exportFixtureRows();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    parseCsv(result.stdout).map((row) => [row.round, row.player_name]),
    [
      ['5', 'Matt Crouch'],
      ['5', 'Mitchell Hinge'],
    ]
  );
});

test('fetcher fails closed when fitzRoy drops a required column or the round has no rows', () => {
  const missing = exportFixtureRows({ round: '5L', dropColumn: 'ITC' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /missing required columns: ITC/);

  const empty = exportFixtureRows({ round: '7L' });
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /no rows for round 7/);
});
