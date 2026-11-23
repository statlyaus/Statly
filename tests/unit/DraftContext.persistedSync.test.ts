import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/SocketContext', () => ({
  useSocket: () => null,
  useSocketReconnectExhausted: () => false,
}));
vi.mock('@/lib/api', () => ({ fetchApi: vi.fn() }));

import { draftReducer, normalizeDraftSnapshot } from '@/contexts/DraftContext';

type DraftState = Parameters<typeof draftReducer>[0];

const NOW = Date.parse('2026-11-23T00:00:00.000Z');

function makeState(connection: Partial<DraftState['connection']>): DraftState {
  return {
    draft: null,
    participants: [],
    picks: [],
    availablePlayers: [],
    draftReadiness: null,
    selectedCategories: [],
    categoryDirections: {},
    statSeason: null,
    statSeasons: [],
    watchlistItems: [],
    pendingWatchlistPlayerIds: [],
    liveState: {},
    connection: { status: 'disconnected', ...connection },
    isLoading: false,
    isSaving: false,
    error: null,
    pickFeedback: null,
    startFeedback: null,
  };
}

const persistedStatePatch = (revision: number) => ({
  type: 'STATE_PATCH' as const,
  payload: { draft: { status: 'LIVE' }, liveState: {} },
  ts: NOW,
  revision,
});

describe('draft reducer persisted sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('applies a database snapshot to a v2 room whose socket dropped, clearing the resync', () => {
    const state = makeState({ status: 'reconnecting', protocol: 2, needsResync: true });
    const next = draftReducer(state, {
      type: 'SET_SNAPSHOT',
      snapshot: normalizeDraftSnapshot({ draft: null, participants: [], picks: [], ts: NOW }),
    });

    expect(next.connection.needsResync).toBe(false);
    expect(next.connection.lastPersistedSyncAt).toBe(NOW);
  });

  it('still ignores a database snapshot while the v2 socket is connected', () => {
    const state = makeState({ status: 'connected', protocol: 2 });
    const next = draftReducer(state, {
      type: 'SET_SNAPSHOT',
      snapshot: normalizeDraftSnapshot({ draft: null, participants: [], picks: [], ts: NOW }),
    });

    expect(next).toBe(state);
  });

  it('stamps the sync time when a persisted state patch is accepted', () => {
    const state = makeState({ status: 'disconnected', lastRevision: 4 });
    const next = draftReducer(state, {
      type: 'APPLY_DELTAS',
      deltas: [persistedStatePatch(4)],
      source: 'persisted',
    });

    expect(next.connection.lastPersistedSyncAt).toBe(NOW);
  });

  it('does not stamp the sync time for an older persisted state patch', () => {
    const state = makeState({ status: 'disconnected', lastRevision: 4 });
    const next = draftReducer(state, {
      type: 'APPLY_DELTAS',
      deltas: [persistedStatePatch(3)],
      source: 'persisted',
    });

    expect(next.connection.lastPersistedSyncAt).toBeUndefined();
  });

  it('does not stamp the sync time when a persisted patch leaves a resync pending', () => {
    const state = makeState({ status: 'disconnected', lastRevision: 4 });
    const next = draftReducer(state, {
      type: 'APPLY_DELTAS',
      deltas: [persistedStatePatch(9)],
      source: 'persisted',
    });

    expect(next.connection.needsResync).toBe(true);
    expect(next.connection.lastPersistedSyncAt).toBeUndefined();
  });

  it('does not stamp the sync time for socket deltas', () => {
    const state = makeState({ status: 'disconnected', lastRevision: 4 });
    const next = draftReducer(state, { type: 'APPLY_DELTAS', deltas: [persistedStatePatch(5)] });

    expect(next.connection.lastPersistedSyncAt).toBeUndefined();
  });
});

describe('draft snapshot auto-pick rule', () => {
  const serverNow = '2026-06-07T00:00:00.000Z';
  const canonical = (autoPickAllowed?: boolean) => ({
    schemaVersion: 1,
    draftId: 'draft-1',
    leagueId: 'league-1',
    revision: 3,
    throughSequence: 0,
    serverNow,
    state: {
      name: 'Draft',
      status: 'LIVE',
      currentPick: 1,
      totalPicks: 2,
      round: 1,
      direction: 'FORWARD',
      clock: {
        status: 'LIVE',
        revision: 3,
        durationSeconds: 120,
        serverNow,
        startedAt: serverNow,
        deadlineAt: '2026-06-07T00:02:00.000Z',
      },
      onClockMemberId: null,
      participants: [],
      ...(autoPickAllowed === undefined ? {} : { autoPickAllowed }),
      picks: [],
    },
  });

  it.each([
    ['a live snapshot', canonical(false)],
    [
      'the draft read',
      {
        draft: { id: 'draft-1', status: 'LIVE', currentPick: 1, autoPickAllowed: false },
        participants: [],
        picks: [],
      },
    ],
  ])("carries a league's auto-pick off from %s", (_source, raw) => {
    expect(normalizeDraftSnapshot(raw as never).draft?.settings.autoPickEnabled).toBe(false);
  });

  it('assumes auto-pick is on when an older snapshot leaves the rule out', () => {
    expect(normalizeDraftSnapshot(canonical() as never).draft?.settings.autoPickEnabled).toBe(true);
  });
});
