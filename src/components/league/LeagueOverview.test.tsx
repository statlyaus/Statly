import { render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { League, LeagueMember } from '@/types/leagues';

import LeagueOverview from './LeagueOverview';

const getLeagueOverviewMock = vi.fn();

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('framer-motion', () => ({
  motion: {
    section: ({ children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) => (
      <section {...props}>{children}</section>
    ),
  },
}));

vi.mock('@/lib/firebaseClient', () => ({
  getFirebaseDb: () => ({}),
}));

vi.mock('@/lib/data/leagueApi', () => ({
  getLeagueOverview: (...args: unknown[]) => getLeagueOverviewMock(...args),
}));

const league: League = {
  id: 'league-1',
  name: 'Statly Premier',
  code: 'STATLY26',
  type: 'private',
  ownerId: 'user-1',
  maxTeams: 10,
  categories: ['goals', 'kicks', 'marks'],
  tradeSettings: {
    tradeLimit: 10,
    tradeReview: 'none',
  },
  waiverWire: {
    waiverOrder: [],
    waiverPeriodHours: 24,
    waiverResetPolicy: 'weekly',
  },
  createdAt: '2026-03-01T00:00:00.000Z',
  status: 'active',
};

const members: LeagueMember[] = [
  {
    id: 'member-1',
    leagueId: 'league-1',
    userId: 'user-1',
    role: 'owner',
    teamName: 'Blue Heelers',
    joinedAt: '2026-03-01T00:00:00.000Z',
  },
  {
    id: 'member-2',
    leagueId: 'league-1',
    userId: 'user-2',
    role: 'member',
    teamName: 'Dockside FC',
    joinedAt: '2026-03-01T00:00:00.000Z',
  },
];

describe('LeagueOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          leagueId: 'league-1',
          season: 2026,
          currentWeek: 2,
          schedule: [
            {
              id: 'week-1',
              season: 2026,
              week: 1,
              aflRound: 1,
              roundLabel: 'Round 1',
              status: 'final',
              matchupCount: 5,
              current: false,
            },
            {
              id: 'week-2',
              season: 2026,
              week: 2,
              aflRound: 2,
              roundLabel: 'Round 2',
              status: 'in_progress',
              matchupCount: 5,
              current: true,
            },
            {
              id: 'week-3',
              season: 2026,
              week: 3,
              aflRound: 3,
              roundLabel: 'Round 3',
              status: 'scheduled',
              matchupCount: 5,
              current: false,
            },
          ],
          ladder: [
            {
              userId: 'user-2',
              teamName: 'Dockside FC',
              ladderRank: 1,
              record: { w: 2, l: 0, t: 0 },
              points: 11,
              categoriesWon: 11,
              categoriesLost: 7,
              categoriesTied: 0,
              scheduleWeek: 2,
              currentOpponentUserId: 'user-1',
              currentOpponentTeamName: 'Blue Heelers',
              isCurrentUser: false,
            },
            {
              userId: 'user-1',
              teamName: 'Blue Heelers',
              ladderRank: 2,
              record: { w: 1, l: 1, t: 0 },
              points: 8,
              categoriesWon: 8,
              categoriesLost: 10,
              categoriesTied: 0,
              scheduleWeek: 2,
              currentOpponentUserId: 'user-2',
              currentOpponentTeamName: 'Dockside FC',
              isCurrentUser: true,
            },
          ],
        },
      }),
    } as Response);

    getLeagueOverviewMock.mockResolvedValue({
      league: {
        id: 'league-1',
        name: 'Statly Premier',
        type: 'private',
        ownerId: 'user-1',
        maxTeams: 10,
        memberCount: 2,
        status: 'active',
        categories: ['goals', 'kicks', 'marks'],
        code: 'STATLY26',
        nextEvent: {
          label: 'Waivers',
          iso: '2026-03-24T09:00:00.000Z',
        },
      },
      membership: {
        userId: 'user-1',
        teamName: 'Blue Heelers',
        role: 'owner',
        joinedAt: '2026-03-01T00:00:00.000Z',
        teamId: 'user-1',
      },
      standingsTop: [],
      matchup: {
        roundLabel: 'Round 2',
        opponentTeam: {
          id: 'user-2',
          name: 'Dockside FC',
        },
        actual: 4.5,
        categoryLeads: [
          { key: 'goals', you: 6, opp: 4 },
          { key: 'kicks', you: 85, opp: 85 },
          { key: 'marks', you: 22, opp: 25 },
        ],
      },
      waiver: {
        nextRunIso: '2026-03-24T09:00:00.000Z',
        orderTop: [
          { teamId: 'user-2', teamName: 'Dockside FC' },
          { teamId: 'user-1', teamName: 'Blue Heelers' },
        ],
      },
      activity: [
        {
          id: 'activity-1',
          kind: 'trade',
          iso: '2026-03-22T09:00:00.000Z',
          text: 'Trade processed between Blue Heelers and Dockside FC',
        },
      ],
    });
  });

  it('renders a practical snapshot using season and live overview data', async () => {
    render(<LeagueOverview league={league} members={members} currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByText('Top of the table')).toBeInTheDocument();
    });

    expect(screen.getByText('League Snapshot')).toBeInTheDocument();
    expect(screen.getAllByText('Round 2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('#2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Blue Heelers').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dockside FC').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Trade processed between Blue Heelers and Dockside FC')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open ladder' })).toHaveAttribute(
      'href',
      '/leagues/league-1?tab=ladder'
    );
    expect(screen.queryByText('Get Started')).not.toBeInTheDocument();
  });
});
