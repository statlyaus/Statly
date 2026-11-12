const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAbandonedResult,
  buildMatchResults,
  completeResultRows,
  ingestResultRows,
  planResultWrites,
  resultContentHash,
} = require('../dist/resultIngest');
const { parseAbandonedArgs } = require('../dist/recordAbandonedResult');

// Rows as etl/fetch_fw_results.R emitted them for the last three Footywire matches of 2025
// (2025-11-11): Footywire's match pages call the Lions "Brisbane".
const PRELIM = {
  season: 2025,
  match_id: '11402',
  round_label: 'Preliminary Final',
  home_team: 'Geelong',
  away_team: 'Hawthorn',
  home_points: 115,
  away_points: 85,
  date: '2025-09-19',
  last_home_and_away_round: 24,
};
const GRAND_FINAL = {
  ...PRELIM,
  match_id: '11404',
  round_label: 'Grand Final',
  away_team: 'Brisbane',
  home_points: 75,
  away_points: 122,
  date: '2025-09-27',
};
const ROUND_ONE = {
  ...PRELIM,
  match_id: '11188',
  round_label: 'Round 1',
  home_team: 'Footscray',
  away_team: 'GWS',
  home_points: 80,
  away_points: 80,
};

// An in-memory AflMatchResult table with the migration's rules: one current row per match and a
// transaction that rolls back on any throw. A content hash may repeat across a match's history.
function memoryStore() {
  let rows = [];
  const store = {
    get rows() {
      return rows;
    },
    async transaction(season, work) {
      const draft = rows.map((row) => ({ ...row }));
      const tx = {
        async read(readSeason, matchIds) {
          return draft.filter(
            (row) =>
              row.season === readSeason &&
              matchIds.includes(row.matchId) &&
              row.supersededById === null
          );
        },
        async insert(id, result, fetchedAt) {
          if (
            draft.some(
              (row) =>
                row.season === result.season &&
                row.matchId === result.matchId &&
                row.supersededById === null
            )
          ) {
            throw new Error('one current result per match');
          }
          draft.push({ ...result, id, fetchedAt, supersededById: null, supersedeReason: null });
        },
        async markSuperseded(previousId, nextId, reason) {
          const row = draft.find((candidate) => candidate.id === previousId);
          if (!row || row.supersededById !== null) throw new Error('not current');
          row.supersededById = nextId;
          row.supersedeReason = reason;
        },
      };
      const value = await work(tx);
      rows = draft;
      return value;
    },
  };
  return store;
}

function sequentialIds() {
  let next = 0;
  return () => `result-${++next}`;
}

const FETCHED_AT = new Date('2025-09-28T00:00:00Z');

test('builds results keyed by Footywire match id, finals numbered on from the last round', () => {
  const [prelim, grandFinal, roundOne] = buildMatchResults([PRELIM, GRAND_FINAL, ROUND_ONE]);

  assert.deepEqual(
    { ...prelim, contentHash: undefined },
    {
      season: 2025,
      round: 27,
      matchId: '11402',
      matchUid: '2025-R27-GEE-HAW',
      homeClub: 'Geelong',
      awayClub: 'Hawthorn',
      homePoints: 115,
      awayPoints: 85,
      margin: 30,
      status: 'FINAL',
      contentHash: undefined,
    }
  );
  assert.equal(grandFinal.round, 28);
  assert.equal(grandFinal.awayClub, 'Brisbane Lions');
  assert.equal(grandFinal.matchUid, '2025-R28-GEE-BRL');
  assert.equal(grandFinal.margin, -47);
  assert.equal(roundOne.homeClub, 'Western Bulldogs');
  assert.equal(roundOne.margin, 0);
});

test('the content hash covers every stored result field and nothing else', () => {
  const [result] = buildMatchResults([PRELIM]);
  const { contentHash, ...fields } = result;
  assert.equal(resultContentHash(fields), contentHash);
  assert.match(contentHash, /^[0-9a-f]{64}$/);

  for (const changed of [{ homePoints: 116, margin: 31 }, { round: 26 }, { awayClub: 'Sydney' }]) {
    assert.notEqual(resultContentHash({ ...fields, ...changed }), contentHash);
  }
  const [refetched] = buildMatchResults([{ ...PRELIM, date: '2025-09-19' }]);
  assert.equal(refetched.contentHash, contentHash);
});

test('rejects the whole batch on any unreadable row', () => {
  const cases = [
    [[], /no match results/],
    [[PRELIM, { ...GRAND_FINAL, season: 2024 }], /more than one season/],
    [[{ ...PRELIM, match_id: 'abc' }], /match id/],
    [[PRELIM, { ...PRELIM }], /Duplicate Footywire match/],
    [[{ ...PRELIM, round_label: 'Wildcard Round' }], /Unknown Footywire round/],
    [[{ ...PRELIM, home_team: 'Tasmania Devils' }], /Unknown Footywire club/],
    [[{ ...PRELIM, away_team: 'Geelong' }], /one club twice/],
    [[{ ...PRELIM, home_points: null }], /Unreadable home score/],
    [[{ ...PRELIM, away_points: 12.5 }], /Unreadable away score/],
    [[{ ...PRELIM, last_home_and_away_round: null }], /last home-and-away round/],
    [[PRELIM, { ...PRELIM, match_id: '99999' }], /Duplicate result for 2025-R27-GEE-HAW/],
  ];
  for (const [rows, error] of cases) assert.throws(() => buildMatchResults(rows), error);
});

test('refuses output cut short before its end-of-results line', () => {
  assert.deepEqual(completeResultRows([PRELIM, { end_of_results: 1 }]), [PRELIM]);
  assert.throws(() => completeResultRows([PRELIM]), /end-of-results/);
  assert.throws(() => completeResultRows([]), /end-of-results/);
  assert.throws(() => completeResultRows([PRELIM, { end_of_results: 2 }]), /expected 2/);
});

test('a round ingests once; re-ingesting unchanged results writes nothing', async () => {
  const store = memoryStore();
  const deps = { store, fetchedAt: FETCHED_AT, newId: sequentialIds() };

  assert.deepEqual(await ingestResultRows([PRELIM, GRAND_FINAL], deps), {
    results: 2,
    inserted: 2,
    superseded: 0,
    unchanged: 0,
  });
  const before = JSON.stringify(store.rows);
  assert.deepEqual(await ingestResultRows([PRELIM, GRAND_FINAL], deps), {
    results: 2,
    inserted: 0,
    superseded: 0,
    unchanged: 2,
  });
  assert.equal(JSON.stringify(store.rows), before);
});

test('a changed score supersedes the stored row with a reason; history keeps both', async () => {
  const store = memoryStore();
  const deps = { store, fetchedAt: FETCHED_AT, newId: sequentialIds() };
  await ingestResultRows([PRELIM], deps);

  const summary = await ingestResultRows([{ ...PRELIM, away_points: 86 }], deps);

  assert.deepEqual(summary, { results: 1, inserted: 0, superseded: 1, unchanged: 0 });
  const [old, current] = store.rows;
  assert.equal(old.supersededById, current.id);
  assert.equal(
    old.supersedeReason,
    'Footywire result changed: Geelong 115 v Hawthorn 85 is now Geelong 115 v Hawthorn 86'
  );
  assert.equal(old.awayPoints, 85);
  assert.equal(current.awayPoints, 86);
  assert.equal(current.margin, 29);
  assert.equal(current.supersededById, null);
});

test('a result that goes A, B, A ends with three rows and A current (BR-24)', async () => {
  const store = memoryStore();
  const deps = { store, fetchedAt: FETCHED_AT, newId: sequentialIds() };
  await ingestResultRows([PRELIM], deps);
  await ingestResultRows([{ ...PRELIM, away_points: 86 }], deps);

  const summary = await ingestResultRows([PRELIM], deps);

  assert.deepEqual(summary, { results: 1, inserted: 0, superseded: 1, unchanged: 0 });
  const [first, second, third] = store.rows;
  assert.equal(store.rows.length, 3);
  assert.equal(first.supersededById, second.id);
  assert.equal(second.supersededById, third.id);
  assert.equal(third.supersededById, null);
  assert.equal(third.contentHash, first.contentHash);
  assert.equal(third.awayPoints, 85);
  assert.equal(
    second.supersedeReason,
    'Footywire result changed: Geelong 115 v Hawthorn 86 is now Geelong 115 v Hawthorn 85'
  );
});

test('planResultWrites supersedes the current row when a result returns to an earlier hash', () => {
  const [a] = buildMatchResults([PRELIM]);
  const [b] = buildMatchResults([{ ...PRELIM, away_points: 86 }]);
  const stored = [
    { ...a, id: 'a', supersededById: 'b' },
    { ...b, id: 'b', supersededById: null },
  ];

  const plan = planResultWrites([a], stored);

  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.supersedes.length, 1);
  assert.equal(plan.supersedes[0].previous.id, 'b');
  assert.equal(plan.supersedes[0].next.contentHash, a.contentHash);
});

test('planResultWrites refuses a match with two current rows', () => {
  const [result] = buildMatchResults([PRELIM]);
  const stored = { ...result, id: 'a', supersededById: null };
  assert.throws(
    () => planResultWrites([result], [stored, { ...stored, id: 'b' }]),
    /more than one current result/
  );
});

test('builds an operator-recorded ABANDONED result with no scores (#1315)', () => {
  const result = buildAbandonedResult({
    season: 2026,
    round: 5,
    homeTeam: 'Geelong',
    awayTeam: 'Greater Western Sydney',
  });
  assert.deepEqual(
    { ...result, contentHash: typeof result.contentHash },
    {
      season: 2026,
      round: 5,
      matchId: 'abandoned-2026-R5-GEE-GWS',
      matchUid: '2026-R5-GEE-GWS',
      homeClub: 'Geelong',
      awayClub: 'GWS',
      homePoints: null,
      awayPoints: null,
      margin: null,
      status: 'ABANDONED',
      contentHash: 'string',
    }
  );
  assert.equal(
    buildAbandonedResult({
      season: 2026,
      round: 5,
      homeTeam: 'Geelong',
      awayTeam: 'GWS',
      matchId: '11234',
    }).matchId,
    '11234'
  );
  assert.throws(
    () => buildAbandonedResult({ season: 2026, round: 0, homeTeam: 'Geelong', awayTeam: 'GWS' }),
    /Unreadable round/
  );
  assert.throws(
    () =>
      buildAbandonedResult({ season: 2026, round: 5, homeTeam: 'Geelong', awayTeam: 'Geelong' }),
    /two different clubs/
  );
  assert.throws(
    () => buildAbandonedResult({ season: 2026, round: 5, homeTeam: 'Geelong', awayTeam: 'Hobart' }),
    /Hobart/
  );
});

test('the record-abandoned command reads its flags and refuses anything else', () => {
  assert.deepEqual(
    parseAbandonedArgs([
      '--season',
      '2026',
      '--round',
      '5',
      '--home',
      'Geelong',
      '--away',
      'Hawthorn',
    ]),
    { season: 2026, round: 5, homeTeam: 'Geelong', awayTeam: 'Hawthorn' }
  );
  assert.deepEqual(
    parseAbandonedArgs([
      '--season',
      '2026',
      '--round',
      '5',
      '--home',
      'St Kilda',
      '--away',
      'Sydney',
      '--match-id',
      '11234',
    ]).matchId,
    '11234'
  );
  assert.throws(() => parseAbandonedArgs(['--season', '2026']), /--round is required/);
  assert.throws(
    () =>
      parseAbandonedArgs([
        '--season',
        '2026',
        '--round',
        '5',
        '--home',
        'A',
        '--away',
        'B',
        '--force',
        'y',
      ]),
    /Unknown flag --force/
  );
  assert.throws(() => parseAbandonedArgs(['--season']), /flag value/);
});
