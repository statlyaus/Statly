import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import LeagueTabs from '@/components/league/LeagueTabs';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';
import type { League, LeagueMember } from '@/types/leagues';

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-1',
  useRouter: () => ({
    push: vi.fn(),
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'tab' ? 'roster' : null),
  }),
}));

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
}));

const league: League = {
  id: 'league-1',
  name: 'Test AFL Champions League',
  code: 'ABC12345',
  type: 'private',
  ownerId: 'statly-dev-tester',
  maxTeams: 12,
  categories: [...REAL_DATA_NINE_CATEGORY_PRESET],
  tradeSettings: {
    tradeLimit: 10,
    tradeReview: 'none',
  },
  waiverWire: {
    waiverOrder: [],
    waiverPeriodHours: 24,
    waiverResetPolicy: 'weekly',
  },
  createdAt: '2026-06-01T00:00:00.000Z',
  status: 'completed',
};

const members: LeagueMember[] = [
  {
    id: 'member-1',
    leagueId: 'league-1',
    userId: 'statly-dev-tester',
    role: 'owner',
    teamName: 'Robbo Rockers',
    joinedAt: '2026-06-01T00:00:00.000Z',
    isActive: true,
  },
];

describe('LeagueTabs roster links', () => {
  it('opens the combined My Team tab for old ?tab=roster links', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    render(<LeagueTabs league={league} members={members} currentUserId="statly-dev-tester" />);

    expect(await screen.findByRole('heading', { level: 2, name: 'My team' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My Team' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'My Roster' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'My Lineup' })).not.toBeInTheDocument();
  });
});
