const assert = require('node:assert/strict');
const test = require('node:test');

const expectedExports = [
  'backfillOwnershipPercent',
  'onPlayerOwnershipWrite',
  'onTeamRosterUpdate',
  'onTradeUpdate',
  'onUserWatchlistUpdate',
  'processWaivers',
  'reconcilePendingBidTotals',
];

test('compiled Functions entry point exposes every deployed handler', () => {
  process.env.GCLOUD_PROJECT ??= 'statly-functions-test';
  process.env.FIREBASE_CONFIG ??= JSON.stringify({ projectId: 'statly-functions-test' });

  const functions = require('../lib');

  assert.deepEqual(Object.keys(functions).sort(), expectedExports);
  for (const exportName of expectedExports) {
    assert.equal(typeof functions[exportName], 'function', `${exportName} should be callable`);
  }
});
