import { describe, expect, it } from 'vitest';

import { isDraftBoardStale } from '@/lib/draftBoardFreshness';

const POLL_MS = 5000;
const NOW = 1_000_000;

describe('isDraftBoardStale', () => {
  it('is fresh while the live socket is connected', () => {
    expect(isDraftBoardStale({ status: 'connected' }, NOW, POLL_MS)).toBe(false);
  });

  it('is stale while a resync is pending, even when connected', () => {
    expect(isDraftBoardStale({ status: 'connected', needsResync: true }, NOW, POLL_MS)).toBe(true);
  });

  it('is stale without the socket when the board was never read from the database', () => {
    expect(isDraftBoardStale({ status: 'disconnected' }, NOW, POLL_MS)).toBe(true);
  });

  it('is fresh without the socket while database reads keep arriving', () => {
    expect(
      isDraftBoardStale({ status: 'reconnecting', lastPersistedSyncAt: NOW - 10_000 }, NOW, POLL_MS)
    ).toBe(false);
  });

  it('goes stale once database reads stop for more than two poll intervals', () => {
    expect(
      isDraftBoardStale({ status: 'disconnected', lastPersistedSyncAt: NOW - 10_001 }, NOW, POLL_MS)
    ).toBe(true);
  });
});
