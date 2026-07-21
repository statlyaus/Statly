import { render, screen, waitFor, within } from '@testing-library/react';
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
    teamLogoUrl: 'https://cdn.example.com/first-team.png',
    teamLogoPositionX: 20,
    teamLogoPositionY: 75,
    teamLogoZoom: 1.75,
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
  {
    id: 'member-3',
    leagueId: 'league-1',
    userId: 'user-3',
    role: 'member',
    teamName: 'Third Team',
    joinedAt: '2026-06-03T00:00:00.000Z',
    isActive: true,
  },
];

describe('LeagueTabs overview snapshot', () => {
  it('shows teams, waiver priority, pending trades, and league context at a glance', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        claims: [
          {
            id: 'claim-1',
            userId: 'user-2',
            teamId: 'member-2',
            playerId: 'player-1',
            priority: 1,
            status: 'PENDING',
            createdAt: '2026-07-04T00:00:00.000Z',
            bidAmount: 12,
          },
        ],
        playersIndex: {
          'player-1': {
            id: 'player-1',
            name: 'Caleb Serong',
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
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
    expect(screen.getByRole('heading', { level: 1, name: 'Snapshot League' })).toBeInTheDocument();
    expect(screen.getAllByText('Snapshot League').length).toBeGreaterThan(0);
    expect(screen.getByText(/3\/4 teams/)).toBeInTheDocument();
    expect(screen.getByText('Draft not started')).toBeInTheDocument();
    expect(screen.getAllByText('Trade offers').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Goals · Tackles · Inside 50s · Intercepts · Rebound 50s')
    ).toBeInTheDocument();
    expect(screen.getAllByText('Priority 2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Teams').length).toBeGreaterThan(1);
    expect(screen.getByText('4-team league')).toBeInTheDocument();
    expect(screen.queryByText('League table')).not.toBeInTheDocument();
    expect(screen.queryByText('Role')).not.toBeInTheDocument();
    expect(screen.queryByText('Status')).not.toBeInTheDocument();
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
    expect(screen.queryByText('Member')).not.toBeInTheDocument();

    const firstTeamSymbol = screen.getByRole('img', { name: 'First Team symbol' });
    expect(firstTeamSymbol).toHaveAttribute('src', 'https://cdn.example.com/first-team.png');
    expect(firstTeamSymbol).toHaveStyle({
      objectPosition: '20% 75%',
      transform: 'scale(1.75)',
      transformOrigin: '20% 75%',
    });
    expect(screen.getAllByText('Second Team').length).toBeGreaterThan(0);
    expect(screen.getByText('ST')).toBeInTheDocument();
    expect(screen.getByText('Third Team')).toBeInTheDocument();
    expect(screen.getByText('TT')).toBeInTheDocument();
    const currentTeamCard = within(screen.getByRole('list', { name: 'League teams' }))
      .getByText('Second Team')
      .closest('li');
    expect(currentTeamCard).not.toBeNull();
    expect(within(currentTeamCard as HTMLElement).getByText('Your team')).toBeInTheDocument();
    expect(screen.queryByText('Offers needing review')).not.toBeInTheDocument();
    expect(screen.getByText('4-team league').closest('section')).toHaveClass(
      'bg-[color:var(--league-surface)]'
    );

    await waitFor(() => {
      expect(screen.getByText('Midfield upgrade')).toBeInTheDocument();
    });

    expect(screen.getByText('Player A, Player B')).toBeInTheDocument();
    expect(screen.getAllByText('Waiver position').length).toBeGreaterThan(0);
    expect(screen.queryByText('Your claim position')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Caleb Serong')).toBeInTheDocument();
    });
    expect(screen.getByText('$12')).toBeInTheDocument();
    expect(screen.queryByText('Next action')).not.toBeInTheDocument();
    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/api/trades/list?leagueId=league-1&status=PENDING&pageSize=3',
      {},
      'user-2'
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/leagues/league-1/waivers?playersLimit=0&activityLimit=0',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    const leagueNavigation = screen.getByRole('navigation', { name: 'League sections' });
    expect(within(leagueNavigation).getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('presents room-open, commissioner, and unassigned waiver states without raw or repeated copy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ claims: [], playersIndex: {} }),
      })
    );
    authenticatedFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ trades: [] }),
    });

    const roomOpenLeague: League = {
      ...league,
      waiverWire: {
        ...league.waiverWire,
        waiverOrder: [],
      },
      draftReadiness: {
        leagueId: league.id,
        draftId: 'draft-1',
        status: 'room_open',
        scheduledStartAt: null,
        roomOpenedAt: '2026-07-21T10:00:00.000Z',
        memberCount: members.length,
        rosterSpots: 22,
        totalPicks: 66,
        playerPool: {
          availableCount: 800,
          hasPlayers: true,
        },
        lifecycle: {
          shouldBeOpen: true,
          canEnterRoom: true,
          canStartClock: true,
          isRunning: false,
          isComplete: false,
        },
        blockers: [],
      },
    };

    render(<LeagueTabs league={roomOpenLeague} members={members} currentUserId="user-1" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Snapshot League' })).toBeInTheDocument();
    expect(screen.getByText('Draft room open')).toBeInTheDocument();
    expect(screen.queryByText(/room_open/)).not.toBeInTheDocument();
    expect(screen.getByText('Commissioner')).toBeInTheDocument();
    expect(screen.queryByText('Commissioner access')).not.toBeInTheDocument();
    expect(screen.queryByText('Member access')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not set')).toHaveLength(1);
    expect(screen.getByText('Waiver order pending')).toBeInTheDocument();
    expect(
      await screen.findByText('Your position will appear when the order is set.')
    ).toBeInTheDocument();

    for (const name of ['Scoring categories', 'Teams', 'Trade offers', 'Waiver position']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }

    expect(authenticatedFetchMock).toHaveBeenCalled();
  });
});
