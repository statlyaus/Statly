import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeaderboardPage from '@/app/(app)/leaderboard/page';
import PlayerAnalysisPage from '@/app/(app)/player-analysis/page';
import PlayerRankingsPage from '@/app/(app)/player-rankings/page';

const mocks = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
  leagues: [] as Array<{ id: string; name: string }>,
}));

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserIdFromServerContext: async () => mocks.userId,
}));

vi.mock('@/server/leagues/memberLeagueOptions', () => ({
  loadMemberLeagueOptions: async () => mocks.leagues,
}));

async function redirectTarget(render: () => unknown): Promise<string> {
  try {
    await render();
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  throw new Error('expected a redirect');
}

function leaderboard(league?: string) {
  return () => LeaderboardPage({ searchParams: Promise.resolve(league ? { league } : {}) });
}

describe('retired routes redirect on the server', () => {
  beforeEach(() => {
    mocks.userId = 'user-1';
    mocks.leagues = [
      { id: 'league-new', name: 'Newest' },
      { id: 'league-old', name: 'Oldest' },
    ];
  });

  it('sends /player-analysis to the players board', async () => {
    await expect(redirectTarget(() => PlayerAnalysisPage())).resolves.toBe('/players');
  });

  it('sends /player-rankings to the nine-category rankings', async () => {
    await expect(redirectTarget(() => PlayerRankingsPage())).resolves.toBe('/rankings');
  });

  it('sends /leaderboard?league= to that league standings tab when the viewer is a member', async () => {
    await expect(redirectTarget(leaderboard('league-old'))).resolves.toBe(
      '/leagues/league-old?tab=standings'
    );
  });

  it('falls back to the most recently joined league for a missing or foreign league id', async () => {
    await expect(redirectTarget(leaderboard())).resolves.toBe('/leagues/league-new?tab=standings');
    await expect(redirectTarget(leaderboard('someone-elses-league'))).resolves.toBe(
      '/leagues/league-new?tab=standings'
    );
  });

  it('sends a viewer with no league to the dashboard', async () => {
    mocks.leagues = [];
    await expect(redirectTarget(leaderboard())).resolves.toBe('/dashboard');
  });

  it('sends a signed-out viewer to login and back', async () => {
    mocks.userId = null;
    await expect(redirectTarget(leaderboard('league-old'))).resolves.toBe(
      '/login?callbackUrl=%2Fleaderboard'
    );
  });
});
