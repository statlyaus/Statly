import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import LeagueTabs from '@/components/league/LeagueTabs';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';
import type { League, LeagueMember } from '@/types/leagues';

const myTeamPanelSpy = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-1',
  useRouter: () => ({
    push: vi.fn(),
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'tab' ? 'roster' : null),
  }),
}));

vi.mock('@/components/MyTeamPanel', () => ({
  default: (props: {
    team?: { players?: Array<string | number> };
    players: Array<{ id: string }>;
    selectedCategories?: string[];
  }) => {
    myTeamPanelSpy(props);

    return (
      <section aria-label="Mock team panel">
        <span>Team players: {props.team?.players?.length ?? 0}</span>
        <span>Hydrated players: {props.players.length}</span>
      </section>
    );
  },
}));

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: vi.fn(),
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

describe('LeagueTabs roster tab', () => {
  it('passes completed draft roster players from the wrapped roster API response into MyTeamPanel', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          roster: {
            id: 'roster-1',
            leagueId: 'league-1',
            memberId: 'member-1',
            teamName: 'Robbo Rockers',
            players: [
              { id: 'player-1', name: 'Darcy Cameron', position: 'RUC', team: 'Collingwood' },
              { id: 'player-2', name: 'Jacob Wehr', position: 'MID', team: 'GWS' },
            ],
          },
          leagueSettings: {
            selectedCategories: [...REAL_DATA_NINE_CATEGORY_PRESET],
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LeagueTabs league={league} members={members} currentUserId="statly-dev-tester" />);

    await waitFor(() => {
      expect(screen.getByText('Team players: 2')).toBeInTheDocument();
    });

    expect(screen.getByText('Hydrated players: 2')).toBeInTheDocument();
    expect(myTeamPanelSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        team: expect.objectContaining({
          id: 'roster-1',
          name: 'Robbo Rockers',
          players: ['player-1', 'player-2'],
        }),
        players: expect.arrayContaining([
          expect.objectContaining({ id: 'player-1', name: 'Darcy Cameron' }),
          expect.objectContaining({ id: 'player-2', name: 'Jacob Wehr' }),
        ]),
        selectedCategories: [...REAL_DATA_NINE_CATEGORY_PRESET],
      })
    );
  });
});
