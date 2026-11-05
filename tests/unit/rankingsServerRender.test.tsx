import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  firebaseAdminIsDisabled: vi.fn(() => false),
  docs: [] as Array<{ id: string; data: () => Record<string, unknown> }>,
}));

vi.mock('@/lib/firebaseAdmin', () => {
  const query = {
    where: () => query,
    get: async () => ({ docs: mocks.docs }),
  };
  return {
    adminDb: { collection: () => query },
    firebaseAdminIsDisabled: mocks.firebaseAdminIsDisabled,
  };
});
vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

import { getCategoryRankings } from '@/server/rankings/getCategoryRankings';
import RankingsPage from '@/app/(app)/rankings/page';

function matchDoc(id: string, playerName: string, team: string, goals: number, tackles: number) {
  return { id, data: () => ({ player_name: playerName, team, goals, tackles }) };
}

describe('getCategoryRankings', () => {
  beforeEach(() => {
    mocks.firebaseAdminIsDisabled.mockReturnValue(false);
    mocks.docs = [
      matchDoc('a1', 'High Scorer', 'Geelong', 4, 2),
      matchDoc('a2', 'High Scorer', 'Geelong', 3, 3),
      matchDoc('b1', 'Low Scorer', 'Sydney', 0, 1),
    ];
  });

  it('aggregates match rows per player and ranks by overall z-score', async () => {
    const result = await getCategoryRankings({ season: 2025 });

    expect(result.players.map((p) => [p.playerName, p.games, p.rank])).toEqual([
      ['High Scorer', 2, 1],
      ['Low Scorer', 1, 2],
    ]);
    expect(result.meta.totalPlayers).toBe(2);
  });

  it('returns an empty ranking when Firebase Admin is disabled', async () => {
    mocks.firebaseAdminIsDisabled.mockReturnValue(true);

    const result = await getCategoryRankings({ season: 2025 });

    expect(result.players).toEqual([]);
    expect(result.meta.totalPlayers).toBe(0);
  });
});

describe('rankings page', () => {
  it('renders the ranked players in the first response', async () => {
    mocks.firebaseAdminIsDisabled.mockReturnValue(false);
    mocks.docs = [matchDoc('a1', 'High Scorer', 'Geelong', 4, 2)];

    render(await RankingsPage());

    expect(screen.getByRole('heading', { name: 'Player Rankings' })).toBeInTheDocument();
    expect(screen.getByText('High Scorer')).toBeInTheDocument();
  });
});
