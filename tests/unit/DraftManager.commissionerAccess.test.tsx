import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DraftManager from '@/components/league/DraftManager';
import type { League, LeagueMember } from '@/types/leagues';

const apiMocks = vi.hoisted(() => ({
  fetchApi: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  fetchApi: apiMocks.fetchApi,
}));

const league: League = {
  id: 'league-1',
  name: 'Friendly League',
  code: 'LEAGUE12',
  type: 'private',
  ownerId: 'owner-user',
  maxTeams: 12,
  categories: ['goals', 'tackles', 'inside50s'],
  tradeSettings: { tradeLimit: 10, tradeReview: 'none' },
  waiverWire: { waiverOrder: [], waiverPeriodHours: 24, waiverResetPolicy: 'weekly' },
  createdAt: '2026-06-01T00:00:00.000Z',
  status: 'preseason',
};

// The league detail read model passes Prisma's LeagueRole through unchanged: OWNER or MANAGER.
function buildMembers(overrides: Partial<LeagueMember>[] = []): LeagueMember[] {
  return Array.from({ length: 4 }, (_, index) => ({
    id: `member-${index + 1}`,
    leagueId: league.id,
    userId: index === 0 ? league.ownerId : `user-${index + 1}`,
    role: (index === 0 ? 'OWNER' : 'MANAGER') as unknown as LeagueMember['role'],
    teamName: `Team ${index + 1}`,
    joinedAt: `2026-06-0${index + 1}T00:00:00.000Z`,
    isActive: true,
    ...overrides[index],
  }));
}

async function renderFor(currentUserId: string, members = buildMembers()) {
  render(<DraftManager league={league} members={members} currentUserId={currentUserId} />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe('DraftManager commissioner access', () => {
  beforeEach(() => {
    apiMocks.fetchApi.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('offers setup to the league owner', async () => {
    await renderFor('owner-user');

    expect(screen.getByRole('button', { name: /Prepare draft settings/ })).toBeInTheDocument();
  });

  it('does not offer setup to an ordinary manager', async () => {
    await renderFor('user-2');

    expect(screen.queryByRole('button', { name: /Prepare draft settings/ })).toBeNull();
    expect(screen.getByText('Only a league commissioner can create a draft')).toBeInTheDocument();
  });

  it('does not treat a lowercase manager role as commissioner access', async () => {
    const members = buildMembers([{}, { role: 'manager' }]);
    await renderFor('user-2', members);

    expect(screen.queryByRole('button', { name: /Prepare draft settings/ })).toBeNull();
  });

  it('offers setup to a co-commissioner, as the server allows', async () => {
    const members = buildMembers([{}, { isCoCommissioner: true }]);
    await renderFor('user-2', members);

    expect(screen.getByRole('button', { name: /Prepare draft settings/ })).toBeInTheDocument();
  });
});
