import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';
import { YAHOO_DEFAULT_ROSTER_SLOTS } from '@/types/basketball';

import { BasketballLeagueForm } from './BasketballLeagueForm';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  callBasketballApi: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock('../shell/basketballApi', () => ({ callBasketballApi: mocks.callBasketballApi }));

const league: BasketballLeagueDetail = {
  id: 'league-1',
  name: 'REC Bible',
  platform: 'ESPN',
  format: 'H2H_EACH_CATEGORY',
  season: 2027,
  categories: ['FG_PCT', 'FT_PCT', 'THREES', 'PTS', 'REB', 'AST', 'STL', 'BLK'],
  puntCategories: ['FT_PCT'],
  teamCount: 10,
  rosterSlots: { ...YAHOO_DEFAULT_ROSTER_SLOTS, BN: 4 },
  weekOneStartsOn: '2026-10-20',
  regularSeasonEndsOn: '2027-04-04',
  twoWeekMatchups: [17],
  auctionBudget: 200,
  myTeamId: 'mine',
  teams: [{ id: 'mine', name: 'Robbo', isMine: true, sortOrder: 0 }],
  rosterSpots: [],
  matchups: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

beforeEach(() => {
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.callBasketballApi.mockReset();
});

describe('BasketballLeagueForm (create)', () => {
  it('starts from the 2026-27 Yahoo 9-cat defaults and creates the league, then opens its roster', async () => {
    mocks.callBasketballApi.mockResolvedValue({ ok: true, data: { id: 'new-league' } });
    render(<BasketballLeagueForm mode="create" />);

    expect(screen.getByLabelText('Platform')).toHaveValue('YAHOO');
    expect(screen.getByRole('radio', { name: /H2H most categories/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /9-category/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Turnovers/ })).toBeChecked();
    expect(screen.getByLabelText('Number of teams')).toHaveValue(12);
    expect(screen.getByLabelText('Week 1 starts')).toHaveValue('2026-10-19');
    expect(screen.getByLabelText('Regular season ends')).toHaveValue('2027-04-11');

    fireEvent.change(screen.getByLabelText('League name'), { target: { value: 'REC Bible' } });
    fireEvent.change(screen.getByLabelText('Your team name'), { target: { value: 'Robbo' } });
    fireEvent.change(screen.getByLabelText(/Other team names/), {
      target: { value: 'Rival\n\n  Bench Mob  \n' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/basketball/new-league/roster'));
    expect(mocks.callBasketballApi).toHaveBeenCalledWith('/api/basketball/leagues', 'POST', {
      name: 'REC Bible',
      platform: 'YAHOO',
      format: 'H2H_MOST_CATEGORIES',
      categories: ['FG_PCT', 'FT_PCT', 'THREES', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO'],
      puntCategories: [],
      teamCount: 12,
      rosterSlots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 3, IL: 3 },
      weekOneStartsOn: '2026-10-19',
      regularSeasonEndsOn: '2027-04-11',
      twoWeekMatchups: [],
      auctionBudget: null,
      myTeamName: 'Robbo',
      otherTeamNames: ['Rival', 'Bench Mob'],
    });
  });

  it('shows the server field errors next to their fields and moves focus to the error summary', async () => {
    mocks.callBasketballApi.mockResolvedValue({
      ok: false,
      status: 400,
      message: 'Check the highlighted fields',
      formErrors: [],
      fieldErrors: { name: ['Enter a name'], 'rosterSlots.PG': ['Use 0 to 10'] },
    });
    render(<BasketballLeagueForm mode="create" />);

    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));

    const summary = await screen.findByRole('group', { name: /Check 2 fields/ });
    expect(summary).toHaveFocus();
    expect(summary).toHaveTextContent('League name: Enter a name');
    expect(summary).toHaveTextContent('PG slots: Use 0 to 10');

    const name = screen.getByLabelText('League name');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(expect.stringContaining('Enter a name'));
    const pg = screen.getByLabelText('PG');
    expect(pg).toHaveAttribute('aria-invalid', 'true');
    expect(pg).toHaveAccessibleDescription('Use 0 to 10');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('does not send a slot count that is not a number', async () => {
    render(<BasketballLeagueForm mode="create" />);

    fireEvent.change(screen.getByLabelText('UTIL'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));

    expect(await screen.findByRole('group', { name: /Check 1 field/ })).toHaveFocus();
    expect(screen.getByLabelText('UTIL')).toHaveAccessibleDescription(
      'Enter a number from 0 to 10'
    );
    expect(mocks.callBasketballApi).not.toHaveBeenCalled();
  });

  it('switches to the 8-category preset and only offers punts for counted categories', () => {
    render(<BasketballLeagueForm mode="create" />);

    fireEvent.click(screen.getByRole('radio', { name: /8-category/ }));

    expect(screen.getByRole('checkbox', { name: /Turnovers/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Punt PTS' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Punt TO' })).not.toBeInTheDocument();
  });
});

describe('BasketballLeagueForm (edit)', () => {
  it('starts from the saved settings, saves all of them and refreshes the page', async () => {
    mocks.callBasketballApi.mockResolvedValue({ ok: true, data: league });
    render(<BasketballLeagueForm mode="edit" league={league} />);

    expect(screen.getByLabelText('League name')).toHaveValue('REC Bible');
    expect(screen.queryByLabelText('Your team name')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /8-category/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Punt FT%' })).toBeChecked();
    expect(screen.getByLabelText('BN')).toHaveValue(4);

    fireEvent.change(screen.getByLabelText('Auction budget'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Settings saved');
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.callBasketballApi).toHaveBeenCalledWith(
      '/api/basketball/leagues/league-1',
      'PATCH',
      expect.objectContaining({
        format: 'H2H_EACH_CATEGORY',
        puntCategories: ['FT_PCT'],
        rosterSlots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 4, IL: 3 },
        twoWeekMatchups: [17],
        auctionBudget: null,
      })
    );
  });
});
