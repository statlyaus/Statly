import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeagueTabs from '@/components/league/LeagueTabs';
import type { DraftOperationalReadiness } from '@/types/draftReadiness';
import type { League, LeagueMember } from '@/types/leagues';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());
const activeTabMock = vi.hoisted(() => ({ value: 'overview' }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-1',
  useRouter: () => ({
    push: vi.fn(),
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'tab' ? activeTabMock.value : null),
  }),
}));

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

vi.mock('@/components/league/DraftManager', () => ({
  default: () => null,
}));

const completedDraftReadiness: DraftOperationalReadiness = {
  leagueId: 'league-1',
  draftId: 'draft-1',
  status: 'completed',
  scheduledStartAt: '2025-08-31T11:26:00.000Z',
  roomOpenedAt: '2025-08-31T11:00:00.000Z',
  memberCount: 12,
  rosterSpots: 22,
  totalPicks: 264,
  playerPool: {
    availableCount: 0,
    hasPlayers: true,
  },
  lifecycle: {
    shouldBeOpen: false,
    canEnterRoom: false,
    canStartClock: false,
    isRunning: false,
    isComplete: true,
  },
  blockers: [
    {
      code: 'draft_completed',
      message: 'This draft has already been completed.',
    },
  ],
};

const completedLeague: League = {
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
  draftReadiness: completedDraftReadiness,
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

describe('LeagueTabs draft actions', () => {
  beforeEach(() => {
    activeTabMock.value = 'overview';
  });

  it('does not show prepare draft actions after the draft is completed', () => {
    render(<LeagueTabs league={completedLeague} members={members} />);

    expect(screen.queryByRole('button', { name: 'Prepare draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enter draft room' })).not.toBeInTheDocument();
    expect(screen.queryByText('Next action')).not.toBeInTheDocument();
  });

  it('renders repeated positional blockers without duplicate React keys', () => {
    activeTabMock.value = 'draft';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const league = {
      ...completedLeague,
      status: 'preseason' as const,
      draftReadiness: {
        ...completedDraftReadiness,
        status: 'blocked' as const,
        draftId: null,
        lifecycle: {
          ...completedDraftReadiness.lifecycle,
          isComplete: false,
        },
        blockers: [
          {
            id: 'insufficient_members',
            code: 'insufficient_members' as const,
            message: 'At least two league members are required to run a draft.',
          },
          {
            id: 'position_pool_shortage:DEF',
            code: 'position_pool_shortage' as const,
            message: 'DEF requires more available players.',
          },
          {
            id: 'position_pool_shortage:MID',
            code: 'position_pool_shortage' as const,
            message: 'MID requires more available players.',
          },
        ],
      },
    };

    render(<LeagueTabs league={league} members={members} />);

    expect(screen.getByText('DEF requires more available players.')).toBeInTheDocument();
    expect(screen.getByText('MID requires more available players.')).toBeInTheDocument();
    expect(
      consoleError.mock.calls.some((call) => String(call[0]).includes('same key'))
    ).toBe(false);
    consoleError.mockRestore();
  });
});
