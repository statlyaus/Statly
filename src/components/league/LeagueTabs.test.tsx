import { render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { League, LeagueMember } from '@/types/leagues';

import LeagueTabs from './LeagueTabs';

const listTradesMock = vi.fn();
let searchParamsMock = new URLSearchParams('tab=overview');

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-1',
  useSearchParams: () => searchParamsMock,
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  },
}));

vi.mock('@/components/league/LeagueOverview', () => ({
  default: () => <div>Overview panel</div>,
}));

vi.mock('@/components/league/LeagueMatchupTab', () => ({
  default: () => <div>Matchup panel</div>,
}));

vi.mock('@/components/league/LeagueSeasonTab', () => ({
  default: () => <div>Season panel</div>,
}));

vi.mock('@/components/league/LeagueWaiversTab', () => ({
  default: () => <div>Waivers panel</div>,
}));

vi.mock('@/components/league/DraftManager', () => ({
  default: () => <div>Draft panel</div>,
}));

vi.mock('@/components/trades/LeagueTradesClient', () => ({
  default: () => <div>Trades panel</div>,
}));

vi.mock('@/app/players/PlayersPageClient', () => ({
  default: () => <div>Players panel</div>,
}));

vi.mock('@/components/MyTeamPanel', () => ({
  default: () => <div>My team panel</div>,
}));

vi.mock('@/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
  }),
}));

vi.mock('@/lib/authBypass', () => ({
  isAuthBypassEnabled: () => false,
}));

vi.mock('@/components/trades/tradeApi', () => ({
  listTrades: (...args: unknown[]) => listTradesMock(...args),
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

describe('LeagueTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock = new URLSearchParams('tab=overview');
    listTradesMock.mockResolvedValue([
      { status: 'PROPOSED', recipientUserId: 'user-1' },
      { status: 'PROPOSED', recipientUserId: 'user-1' },
    ]);
  });

  it('shows the active tab context and renders mobile-safe tab links', async () => {
    render(<LeagueTabs league={league} members={members} currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByText('Overview panel')).toBeInTheDocument();
    });

    expect(screen.getAllByText('League workspace').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0);
    expect(screen.getByText('Recommended next')).toBeInTheDocument();
    expect(screen.getAllByText('Play').length).toBeGreaterThan(0);

    const overviewLinks = screen.getAllByRole('link', { name: 'Switch to Overview tab' });
    const tradesLinks = screen.getAllByRole('link', { name: 'Switch to Trades tab' });

    expect(
      overviewLinks.some(
        (link) =>
          link.getAttribute('aria-current') === 'page' &&
          link.getAttribute('href') === '/leagues/league-1?tab=overview'
      )
    ).toBe(true);
    expect(
      tradesLinks.some((link) => link.getAttribute('href') === '/leagues/league-1?tab=trades')
    ).toBe(true);

    await waitFor(() => {
      expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    });
  });
});
