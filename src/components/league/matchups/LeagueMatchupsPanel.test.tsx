import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: authenticatedFetchMock }));

import { LeagueMatchupsPanel } from './LeagueMatchupsPanel';

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
  winner: 'home' | 'away' | 'draw'
) {
  return { category, label, shortLabel, homeValue, awayValue, direction: 'HIGH_WINS', winner };
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

  it('shows no result before the matchup starts', async () => {
    authenticatedFetchMock.mockImplementation(respond('SCHEDULED'));
    render(<LeagueMatchupsPanel leagueId="league-1" currentUserId="user-1" />);

    const table = await totalsTable();
    expect(table.queryByText(/ (won|lost|drawn)$/)).not.toBeInTheDocument();
  });
});
