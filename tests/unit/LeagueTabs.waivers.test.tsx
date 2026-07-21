import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import LeagueTabs from '@/components/league/LeagueTabs';
import type { League, LeagueMember } from '@/types/leagues';

const routerPushSpy = vi.hoisted(() => vi.fn());
const waiverContainerSpy = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-1',
  useRouter: () => ({
    push: routerPushSpy,
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'tab' ? 'waivers' : null),
  }),
}));

vi.mock('@/components/waivers/LeagueWaiversContainer', () => ({
  default: (props: {
    leagueId: string;
    membersIndex?: Record<string, unknown>;
    selectedCategories?: string[];
  }) => {
    waiverContainerSpy(props);

    return <section aria-label="Embedded league waivers">League waivers embedded</section>;
  },
}));

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: vi.fn().mockResolvedValue({ ok: false }),
}));

const league: League = {
  id: 'league-1',
  name: 'Test AFL Champions League',
  code: 'ABC12345',
  type: 'private',
  ownerId: 'statly-dev-tester',
  maxTeams: 12,
  categories: ['goals', 'marks', 'tackles'],
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

describe('LeagueTabs waivers tab', () => {
  it('renders waiver management inside the league tab instead of linking out', async () => {
    render(<LeagueTabs league={league} members={members} currentUserId="statly-dev-tester" />);

    expect(screen.queryByRole('button', { name: 'Open waivers' })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Embedded league waivers' })).toBeInTheDocument();
    });
    expect(routerPushSpy).not.toHaveBeenCalledWith('/leagues/league-1/waivers');
    expect(waiverContainerSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        leagueId: 'league-1',
        selectedCategories: ['goals', 'marks', 'tackles'],
        membersIndex: {
          'statly-dev-tester': {
            userId: 'statly-dev-tester',
            teamId: 'member-1',
            teamName: 'Robbo Rockers',
          },
        },
      })
    );
  });
});
