import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import LeagueTabs from '@/components/league/LeagueTabs';
import type { League, LeagueMember } from '@/types/leagues';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-1',
  useRouter: () => ({
    push: vi.fn(),
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'tab' ? 'overview' : null),
  }),
}));

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

const league: League = {
  id: 'league-1',
  name: 'Snapshot League',
  code: 'ABC12345',
  type: 'private',
  ownerId: 'user-1',
  maxTeams: 4,
  categories: ['goals', 'tackles', 'inside50s', 'intercepts', 'rebound50s'],
  tradeSettings: {
    tradeLimit: 10,
    tradeReview: 'none',
  },
  waiverWire: {
    waiverOrder: ['member-1', 'member-2'],
    waiverPeriodHours: 24,
    waiverResetPolicy: 'rolling',
  },
  createdAt: '2026-06-01T00:00:00.000Z',
  status: 'completed',
  waiverRule: 'rolling',
};

const members: LeagueMember[] = [
  {
    id: 'member-1',
    leagueId: 'league-1',
    userId: 'user-1',
    role: 'owner',
    teamName: 'First Team',
    joinedAt: '2026-06-01T00:00:00.000Z',
    isActive: true,
  },
  {
    id: 'member-2',
    leagueId: 'league-1',
    userId: 'user-2',
    role: 'member',
    teamName: 'Second Team',
    joinedAt: '2026-06-02T00:00:00.000Z',
    isActive: true,
  },
];

describe('LeagueTabs overview snapshot', () => {
  it('shows teams, waiver priority, pending trades, and league context at a glance', async () => {
    authenticatedFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        trades: [
          {
            tradeId: 'trade-1',
            summary: {
              tradeId: 'trade-1',
              tradeName: 'Midfield upgrade',
              status: 'PENDING',
              playerNames: ['Player A', 'Player B'],
              lastUpdated: 1000,
            },
          },
        ],
      }),
    });

    render(<LeagueTabs league={league} members={members} currentUserId="user-2" />);

    expect(screen.getByText('League overview')).toBeInTheDocument();
    expect(screen.getAllByText('Snapshot League').length).toBeGreaterThan(0);
    expect(screen.getByText('2/4 teams')).toBeInTheDocument();
    expect(screen.getByText('Trade offers')).toBeInTheDocument();
    expect(screen.getByText('5 categories')).toBeInTheDocument();
    expect(screen.getAllByText('Priority 2').length).toBeGreaterThan(0);
    expect(screen.getByText('Team preview')).toBeInTheDocument();
    expect(screen.getByText('First Team')).toBeInTheDocument();
    expect(screen.getAllByText('Second Team').length).toBeGreaterThan(0);
    expect(screen.getByText('Offers needing review')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Midfield upgrade')).toBeInTheDocument();
    });

    expect(screen.getByText('Player A, Player B')).toBeInTheDocument();
    expect(screen.getByText('Your claim position')).toBeInTheDocument();
    expect(screen.queryByText('Next action')).not.toBeInTheDocument();
    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/api/trades/list?leagueId=league-1&status=PENDING&pageSize=3',
      {},
      'user-2'
    );
  });
});
