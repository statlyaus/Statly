import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { REQUIRED_CATEGORY_FIELDS } from '../../etl/normalizePlayerRow';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

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

import { getCategoryRankings, RANKING_ETL_KEY } from '@/server/rankings/getCategoryRankings';
import RankingsPage from '@/app/(app)/rankings/page';

type Doc = { id: string; data: () => Record<string, unknown> };

/** A player_match_stats document as etl/processFootywireData.ts writes it. */
function matchDoc(
  id: string,
  playerName: string,
  team: string,
  stats: Record<string, number | null> | undefined,
  extra: Record<string, unknown> = {}
): Doc {
  return {
    id,
    data: () => ({ player_name: playerName, team, ...(stats ? { stats } : {}), ...extra }),
  };
}

describe('getCategoryRankings', () => {
  beforeEach(() => {
    mocks.firebaseAdminIsDisabled.mockReturnValue(false);
    mocks.docs = [
      matchDoc('a1', 'High Scorer', 'Geelong', { goals: 4, tackles: 2 }),
      matchDoc('a2', 'High Scorer', 'Geelong', { goals: 3, tackles: 3 }),
      matchDoc('b1', 'Low Scorer', 'Sydney', { goals: 0, tackles: 1 }),
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

  it('ranks exactly the nine real-data league categories', async () => {
    const result = await getCategoryRankings({ season: 2025 });

    expect(Object.keys(result.players[0].categories)).toEqual([...REAL_DATA_NINE_CATEGORY_PRESET]);
    expect(Object.keys(result.meta.averages)).toEqual([...REAL_DATA_NINE_CATEGORY_PRESET]);
  });

  it('reads the ETL keys the ETL requires for the nine categories', () => {
    expect(Object.keys(RANKING_ETL_KEY)).toEqual([...REAL_DATA_NINE_CATEGORY_PRESET]);
    expect(Object.values(RANKING_ETL_KEY)).toEqual([...REQUIRED_CATEGORY_FIELDS]);
  });

  it('reads only stats.<etl key>: no top-level, raw_row or proxy value', async () => {
    mocks.docs = [
      matchDoc(
        'a1',
        'Only Possessions',
        'Geelong',
        { goals: 1, contested_possessions: 10, goal_assists: 3, clearances: 5 },
        { inside_50s: 6, raw_row: { tackles: 4, score_involvements: 7 } }
      ),
    ];

    const [player] = (await getCategoryRankings({ season: 2025 })).players;

    expect(player.categories.goals.perGame).toBe(1);
    expect(player.categories.contestedPossessions.perGame).toBe(10);
    expect(player.categories.inside50s).toEqual({ perGame: null, zScore: null });
    expect(player.categories.tackles).toEqual({ perGame: null, zScore: null });
    expect(player.categories.scoreInvolvements).toEqual({ perGame: null, zScore: null });
  });

  it('leaves an unreported stat missing and out of the league average', async () => {
    mocks.docs = [
      matchDoc('a1', 'Reported', 'Geelong', { tackles: 6 }),
      matchDoc('a2', 'Reported', 'Geelong', { tackles: 4 }),
      matchDoc('b1', 'Unreported', 'Sydney', { goals: 1, tackles: null }),
    ];

    const result = await getCategoryRankings({ season: 2025 });
    const unreported = result.players.find((p) => p.playerName === 'Unreported')!;
    const reported = result.players.find((p) => p.playerName === 'Reported')!;

    expect(unreported.categories.tackles).toEqual({ perGame: null, zScore: null });
    expect(result.meta.averages.tackles).toBe(5);
    expect(result.meta.averages.intercepts).toBeNull();
    expect(result.meta.stdDevs.intercepts).toBeNull();
    // A single reporter has no spread: z-score 0, not an invented one.
    expect(reported.categories.tackles.zScore).toBe(0);
  });

  it('shows the real per-game average, not the shrunk figure', async () => {
    mocks.docs = [
      matchDoc('a1', 'One Game', 'Geelong', { goals: 5 }),
      matchDoc('b1', 'Other', 'Sydney', { goals: 1 }),
      matchDoc('b2', 'Other', 'Sydney', { goals: 1 }),
    ];

    const result = await getCategoryRankings({ season: 2025 });

    expect(result.players.find((p) => p.playerName === 'One Game')!.categories.goals.perGame).toBe(
      5
    );
  });

  it('skips a document without a stats object and a player with no reported category', async () => {
    mocks.docs = [
      matchDoc('a1', 'Legacy', 'Geelong', undefined, { goals: 9, tackles: 9 }),
      matchDoc('a2', 'Half Legacy', 'Sydney', undefined, { goals: 9 }),
      matchDoc('a3', 'Half Legacy', 'Sydney', { goals: 2 }),
      matchDoc('a4', 'All Null', 'Carlton', { goals: null }),
    ];

    const result = await getCategoryRankings({ season: 2025 });

    expect(result.players.map((p) => [p.playerName, p.games])).toEqual([['Half Legacy', 1]]);
  });

  it('inverts the z-score of a LOW_WINS category', async () => {
    const high = await getCategoryRankings({ season: 2025 });
    const low = await getCategoryRankings({
      season: 2025,
      categoryDirections: { goals: 'LOW_WINS', tackles: 'LOW_WINS' },
    });

    const highZ = high.players.find((p) => p.playerName === 'High Scorer')!.categories.goals
      .zScore!;
    const lowZ = low.players.find((p) => p.playerName === 'High Scorer')!.categories.goals.zScore!;
    expect(highZ).toBeGreaterThan(0);
    expect(lowZ).toBeCloseTo(-highZ);
    expect(low.players.map((p) => p.playerName)).toEqual(['Low Scorer', 'High Scorer']);
  });

  it('sorts a player missing the category last in either direction', async () => {
    mocks.docs = [
      matchDoc('a1', 'Big', 'Geelong', { goals: 3, tackles: 1 }),
      matchDoc('b1', 'Small', 'Sydney', { goals: 1, tackles: 1 }),
      matchDoc('c1', 'Missing', 'Carlton', { tackles: 1 }),
    ];

    const desc = await getCategoryRankings({ season: 2025, sortBy: 'goals' });
    const asc = await getCategoryRankings({ season: 2025, sortBy: 'goals', sortDirection: 'asc' });

    expect(desc.players.map((p) => p.playerName)).toEqual(['Big', 'Small', 'Missing']);
    expect(asc.players.map((p) => p.playerName)).toEqual(['Small', 'Big', 'Missing']);
  });

  it('returns an empty ranking when Firebase Admin is disabled', async () => {
    mocks.firebaseAdminIsDisabled.mockReturnValue(true);

    const result = await getCategoryRankings({ season: 2025 });

    expect(result.players).toEqual([]);
    expect(result.meta.totalPlayers).toBe(0);
    expect(result.meta.averages.goals).toBeNull();
  });
});

describe('rankings page', () => {
  it('renders the ranked players in the first response', async () => {
    mocks.firebaseAdminIsDisabled.mockReturnValue(false);
    mocks.docs = [matchDoc('a1', 'High Scorer', 'Geelong', { goals: 4, tackles: 2 })];

    render(await RankingsPage());

    expect(screen.getByRole('heading', { name: 'Player Rankings' })).toBeInTheDocument();
    expect(screen.getByText('High Scorer')).toBeInTheDocument();
  });
});
