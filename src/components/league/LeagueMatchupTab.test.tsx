import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LeagueMatchupTab from './LeagueMatchupTab';

const payload = {
  success: true,
  data: {
    leagueId: 'league-1',
    leagueName: 'Example League',
    season: 2026,
    round: 1,
    roundLabel: 'Round 1',
    status: 'final',
    live: false,
    lastUpdated: '2026-03-14T00:11:00.000Z',
    completedTeams: [],
    home: {
      userId: 'user-1',
      memberId: 'member-1',
      teamName: 'Robbo Rockers',
      starters: [
        {
          id: 'ply-1',
          name: 'Player One',
          team: 'AAA',
          position: 'MID',
          stats: {
            goals: 1,
            kicks: 15,
            handballs: 10,
            marks: 4,
            tackles: 6,
            inside50s: 3,
          },
        },
        {
          id: 'ply-3',
          name: 'Player Pending',
          team: 'CCC',
          position: 'DEF',
          stats: {},
        },
      ],
      summary: { wins: 2, losses: 3, ties: 1 },
    },
    away: {
      userId: 'user-2',
      memberId: 'member-2',
      teamName: 'Opponent',
      starters: [
        {
          id: 'ply-2',
          name: 'Player Two',
          team: 'BBB',
          position: 'MID',
          stats: {
            goals: 2,
            kicks: 12,
            handballs: 7,
            marks: 5,
            tackles: 3,
            inside50s: 1,
          },
        },
      ],
      summary: { wins: 3, losses: 2, ties: 1 },
    },
    categories: [
      { key: 'goals', label: 'Goals', home: 1, away: 2, winner: 'away' },
      { key: 'kicks', label: 'Kicks', home: 15, away: 12, winner: 'home' },
      { key: 'handballs', label: 'Handballs', home: 10, away: 7, winner: 'home' },
      { key: 'marks', label: 'Marks', home: 4, away: 5, winner: 'away' },
      { key: 'tackles', label: 'Tackles', home: 6, away: 3, winner: 'home' },
      { key: 'inside50s', label: 'Inside 50s', home: 3, away: 1, winner: 'home' },
    ],
    otherMatchups: [
      {
        matchupId: 'matchup-2',
        homeTeamName: 'Third Team',
        awayTeamName: 'Fourth Team',
        homeScore: 4,
        awayScore: 2,
        leaderText: 'Third Team leads 4-2',
        isSelected: false,
      },
    ],
  },
};

let searchParamsMock = new URLSearchParams('tab=matchup');
const eventSourceInstances: MockEventSource[] = [];

class MockEventSource {
  public onmessage: ((event: MessageEvent<string>) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public readyState = 1;
  public url: string;
  private listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();

  constructor(url: string) {
    this.url = url;
    eventSourceInstances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    const existing = this.listeners.get(type) ?? new Set();
    existing.add(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent<string>;
    this.listeners.get(type)?.forEach((listener) => listener(event));
    if (type === 'message') {
      this.onmessage?.(event);
    }
  }

  close() {
    this.readyState = 2;
  }
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-1',
  useSearchParams: () => searchParamsMock,
}));

describe('LeagueMatchupTab', () => {
  beforeEach(() => {
    eventSourceInstances.length = 0;
    searchParamsMock = new URLSearchParams('tab=matchup');
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows completed status text for final matchups', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });
  });

  it('shows played and remaining player counts for both teams', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Player One')).toBeInTheDocument();
    });

    expect(screen.getAllByText('1 played • 1 remaining').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 played • 0 remaining').length).toBeGreaterThan(0);
  });

  it('requests the selected historical round when round is present in the URL', async () => {
    searchParamsMock = new URLSearchParams('tab=matchup&round=1');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    expect(
      fetchSpy.mock.calls.some(
        ([url]) =>
          typeof url === 'string' &&
          url.includes('/api/leagues/league-1/matchup?') &&
          url.includes('round=1')
      )
    ).toBe(true);
  });

  it('polls every 30 seconds while a matchup is live', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ...payload,
        data: {
          ...payload.data,
          status: 'in_progress',
          live: true,
        },
      }),
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('In play')).toBeInTheDocument();
    });

    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 30000)).toBe(true);
  });

  it('opens a matchup stream while the matchup is live', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ...payload,
        data: {
          ...payload.data,
          status: 'in_progress',
          live: true,
        },
      }),
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('In play')).toBeInTheDocument();
    });

    expect(eventSourceInstances).toHaveLength(1);
    expect(eventSourceInstances[0]?.url).toContain('/api/leagues/league-1/matchup/stream?');
  });

  it('shows a numeric change indicator when a live update changes category values', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ...payload,
        data: {
          ...payload.data,
          status: 'in_progress',
          live: true,
        },
      }),
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('In play')).toBeInTheDocument();
    });

    act(() => {
      eventSourceInstances[0]?.emit('matchup', {
        ...payload.data,
        status: 'in_progress',
        live: true,
        lastUpdated: '2026-03-14T00:12:00.000Z',
        categories: payload.data.categories.map((category) =>
          category.key === 'goals' ? { ...category, home: 2, away: 2, winner: 'tie' } : category
        ),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Live update')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Goals home changed by +1')).toBeInTheDocument();
  });

  it('animates the category card when a lead changes to a tie', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ...payload,
        data: {
          ...payload.data,
          status: 'in_progress',
          live: true,
        },
      }),
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(eventSourceInstances).toHaveLength(1);
    });

    act(() => {
      eventSourceInstances[0]?.emit('matchup', {
        ...payload.data,
        status: 'in_progress',
        live: true,
        lastUpdated: '2026-03-15T00:12:00.000Z',
        categories: payload.data.categories.map((category) =>
          category.key === 'goals' ? { ...category, home: 2, away: 2, winner: 'tie' } : category
        ),
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('category-card-goals')).toHaveClass('animate-pulse');
    });
  });

  it('shows category swing labels in the summary cards', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('Opponent leads by 1').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('Robbo Rockers leads by 3').length).toBeGreaterThan(0);
  });

  it('shows per-player stat deltas when a live update changes a player row', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ...payload,
        data: {
          ...payload.data,
          status: 'in_progress',
          live: true,
        },
      }),
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Player One')).toBeInTheDocument();
    });

    act(() => {
      eventSourceInstances[0]?.emit('matchup', {
        ...payload.data,
        status: 'in_progress',
        live: true,
        lastUpdated: '2026-03-14T00:12:00.000Z',
        home: {
          ...payload.data.home,
          starters: payload.data.home.starters.map((player) =>
            player.id === 'ply-1'
              ? {
                  ...player,
                  stats: {
                    ...player.stats,
                    kicks: 17,
                  },
                }
              : player
          ),
        },
        categories: payload.data.categories.map((category) =>
          category.key === 'kicks' ? { ...category, home: 17, away: 12, winner: 'home' } : category
        ),
      });
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Player One kicks changed by +2')).toBeInTheDocument();
    });
  });

  it('shows a recent scoring events rail after a live update', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ...payload,
        data: {
          ...payload.data,
          status: 'in_progress',
          live: true,
        },
      }),
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('In play')).toBeInTheDocument();
    });

    act(() => {
      eventSourceInstances[0]?.emit('matchup', {
        ...payload.data,
        status: 'in_progress',
        live: true,
        lastUpdated: '2026-03-14T00:12:00.000Z',
        home: {
          ...payload.data.home,
          starters: payload.data.home.starters.map((player) =>
            player.id === 'ply-1'
              ? {
                  ...player,
                  stats: {
                    ...player.stats,
                    goals: 2,
                    kicks: 17,
                  },
                }
              : player
          ),
        },
        categories: payload.data.categories.map((category) => {
          if (category.key === 'goals') {
            return { ...category, home: 2, away: 2, winner: 'tie' };
          }
          if (category.key === 'kicks') {
            return { ...category, home: 17, away: 12, winner: 'home' };
          }
          return category;
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Recent scoring events')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Player One').length).toBeGreaterThan(1);
    expect(screen.getByText('Goals +1')).toBeInTheDocument();
    expect(screen.getByText('Kicks +2')).toBeInTheDocument();
  });

  it('filters recent scoring events to the league scoring categories only', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ...payload,
        data: {
          ...payload.data,
          status: 'in_progress',
          live: true,
        },
      }),
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('In play')).toBeInTheDocument();
    });

    act(() => {
      eventSourceInstances[0]?.emit('matchup', {
        ...payload.data,
        status: 'in_progress',
        live: true,
        lastUpdated: '2026-03-14T00:12:00.000Z',
        home: {
          ...payload.data.home,
          starters: payload.data.home.starters.map((player) =>
            player.id === 'ply-1'
              ? {
                  ...player,
                  stats: {
                    ...player.stats,
                    clangers: 2,
                  },
                }
              : player
          ),
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText('Recent scoring events')).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/Clangers/i)).not.toBeInTheDocument();
  });

  it('deduplicates recent scoring events for duplicate player-category deltas', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ...payload,
        data: {
          ...payload.data,
          status: 'in_progress',
          live: true,
        },
      }),
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('In play')).toBeInTheDocument();
    });

    act(() => {
      eventSourceInstances[0]?.emit('matchup', {
        ...payload.data,
        status: 'in_progress',
        live: true,
        lastUpdated: '2026-03-15T00:12:00.000Z',
        home: {
          ...payload.data.home,
          starters: [
            {
              ...payload.data.home.starters[0],
              stats: {
                ...payload.data.home.starters[0]?.stats,
                kicks: 17,
              },
            },
            {
              ...payload.data.home.starters[0],
              stats: {
                ...payload.data.home.starters[0]?.stats,
                kicks: 17,
              },
            },
          ],
        },
        categories: payload.data.categories.map((category) =>
          category.key === 'kicks' ? { ...category, home: 17, away: 12, winner: 'home' } : category
        ),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Recent scoring events')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Kicks +2')).toHaveLength(1);
  });

  it('renders all configured categories in the lineup rows', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Player One')).toBeInTheDocument();
    });

    const playerRow = screen.getByText('Player One').closest('div[class*="grid"]');
    expect(playerRow).not.toBeNull();

    const scoped = within(playerRow as HTMLElement);
    expect(scoped.getByText('Goals')).toBeInTheDocument();
    expect(scoped.getByText('Kicks')).toBeInTheDocument();
    expect(scoped.getByText('Handballs')).toBeInTheDocument();
    expect(scoped.getByText('Marks')).toBeInTheDocument();
    expect(scoped.getByText('Tackles')).toBeInTheDocument();
    expect(scoped.getByText('Inside 50s')).toBeInTheDocument();
  });

  it('renders inside 50 values from snake_case player stat payloads', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ...payload,
        data: {
          ...payload.data,
          home: {
            ...payload.data.home,
            starters: [
              {
                ...payload.data.home.starters[0],
                stats: {
                  ...payload.data.home.starters[0]?.stats,
                  inside50s: undefined,
                  inside_50s: 3,
                },
              },
              ...payload.data.home.starters.slice(1),
            ],
          },
        },
      }),
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Player One')).toBeInTheDocument();
    });

    const playerRow = screen.getByText('Player One').closest('div[class*="grid"]');
    expect(playerRow).not.toBeNull();

    expect(within(playerRow as HTMLElement).getByText('3')).toBeInTheDocument();
  });

  it('shows players without round stats with not-played row accent and badge', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Player Pending')).toBeInTheDocument();
    });

    const pendingRow = screen.getByText('Player Pending').closest('div[class*="grid"]');
    expect(pendingRow).toHaveClass('border-l-[color:var(--league-border)]');
    expect(within(pendingRow as HTMLElement).getByText('Not played')).toBeInTheDocument();
  });

  it('shows players whose AFL team has finished without a score with no-score accent and counts them as played', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ...payload,
        data: {
          ...payload.data,
          completedTeams: ['CCC'],
        },
      }),
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Player Pending')).toBeInTheDocument();
    });

    const pendingRow = screen.getByText('Player Pending').closest('div[class*="grid"]');
    expect(pendingRow).toHaveClass('border-l-amber-500');
    expect(within(pendingRow as HTMLElement).getByText('No score')).toBeInTheDocument();
    expect(screen.getAllByText('2 played • 0 remaining').length).toBeGreaterThan(0);
  });

  it('shows players with round stats with live row accent', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Player One')).toBeInTheDocument();
    });

    const playedRow = screen.getByText('Player One').closest('div[class*="grid"]');
    expect(playedRow).toHaveClass('border-l-emerald-500');
  });

  it('renders other current league matchups as links to matchupId views', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    render(
      <LeagueMatchupTab
        leagueId="league-1"
        categories={['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          'Collapsed by default. Expand to browse the other current league head-to-heads.'
        )
      ).toBeInTheDocument();
    });

    expect(screen.queryByText('Third Team vs Fourth Team')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText('Third Team vs Fourth Team')).toBeInTheDocument();
    expect(screen.getByText('4-2')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /view third team vs fourth team matchup/i });
    expect(link).toHaveAttribute('href', '/leagues/league-1?tab=matchup&matchupId=matchup-2');
  });
});
