import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: authenticatedFetchMock }));

import { LeagueMyTeamPanel } from './LeagueMyTeamPanel';

const future = '2099-10-03T09:30:00.000Z';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      requestedRound: 5,
      savedRound: 5,
      carriedFromRound: null,
      players: [{ playerId: 'def-1', slot: 'DEF', slotIndex: 0, lockedAt: null }],
      rosterPlayers: [
        {
          playerId: 'def-1',
          name: 'Dee Fender',
          position: 'DEF',
          club: 'GWS',
          gameStartsAt: future,
          opponent: 'Collingwood',
          isHome: true,
          bye: false,
          injury: null,
        },
        {
          playerId: 'def-2',
          name: 'Back Pocket',
          position: 'DEF',
          club: 'Sydney',
          gameStartsAt: null,
          opponent: null,
          isHome: null,
          bye: true,
          injury: null,
        },
        {
          playerId: 'def-3',
          name: 'Half Back',
          position: 'DEF',
          club: 'Geelong',
          gameStartsAt: future,
          opponent: 'Carlton',
          isHome: false,
          bye: false,
          injury: null,
        },
        {
          playerId: 'mid-1',
          name: 'Mid Fielder',
          position: 'MID',
          club: 'Geelong',
          gameStartsAt: future,
          opponent: 'Carlton',
          isHome: false,
          bye: false,
          injury: 'Hamstring',
        },
        {
          playerId: 'mid-2',
          name: 'Wing Man',
          position: 'MID',
          club: 'Essendon',
          gameStartsAt: future,
          opponent: 'Richmond',
          isHome: true,
          bye: false,
          injury: null,
        },
      ],
      rounds: [
        {
          round: 4,
          aflRound: 18,
          status: 'LOCKED',
          startsAt: '2026-09-24T09:00:00.000Z',
          lockAt: null,
          lockState: 'LOCKED',
        },
        {
          round: 5,
          aflRound: 19,
          status: 'SCHEDULED',
          startsAt: future,
          lockAt: null,
          lockState: 'OPEN',
        },
      ],
      playerStats: null,
      lineupSlots: { DEF: 2, MID: 1, RUC: 0, FWD: 0, UTIL: 0 },
      interchangeSlots: 0,
      lockPolicy: 'INDIVIDUAL_GAME_START',
      setupRequired: false,
      canManageCompetition: false,
      team: {
        memberId: 'member-1',
        teamName: 'Robbo Rockers',
        logoUrl: null,
        record: { wins: 1, losses: 3, draws: 0 },
        rank: 9,
        teams: 10,
      },
      opponentTeam: {
        memberId: 'member-2',
        teamName: 'Hard Ball Gets',
        logoUrl: null,
        record: { wins: 2, losses: 2, draws: 0 },
        rank: 5,
        teams: 10,
      },
      context: {
        round: 5,
        aflRound: 19,
        startsAt: future,
        lockAt: null,
        lockState: 'OPEN',
        opponent: { id: 'member-2', teamName: 'Hard Ball Gets' },
      },
      ...overrides,
    },
  };
}

function respond(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body });
}

describe('LeagueMyTeamPanel', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
    window.localStorage.clear();
  });

  it('opens on the next editable round with the matchup, records and fixture context', async () => {
    authenticatedFetchMock.mockImplementation(() => respond(payload()));

    render(<LeagueMyTeamPanel leagueId="league-1" currentUserId="user-1" />);

    expect(
      await screen.findByText('Round 5 · AFL Round 19 · vs Hard Ball Gets')
    ).toBeInTheDocument();
    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/api/leagues/league-1/lineups/next',
      expect.anything(),
      'user-1'
    );
    expect(screen.getByText('1–3 · 9th')).toBeInTheDocument();
    expect(screen.getByText('2–2 · 5th')).toBeInTheDocument();
    expect(screen.getByText('2 empty spots')).toBeInTheDocument();
    const firstDef = screen.getByRole('row', { name: 'DEF 1: Dee Fender' });
    expect(within(firstDef).getByText('v COL')).toBeInTheDocument();
    const benchBye = screen.getByRole('row', { name: 'Bench: Back Pocket' });
    expect(within(benchBye).getAllByText('BYE').length).toBeGreaterThan(0);
    const injured = screen.getByRole('row', { name: 'Bench: Mid Fielder' });
    expect(within(injured).getByTitle('Hamstring')).toBeInTheDocument();
  });

  it('fills empty spots with fit players, then saves only when the change is confirmed', async () => {
    authenticatedFetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? respond({ success: true, data: {} }) : respond(payload())
    );

    render(<LeagueMyTeamPanel leagueId="league-1" currentUserId="user-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fill empty spots' }));

    expect(screen.getByRole('row', { name: 'DEF 2: Half Back' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'MID 1: Wing Man' })).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('2 changes to confirm')).toBeInTheDocument();
    expect(
      authenticatedFetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'
      )
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm lineup' }));
    await waitFor(() =>
      expect(authenticatedFetchMock).toHaveBeenCalledWith(
        '/api/leagues/league-1/lineups/5',
        expect.objectContaining({ method: 'PATCH' }),
        'user-1'
      )
    );
    const patchCall = authenticatedFetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'
    );
    expect(JSON.parse(String((patchCall?.[1] as RequestInit).body)).players).toEqual(
      expect.arrayContaining([
        { playerId: 'def-1', slot: 'DEF', slotIndex: 0 },
        { playerId: 'def-3', slot: 'DEF', slotIndex: 1 },
        { playerId: 'mid-2', slot: 'MID', slotIndex: 0 },
      ])
    );
    expect(await screen.findByText(/^Confirmed /)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Unconfirmed changes' })).not.toBeInTheDocument();
  });

  it('only offers spots a player can play, and Discard restores the team', async () => {
    authenticatedFetchMock.mockImplementation(() => respond(payload()));

    render(<LeagueMyTeamPanel leagueId="league-1" currentUserId="user-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a player to MID 1' }));
    expect(
      screen.getByText('Filling MID 1: choose a bench player who can play MID.')
    ).toBeInTheDocument();
    // Defenders are not offered for a MID spot.
    expect(screen.queryByRole('button', { name: 'Put Half Back in MID 1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Put Wing Man in MID 1' }));
    expect(screen.getByRole('row', { name: 'MID 1: Wing Man' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Move Dee Fender from DEF 1' }));
    expect(screen.queryByRole('button', { name: 'Swap Dee Fender with Wing Man' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Move Dee Fender to DEF 2' }));
    expect(screen.getByRole('row', { name: 'DEF 2: Dee Fender' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Move Dee Fender from DEF 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Dee Fender to the bench' }));
    expect(screen.getByRole('row', { name: 'Bench: Dee Fender' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('row', { name: 'DEF 1: Dee Fender' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'MID 1: empty' })).toBeInTheDocument();
  });

  it('presents an unsaved default team as ready, and flags players out of position', async () => {
    authenticatedFetchMock.mockImplementation(() =>
      respond(
        payload({
          savedRound: null,
          defaultSource: 'AUTO',
          players: [
            { playerId: 'def-1', slot: 'DEF', slotIndex: 0, lockedAt: null },
            { playerId: 'def-3', slot: 'DEF', slotIndex: 1, lockedAt: null },
            { playerId: 'def-2', slot: 'MID', slotIndex: 0, lockedAt: null },
          ],
        })
      )
    );

    render(<LeagueMyTeamPanel leagueId="league-1" currentUserId="user-1" />);

    expect(await screen.findByText(/^Default: picked by position/)).toBeInTheDocument();
    expect(screen.getByText('1 out of position')).toBeInTheDocument();
    const outOfPosition = screen.getByRole('row', { name: 'MID 1: Back Pocket' });
    expect(within(outOfPosition).getByTitle("Listed DEF, can't play MID")).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Unconfirmed changes' })).not.toBeInTheDocument();
  });

  it('shows a locked round read-only and offers the next round to set', async () => {
    authenticatedFetchMock.mockImplementation((url: string) =>
      respond(
        url.endsWith('/lineups/4')
          ? payload({
              requestedRound: 4,
              context: {
                round: 4,
                aflRound: 18,
                startsAt: '2026-09-24T09:00:00.000Z',
                lockAt: null,
                lockState: 'LOCKED',
                opponent: { id: 'member-3', teamName: 'Centre Square Crew' },
              },
            })
          : payload()
      )
    );

    render(<LeagueMyTeamPanel leagueId="league-1" currentUserId="user-1" />);
    await screen.findByText('Round 5 · AFL Round 19 · vs Hard Ball Gets');
    fireEvent.change(screen.getByLabelText('Round'), { target: { value: '4' } });

    expect(await screen.findByText('Locked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fill empty spots' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set Round 5 team' }));
    await waitFor(() =>
      expect(authenticatedFetchMock).toHaveBeenLastCalledWith(
        '/api/leagues/league-1/lineups/5',
        expect.anything(),
        'user-1'
      )
    );
  });

  it('shows the field beside the table, sharing one selection and one Confirm bar', async () => {
    authenticatedFetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? respond({ success: true, data: {} }) : respond(payload())
    );
    render(<LeagueMyTeamPanel leagueId="league-1" currentUserId="user-1" />);

    expect(await screen.findByRole('heading', { name: 'On the field' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Round 5 lineup' })).toBeInTheDocument();

    // Clicking a table row selects that player on the field; clicking again lets go.
    fireEvent.click(screen.getByRole('row', { name: 'DEF 1: Dee Fender' }));
    expect(screen.getByRole('button', { name: 'DEF 1: Dee Fender, selected' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('row', { name: 'DEF 1: Dee Fender' }));
    expect(screen.getByRole('button', { name: 'DEF 1: Dee Fender' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    // Tapping a defender on the field lights up the free DEF spot on the field and in the table.
    const dee = screen.getByRole('button', { name: /^DEF 1: Dee Fender/ });
    fireEvent.click(dee);
    expect(dee).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'MID 1: empty' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Dee Fender to DEF 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'DEF 2: empty, tap to move here' }));
    expect(screen.getByRole('row', { name: 'DEF 2: Dee Fender' })).toBeInTheDocument();

    // Starting from the table shows on the field too.
    fireEvent.click(screen.getByRole('button', { name: 'Add a player to MID 1' }));
    expect(screen.getByRole('button', { name: 'MID 1: empty, selected' })).toBeInTheDocument();
    // The bench strip under the field offers only midfielders for a MID spot.
    expect(screen.getByRole('button', { name: 'Bench: Half Back' })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Bench: Wing Man, tap to put in the lineup' })
    );
    expect(screen.getByRole('button', { name: /^MID 1: Wing Man/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'MID 1: Wing Man' })).toBeInTheDocument();
    expect(screen.getByText(/changes? to confirm$/)).toBeInTheDocument();

    // Phones can shrink the field to a strip, and it stays that way.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse field' }));
    expect(screen.getByRole('button', { name: 'Expand field' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(window.localStorage.getItem('statly.myTeam.fieldCollapsed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm lineup' }));
    await waitFor(() =>
      expect(authenticatedFetchMock).toHaveBeenCalledWith(
        '/api/leagues/league-1/lineups/5',
        expect.objectContaining({ method: 'PATCH' }),
        'user-1'
      )
    );
    const patchCall = authenticatedFetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'
    );
    expect(JSON.parse(String((patchCall?.[1] as RequestInit).body)).players).toEqual(
      expect.arrayContaining([
        { playerId: 'def-1', slot: 'DEF', slotIndex: 1 },
        { playerId: 'mid-2', slot: 'MID', slotIndex: 0 },
      ])
    );
  });
});
