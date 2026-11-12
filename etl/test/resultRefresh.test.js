const assert = require('node:assert/strict');
const test = require('node:test');

const { dueResultRefresh } = require('../dist/resultRefresh');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const opts = { refreshMs: 10 * MIN, fullSweepMs: 6 * HOUR };

test('the first refresh is a full-season sweep outside a live window, a recent one inside', () => {
  const now = Date.now();
  const base = { now, lastRecentAt: 0, lastFullSweepAt: 0, ...opts };
  assert.equal(dueResultRefresh({ ...base, live: false }), 'full');
  assert.equal(dueResultRefresh({ ...base, live: true }), 'recent');
});

test('in a live window, the last matches are re-read every refresh interval and never swept', () => {
  const now = 10 * HOUR;
  const base = { now, live: true, lastFullSweepAt: 0, ...opts };
  assert.equal(dueResultRefresh({ ...base, lastRecentAt: now - 10 * MIN }), 'recent');
  assert.equal(dueResultRefresh({ ...base, lastRecentAt: now - 9 * MIN }), null);
});

test('outside a live window the whole season is swept every 6 hours (#1315)', () => {
  const now = 10 * HOUR;
  const base = { now, live: false, lastRecentAt: 0, ...opts };
  assert.equal(dueResultRefresh({ ...base, lastFullSweepAt: now - HOUR }), null);
  // An old-game correction is picked up once the sweep is due again.
  assert.equal(dueResultRefresh({ ...base, lastFullSweepAt: now - 6 * HOUR }), 'full');
});
