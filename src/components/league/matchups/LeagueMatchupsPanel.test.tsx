import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: authenticatedFetchMock }));

import { LeagueMatchupsPanel, LIVE_SCORING_REFRESH_MS } from './LeagueMatchupsPanel';

type Status = 'SCHEDULED' | 'LIVE' | 'FINAL';

function respond(status: Status) {
  return () =>
    Promise.resolve({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          round: 3,
          availableRounds: [3],
          matchups: [
            {
              id: 'm1',
              round: 3,
              status,
              homeMember: { id: 'h', teamName: 'Ball Magnets', players: [] },
              awayMember: { id: 'a', teamName: 'Hard Ball Gets', players: [] },
              homeCategoryWins: 1,
              awayCategoryWins: 1,
              drawnCategories: 1,
              categoryRows: [
                row('goals', 'Goals', 'G', 14, 11, 'home'),
                row('tackles', 'Tackles', 'T', 68, 74, 'away'),
                row('intercepts', 'Intercepts', 'ITC', 58, 58, 'draw'),
                row('clangers', 'Clangers', 'CL', 40, 44, 'home', 'LOW_WINS'),
              ],
            },
          ],
        },
      }),
    });
}

function row(
  category: string,
  label: string,
  shortLabel: string,
  homeValue: number,
  awayValue: number,
  winner: 'home' | 'away' | 'draw',
  direction: 'HIGH_WINS' | 'LOW_WINS' = 'HIGH_WINS'
) {
  return { category, label, shortLabel, homeValue, awayValue, direction, winner };
}

async function totalsTable() {
  return within(await screen.findByRole('table', { name: /totals by scoring category/i }));
}

describe('LeagueMatchupsPanel category totals', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
  });

  it('states each category result in text, not colour alone', async () => {
    authenticatedFetchMock.mockImplementation(respond('LIVE'));
    render(<LeagueMatchupsPanel leagueId="league-1" currentUserId="user-1" />);

    const table = await totalsTable();
    const homeRow = table.getByRole('row', { name: /Ball Magnets/ });
    const awayRow = table.getByRole('row', { name: /Hard Ball Gets/ });

    expect(within(homeRow).getByText('Goals won')).toBeInTheDocument();
    expect(within(homeRow).getByText('Tackles lost')).toBeInTheDocument();
    expect(within(homeRow).getByText('Intercepts drawn')).toBeInTheDocument();
    expect(within(awayRow).getByText('Goals lost')).toBeInTheDocument();
    expect(within(awayRow).getByText('Tackles won')).toBeInTheDocument();
  });

  it('names each abbreviated category header in full', async () => {
    authenticatedFetchMock.mockImplementation(respond('FINAL'));
    render(<LeagueMatchupsPanel leagueId="league-1" currentUserId="user-1" />);

    const table = await totalsTable();
    expect(table.getByTitle('Intercepts')).toHaveTextContent('ITC');
  });

  it('marks a category the lower total wins, and only that one', async () => {
    authenticatedFetchMock.mockImplementation(respond('LIVE'));
    render(<LeagueMatchupsPanel leagueId="league-1" currentUserId="user-1" />);

    const table = await totalsTable();
    expect(table.getByRole('columnheader', { name: /^CL.*lower wins/i })).toBeInTheDocument();
    expect(table.getByRole('columnheader', { name: /^G$/ })).toBeInTheDocument();
    expect(table.getAllByText(/lower wins/i)).toHaveLength(1);
  });

  it('shows no result before the matchup starts', async () => {
    authenticatedFetchMock.mockImplementation(respond('SCHEDULED'));
    render(<LeagueMatchupsPanel leagueId="league-1" currentUserId="user-1" />);

    const table = await totalsTable();
    expect(table.queryByText(/ (won|lost|drawn)$/)).not.toBeInTheDocument();
  });

  it('labels live totals as provisional until the round is final', async () => {
    const live = respond('LIVE');
    authenticatedFetchMock.mockImplementation(async () => {
      const response = await live();
      const body = await response.json();
      (body.data.matchups[0] as Record<string, unknown>).provisional = true;
      return { ok: true, json: async () => body };
    });
    render(<LeagueMatchupsPanel leagueId="league-1" currentUserId="user-1" />);

    expect(await screen.findByText('Live · provisional')).toBeInTheDocument();
  });

  it('shows the start time in the league timezone, labelled', async () => {
    const scheduled = respond('SCHEDULED');
    authenticatedFetchMock.mockImplementation(async () => {
      const response = await scheduled();
      const body = await response.json();
      (body.data.matchups[0] as Record<string, unknown>).startsAt = '2026-10-03T09:30:00.000Z';
      return { ok: true, json: async () => body };
    });
    render(
      <LeagueMatchupsPanel leagueId="league-1" currentUserId="user-1" timeZone="Australia/Perth" />
    );

    expect(await screen.findByText(/^Starts Sat,? 3 Oct,? 5:30\spm AWST$/)).toBeInTheDocument();
  });
});

function respondEmpty(canManage: boolean) {
  return () =>
    Promise.resolve({
      ok: true,
      json: async () => ({
        success: true,
        data: { round: 1, availableRounds: [], matchups: [], permissions: { canManage } },
      }),
    });
}

describe('LeagueMatchupsPanel before any fixtures exist', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
  });

  it('shows the nine-category preview and lets a commissioner open league settings', async () => {
    authenticatedFetchMock.mockImplementation(respondEmpty(true));
    const onOpenSettings = vi.fn();
    render(
      <LeagueMatchupsPanel
        leagueId="league-1"
        currentUserId="user-1"
        categories={['goals', 'tackles', 'inside50s']}
        onOpenSettings={onOpenSettings}
      />
    );

    expect(
      await screen.findByRole('table', { name: /preview of your weekly matchup, no fixtures yet/i })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open league settings/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('does not offer league settings to someone who cannot manage the league', async () => {
    authenticatedFetchMock.mockImplementation(respondEmpty(false));
    render(
      <LeagueMatchupsPanel
        leagueId="league-1"
        currentUserId="user-1"
        categories={['goals']}
        onOpenSettings={vi.fn()}
      />
    );

    await screen.findByRole('table', { name: /preview of your weekly matchup/i });
    expect(screen.queryByRole('button', { name: /open league settings/i })).not.toBeInTheDocument();
  });

  it('announces loading as a status while matchups are fetched', () => {
    authenticatedFetchMock.mockImplementation(() => new Promise(() => {}));
    render(<LeagueMatchupsPanel leagueId="league-1" currentUserId="user-1" />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading matchups/i);
  });
});

describe('LeagueMatchupsPanel live refresh', () => {
  let visibility: DocumentVisibilityState = 'visible';

  beforeEach(() => {
    authenticatedFetchMock.mockReset();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refreshes the scores while a matchup is live, without blanking the page', async () => {
    authenticatedFetchMock.mockImplementation(respond('LIVE'));
    render(<LeagueMatchupsPanel leagueId="league-1" currentUserId="user-1" />);
    await totalsTable();
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(1);

    authenticatedFetchMock.mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      vi.advanceTimersByTime(LIVE_SCORING_REFRESH_MS);
    });

    expect(authenticatedFetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/loading matchups/i)).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: /totals by scoring category/i })).toBeInTheDocument();
  });

  it('pauses while the tab is hidden and catches up when it is shown again', async () => {
    authenticatedFetchMock.mockImplementation(respond('LIVE'));
    render(<LeagueMatchupsPanel leagueId="league-1" currentUserId="user-1" />);
    await totalsTable();

    visibility = 'hidden';
    await act(async () => {
      vi.advanceTimersByTime(LIVE_SCORING_REFRESH_MS * 3);
    });
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(authenticatedFetchMock).toHaveBeenCalledTimes(2));
  });

  it('does not poll when no matchup is live', async () => {
    authenticatedFetchMock.mockImplementation(respond('FINAL'));
    render(<LeagueMatchupsPanel leagueId="league-1" currentUserId="user-1" />);
    await totalsTable();

    await act(async () => {
      vi.advanceTimersByTime(LIVE_SCORING_REFRESH_MS * 2);
    });
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(1);
  });
});
