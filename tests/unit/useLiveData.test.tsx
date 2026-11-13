import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchApi: vi.fn() }));

vi.mock('@/lib/api', () => ({ fetchApi: mocks.fetchApi }));
// The Match Centre must never read Firestore from the browser: the rules refuse
// `player_match_stats`, which broke the page for every user.
vi.mock('firebase/firestore', () => ({
  collection: () => {
    throw new Error('useLiveData must not read Firestore from the browser');
  },
  getDocs: () => {
    throw new Error('useLiveData must not read Firestore from the browser');
  },
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}));
vi.mock('@/lib/firebase/clientFirestore', () => ({ db: {} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { useLiveData } from '@/hooks/useLiveData';

const match = {
  match_uid: 'm1',
  season: 2026,
  round_number: 7,
  home_team: 'Geelong',
  away_team: 'Brisbane Lions',
  start_time_utc: '2026-04-25T04:30:00.000Z',
  status: 'in_progress',
};
const stat = {
  match_uid: 'm1',
  player_uid: 'ply_a_player',
  player_name: 'A. Player',
  team: 'Geelong',
  season: 2026,
  round_number: 7,
  source: 'footywire_fitzroy',
  last_seen_at: '2026-04-25T05:10:00.000Z',
  stats: { goals: 2, marks: 3 },
};

describe('useLiveData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads live matches and stats from the server route', async () => {
    mocks.fetchApi.mockResolvedValue({
      data: { matches: [match], stats: [stat], lastUpdate: stat.last_seen_at },
    });

    const { result } = renderHook(() => useLiveData({ enablePolling: false }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.fetchApi).toHaveBeenCalledWith('matches/live', expect.anything());
    expect(result.current.error).toBeNull();
    expect(result.current.isLive).toBe(true);
    expect(result.current.lastUpdate).toBe(stat.last_seen_at);
    expect(result.current.liveMatches).toEqual([match]);
    expect(result.current.playerStats).toHaveLength(1);
    // The stored name, and no invented position.
    expect(result.current.playerStats[0]).toMatchObject({
      id: 'ply_a_player',
      name: 'A. Player',
      position: '',
      goals: 2,
      marks: 3,
    });
  });

  it('is not live, with no error, when no game is in progress', async () => {
    mocks.fetchApi.mockResolvedValue({ data: { matches: [], stats: [], lastUpdate: null } });

    const { result } = renderHook(() => useLiveData({ enablePolling: false }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.isLive).toBe(false);
    expect(result.current.playerStats).toEqual([]);
  });

  it('shows the error when the server read fails', async () => {
    mocks.fetchApi.mockRejectedValue(new Error('Internal server error'));

    const { result } = renderHook(() => useLiveData({ enablePolling: false }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('Internal server error');
  });
});
