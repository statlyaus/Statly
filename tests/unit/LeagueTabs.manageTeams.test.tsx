import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import LeagueTabs from '@/components/league/LeagueTabs';
import type { League, LeagueMember } from '@/types/leagues';

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  tab: 'teams',
}));

const authenticatedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-1',
  useRouter: () => ({
    push: navigationMocks.push,
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'tab' ? navigationMocks.tab : null),
  }),
}));

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

vi.mock('@/components/MyTeamPanel', () => ({
  default: () => <section aria-label="Mock team panel" />,
}));

const league: League = {
  id: 'league-1',
  name: 'Overfilled Fixture League',
  code: 'ABC12345',
  type: 'private',
  ownerId: 'owner-user',
  maxTeams: 12,
  categories: ['goals', 'tackles', 'inside50s'],
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
  status: 'preseason',
};

const ownerMember: LeagueMember = {
  id: 'owner-member',
  leagueId: 'league-1',
  userId: 'owner-user',
  role: 'owner',
  teamName: 'Owner Team',
  joinedAt: '2026-06-01T00:00:00.000Z',
  isActive: true,
};

const removableMember: LeagueMember = {
  id: 'removable-member',
  leagueId: 'league-1',
  userId: 'removable-user',
  role: 'member',
  teamName: 'Fixture Bot 11',
  joinedAt: '2026-06-02T00:00:00.000Z',
  isActive: true,
};

type LeagueTabsWithMemberChange = React.ComponentProps<typeof LeagueTabs> & {
  onMembersChange: (members: LeagueMember[]) => void;
};

describe('LeagueTabs manage teams tab', () => {
  it('lets a league owner remove a non-owner team from the teams tab', async () => {
    const onMembersChange = vi.fn();
    authenticatedFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          removedUserId: removableMember.userId,
          memberCount: 1,
        },
      }),
    });

    render(
      <LeagueTabs
        {...({
          league,
          members: [ownerMember, removableMember],
          currentUserId: ownerMember.userId,
          onMembersChange,
        } satisfies LeagueTabsWithMemberChange)}
      />
    );

    expect(screen.getByRole('heading', { name: 'League Teams' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Fixture Bot 11' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove Fixture Bot 11' }));

    await waitFor(() => {
      expect(authenticatedFetchMock).toHaveBeenCalledWith(
        '/api/leagues/league-1/members',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            action: 'removeMember',
            targetUserId: removableMember.userId,
          }),
        }),
        ownerMember.userId
      );
    });

    await waitFor(() => {
      expect(onMembersChange).toHaveBeenCalledWith([ownerMember]);
    });
    expect(screen.getByText('Fixture Bot 11 removed.')).toBeInTheDocument();
  });
});
