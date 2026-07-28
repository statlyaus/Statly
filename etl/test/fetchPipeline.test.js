const assert = require('node:assert/strict');
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
    }
  );
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
