const assert = require('node:assert/strict');
const test = require('node:test');

const { dueResultRefresh } = require('../dist/resultRefresh');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const opts = { refreshMs: 10 * MIN, fullSweepMs: 6 * HOUR };

test('the first refresh is a full-season sweep, live or not', () => {
  assert.equal(
    dueResultRefresh({
      now: Date.now(),
      live: false,
      lastRecentAt: 0,
      lastFullSweepAt: 0,
      ...opts,
    }),
    'full'
  );
  assert.equal(
    dueResultRefresh({ now: Date.now(), live: true, lastRecentAt: 0, lastFullSweepAt: 0, ...opts }),
    'full'
  );
});

test('in a live window, the last matches are re-read every refresh interval', () => {
  const now = 10 * HOUR;
  const base = { now, live: true, lastFullSweepAt: now - HOUR, ...opts };
  assert.equal(dueResultRefresh({ ...base, lastRecentAt: now - 10 * MIN }), 'recent');
  assert.equal(dueResultRefresh({ ...base, lastRecentAt: now - 9 * MIN }), null);
});

test('outside a live window only the full sweep runs (#1315)', () => {
  const now = 10 * HOUR;
  const base = { now, live: false, lastRecentAt: 0, ...opts };
  assert.equal(dueResultRefresh({ ...base, lastFullSweepAt: now - HOUR }), null);
  // An old-game correction is picked up once the sweep is due again.
  assert.equal(dueResultRefresh({ ...base, lastFullSweepAt: now - 6 * HOUR }), 'full');
});
