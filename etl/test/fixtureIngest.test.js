const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFixtureMatches,
  changedFixtureMatches,
  ingestFixtureRows,
} = require('../dist/fixtureIngest');

// Rows as etl/fetch_fw_fixture.R emits them. Footywire's fixture times are venue-local wall
// clock (fitzRoy labels them UTC); the expected UTC values below are the AFL feed's
// utcStartTime for the same 2025 games.
function row(overrides = {}) {
  return {
    season: 2025,
    season_game: 1,
    round_label: 'Round 1',
    home_team: 'Adelaide',
    away_team: 'St Kilda',
    venue: 'Adelaide Oval',
    local_start: '2025-03-16 12:05:00',
    completed_match_count: 0,
    ...overrides,
  };
}

const BEFORE_SEASON = new Date('2025-03-01T00:00:00Z');

test('converts Footywire venue-local start times to UTC', () => {
  const matches = buildFixtureMatches(
    [
      row(),
      row({
        season_game: 2,
        home_team: 'West Coast',
        away_team: 'Gold Coast',
        venue: 'Perth Stadium',
        local_start: '2025-03-16 15:10:00',
      }),
      row({
        season_game: 3,
        round_label: 'Round 2',
        home_team: 'Brisbane Lions',
        away_team: 'West Coast',
        venue: 'Gabba',
        local_start: '2025-03-23 12:10:00',
      }),
      row({
        season_game: 4,
        home_team: 'Richmond',
        away_team: 'Carlton',
        venue: 'M.C.G.',
        local_start: '2025-03-13 19:30:00',
      }),
    ],
    BEFORE_SEASON
  );

  assert.deepEqual(
    matches.map((match) => [match.match_uid, match.start_time_utc]),
    [
      ['2025-R1-ADE-STK', '2025-03-16T01:35:00.000Z'],
      ['2025-R1-WCE-GCS', '2025-03-16T07:10:00.000Z'],
      ['2025-R2-BRL-WCE', '2025-03-23T02:10:00.000Z'],
      ['2025-R1-RIC-CAR', '2025-03-13T08:30:00.000Z'],
    ]
  );
});

test('writes the match fields the server readers query', () => {
  const [match] = buildFixtureMatches([row()], BEFORE_SEASON);

  assert.equal(match.season, 2025);
  assert.equal(match.round_number, 1);
  assert.equal(match.round, 1);
  assert.equal(match.home_team, 'Adelaide');
  assert.equal(match.away_team, 'St Kilda');
  assert.equal(match.venue, 'Adelaide Oval');
  assert.equal(match.status, 'scheduled');
  assert.equal(match.data_source, 'footywire_fitzroy');
});

test('derives status from the clock and the Footywire completed-match count', () => {
  const rows = [
    row({
      season_game: 1,
      local_start: '2025-03-13 19:30:00',
      home_team: 'Richmond',
      away_team: 'Carlton',
      venue: 'M.C.G.',
    }),
    row({
      season_game: 2,
      local_start: '2025-03-14 19:40:00',
      home_team: 'Hawthorn',
      away_team: 'Essendon',
      venue: 'M.C.G.',
    }),
    row({ season_game: 3, local_start: '2025-03-16 12:05:00' }),
  ].map((fixtureRow) => ({ ...fixtureRow, completed_match_count: 1 }));

  // 2025-03-14 10:00 UTC: game 1 has stats on Footywire, game 2 started at 08:40 UTC, game 3 later.
  const statuses = buildFixtureMatches(rows, new Date('2025-03-14T10:00:00Z')).map(
    (match) => match.status
  );

  assert.deepEqual(statuses, ['final', 'in_progress', 'scheduled']);
});

test('orders completion by season game, not by row order', () => {
  const rows = [
    row({
      season_game: 2,
      local_start: '2025-03-14 19:40:00',
      home_team: 'Hawthorn',
      away_team: 'Essendon',
      venue: 'M.C.G.',
      completed_match_count: 1,
    }),
    row({
      season_game: 1,
      local_start: '2025-03-13 19:30:00',
      home_team: 'Richmond',
      away_team: 'Carlton',
      venue: 'M.C.G.',
      completed_match_count: 1,
    }),
  ];

  const byUid = Object.fromEntries(
    buildFixtureMatches(rows, new Date('2025-03-14T10:00:00Z')).map((match) => [
      match.match_uid,
      match.status,
    ])
  );

  assert.deepEqual(byUid, { '2025-R1-HAW-ESS': 'in_progress', '2025-R1-RIC-CAR': 'final' });
});

test('marks clubs absent from a numbered round as confirmed byes', () => {
  const clubs = [
    ['Adelaide', 'St Kilda'],
    ['West Coast', 'Gold Coast'],
    ['Richmond', 'Carlton'],
    ['Hawthorn', 'Essendon'],
    ['Geelong', 'Fremantle'],
    ['Sydney', 'Collingwood'],
    ['Melbourne', 'GWS'],
  ];
  const rows = clubs.map(([home, away], index) =>
    row({
      season_game: index + 1,
      home_team: home,
      away_team: away,
      venue: 'M.C.G.',
      local_start: '2025-03-15 13:00:00',
    })
  );

  const matches = buildFixtureMatches(rows, BEFORE_SEASON);

  for (const match of matches) {
    assert.deepEqual(match.confirmed_bye_teams, [
      'Brisbane Lions',
      'North Melbourne',
      'Port Adelaide',
      'Western Bulldogs',
    ]);
  }
});

test('leaves finals out because the stats ETL only numbers home-and-away rounds', () => {
  const matches = buildFixtureMatches(
    [
      row(),
      row({
        season_game: 2,
        round_label: 'Grand Final',
        home_team: 'Brisbane Lions',
        away_team: 'Geelong',
        venue: 'M.C.G.',
      }),
    ],
    BEFORE_SEASON
  );

  assert.deepEqual(
    matches.map((match) => match.match_uid),
    ['2025-R1-ADE-STK']
  );
});

test('keeps only the requested round when one is given', () => {
  const matches = buildFixtureMatches(
    [
      row(),
      row({
        season_game: 2,
        round_label: 'Round 2',
        home_team: 'Geelong',
        away_team: 'Carlton',
        venue: 'Kardinia Park',
      }),
    ],
    BEFORE_SEASON,
    { round: 2 }
  );

  assert.deepEqual(
    matches.map((match) => match.match_uid),
    ['2025-R2-GEE-CAR']
  );
});

test('fails closed on source rows it cannot place', () => {
  assert.throws(() => buildFixtureMatches([], BEFORE_SEASON), /no fixture rows/);
  assert.throws(
    () => buildFixtureMatches([row({ venue: 'Wellington Regional Stadium' })], BEFORE_SEASON),
    /Unknown Footywire venue "Wellington Regional Stadium"/
  );
  assert.throws(
    () => buildFixtureMatches([row({ home_team: 'Tasmania' })], BEFORE_SEASON),
    /Unknown Footywire club "Tasmania"/
  );
  assert.throws(
    () => buildFixtureMatches([row({ local_start: 'TBC' })], BEFORE_SEASON),
    /Unreadable Footywire start time "TBC"/
  );
  assert.throws(
    () =>
      buildFixtureMatches([row({ completed_match_count: 2 })], new Date('2025-03-20T00:00:00Z')),
    /reports 2 completed matches but the fixture has 1 started/
  );
  assert.throws(
    () => buildFixtureMatches([row(), row({ season_game: 2 })], BEFORE_SEASON),
    /Duplicate fixture match 2025-R1-ADE-STK/
  );
  assert.throws(
    () => buildFixtureMatches([row()], BEFORE_SEASON, { round: 5 }),
    /no fixture rows for round 5/
  );
});

test('only rewrites matches whose stored fields changed', () => {
  const [match] = buildFixtureMatches([row()], BEFORE_SEASON);
  const stored = new Map([[match.match_uid, { ...match, last_updated: 'earlier' }]]);

  assert.deepEqual(changedFixtureMatches([match], stored), []);
  assert.deepEqual(changedFixtureMatches([{ ...match, status: 'in_progress' }], stored), [
    { ...match, status: 'in_progress' },
  ]);
  assert.deepEqual(changedFixtureMatches([match], new Map()), [match]);
});

test('writes nothing when any source row is invalid', async () => {
  const writes = [];
  await assert.rejects(
    ingestFixtureRows([row(), row({ season_game: 2, venue: 'Nowhere' })], {
      now: BEFORE_SEASON,
      readStored: async () => new Map(),
      write: async (matches) => writes.push(...matches),
    }),
    /Unknown Footywire venue "Nowhere"/
  );
  assert.deepEqual(writes, []);
});

test('reports and writes only the changed matches of a valid fixture', async () => {
  const writes = [];
  const result = await ingestFixtureRows([row()], {
    now: BEFORE_SEASON,
    readStored: async (season) => {
      assert.equal(season, 2025);
      return new Map();
    },
    write: async (matches) => writes.push(...matches),
  });

  assert.deepEqual(result, { matches: 1, written: 1 });
  assert.deepEqual(
    writes.map((match) => match.match_uid),
    ['2025-R1-ADE-STK']
  );
});

test('fixture pipeline resolves its fetcher and processor beside the stats pipeline', () => {
  const path = require('node:path');
  const { resolveFixtureRuntimePaths } = require('../dist/fetchPipeline');
  const etlRoot = path.join(path.sep, 'workspace', 'etl');
  const expected = {
    etlRoot,
    fetcher: path.join(etlRoot, 'fetch_fw_fixture.R'),
    processor: path.join(etlRoot, 'dist', 'processFixtureData.js'),
  };

  assert.deepEqual(resolveFixtureRuntimePaths(etlRoot), expected);
  assert.deepEqual(resolveFixtureRuntimePaths(path.join(etlRoot, 'dist')), expected);
});
