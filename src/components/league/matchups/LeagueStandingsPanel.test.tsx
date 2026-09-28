import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: authenticatedFetchMock }));

import { buildStandingsHistory } from '@/server/leagues/standingsHistory';

import { LeagueStandingsPanel } from './LeagueStandingsPanel';

function team(memberId: string, teamName: string, wins: number, losses: number) {
  return {
    memberId,
    teamName,
    teamLogoUrl: null,
    wins,
    losses,
    draws: 0,
    categoryWins: wins * 6 + losses * 3,
    categoryLosses: wins * 3 + losses * 6,
    categoryDraws: 0,
    draftSlot: null,
  };
}

function game(round: number, home: string, away: string, homeWins: number, awayWins: number) {
  return {
    round,
    phase: 'REGULAR' as const,
    status: 'FINAL' as const,
    homeMemberId: home,
    awayMemberId: away,
    byeMemberId: null,
    homeCategoryWins: homeWins,
    awayCategoryWins: awayWins,
    drawnCategories: 9 - homeWins - awayWins,
    winnerMemberId: homeWins > awayWins ? home : away,
  };
}

const history = buildStandingsHistory({
  // Ladder after two rounds: Alpha 2-0, You 1-1, Gamma 1-1, Delta 0-2.
  ladder: [
    team('alpha', 'Alpha FC', 2, 0),
    team('you', 'Robbo Rockers', 1, 1),
    team('gamma', 'Gamma United', 1, 1),
    team('delta', 'Delta Dogs', 0, 2),
  ],
  matchups: [
    game(1, 'alpha', 'you', 6, 3),
    game(1, 'gamma', 'delta', 5, 4),
    game(2, 'you', 'delta', 7, 2),
    game(2, 'alpha', 'gamma', 5, 4),
    { ...game(3, 'you', 'gamma', 2, 1), status: 'LIVE' as const, winnerMemberId: null },
    { ...game(3, 'alpha', 'delta', 1, 1), status: 'LIVE' as const, winnerMemberId: null },
  ],
  finalsTeams: 2,
});

function respond() {
  return Promise.resolve({
    ok: true,
    json: async () => ({
      success: true,
      data: { ...history, regularSeasonRounds: 11, viewerMemberId: 'you' },
    }),
  });
}

describe('LeagueStandingsPanel', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
    authenticatedFetchMock.mockImplementation(respond);
  });

  it('shows the ladder with form, movement, your place and the finals line', async () => {
    render(<LeagueStandingsPanel leagueId="league-1" currentUserId="user-1" />);

    expect(
      await screen.findByText('After round 2 · Round 3 live · Top 2 make finals')
    ).toBeInTheDocument();
    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/api/leagues/league-1/standings',
      {},
      'user-1'
    );
    expect(screen.getByText('2nd · 1–1')).toBeInTheDocument();
    expect(screen.getByText(/in the finals places/)).toBeInTheDocument();
    const yourRow = screen.getByRole('row', { name: '2. Robbo Rockers (your team)' });
    expect(within(yourRow).getByRole('img', { name: 'Last 2: L W' })).toBeInTheDocument();
    expect(within(yourRow).getByText('Live')).toBeInTheDocument();
    expect(within(yourRow).getByText('2–1')).toBeInTheDocument();
    expect(screen.getByText('Finals', { selector: 'span' })).toBeInTheDocument();
    expect(
      within(yourRow).getByText(/^(\d+%|In|Out|>99%|<1%)$/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Finals\s*, sort by finals chance/ })
    ).toBeInTheDocument();
  });

  it('sorts by a column and hides the finals line while sorted', async () => {
    render(<LeagueStandingsPanel leagueId="league-1" currentUserId="user-1" />);
    await screen.findByText('Finals', { selector: 'span' });

    fireEvent.click(screen.getByRole('button', { name: /GB\s*, sort by games back/ }));
    const header = screen.getByRole('columnheader', { name: /GB/ });
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.queryByText('Finals', { selector: 'span' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /GB\s*, sort by games back/ }));
    expect(header).toHaveAttribute('aria-sort', 'descending');
    const rows = screen.getAllByRole('row').filter((row) => row.getAttribute('aria-label'));
    expect(rows[0]).toHaveAccessibleName('4. Delta Dogs');
  });

  it('expands a team to show its results, linking your matches to the Match Centre', async () => {
    render(<LeagueStandingsPanel leagueId="league-1" currentUserId="user-1" />);
    const toggle = await screen.findByRole('button', { name: /Delta Dogs/ });

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Delta v you in round 2 involves you, so it links; round 1 does not.
    expect(
      screen.getByRole('link', { name: /lost 2–7 v Robbo Rockers\s*, open in Match Centre/ })
    ).toHaveAttribute('href', '/leagues/league-1?tab=matchups&round=2');
    expect(screen.getByText('lost 4–5 v Gamma United')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Delta Dogs roster' })).toBeInTheDocument();
  });

  it('shows the race to finals on a wins scale, with a readout per team', async () => {
    render(<LeagueStandingsPanel leagueId="league-1" currentUserId="user-1" />);
    await screen.findByText('Finals', { selector: 'span' });

    fireEvent.click(screen.getByRole('tab', { name: 'Race' }));

    expect(screen.getByRole('heading', { name: 'Race to finals' })).toBeInTheDocument();
    const you = screen.getByRole('button', { name: /Robbo Rockers \(your team\), 1 win/ });
    expect(you).toHaveAttribute('aria-pressed', 'true');
    expect(you).toHaveAccessibleName(/finals chance (\d+%|In|Out|>99%|<1%)$/);
    expect(
      screen.getByText(/chance of finals|finals place clinched|out of the finals race/, {
        selector: 'p[aria-live] span',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/in the finals places/, { selector: 'p[aria-live]' })
    ).toBeInTheDocument();

    const delta = screen.getByRole('button', { name: /Delta Dogs, 0 wins/ });
    fireEvent.click(delta);
    expect(delta).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/1 win behind 2nd/)).toBeInTheDocument();
  });

  it('shows every result in the results grid with a readout', async () => {
    render(<LeagueStandingsPanel leagueId="league-1" currentUserId="user-1" />);
    await screen.findByText('Finals', { selector: 'span' });

    fireEvent.click(screen.getByRole('tab', { name: 'Results' }));

    const cell = screen.getByRole('button', {
      name: 'Round 1: Gamma United won 5–4 v Delta Dogs',
    });
    fireEvent.focus(cell);
    expect(
      screen.getByText('Round 1: Gamma United won 5–4 v Delta Dogs', { selector: 'p' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Round 1: Robbo Rockers lost 3–6 v Alpha FC' })
    ).toHaveAttribute('href', '/leagues/league-1?tab=matchups&round=1');
  });
});
