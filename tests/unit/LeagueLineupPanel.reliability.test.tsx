import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LeagueLineupPanel } from '@/components/league/matchups/LeagueLineupPanel';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

vi.mock('@/components/league/matchups/LineupFieldBoard', () => ({
  LineupFieldBoard: (props: {
    disabled?: boolean;
    rosterPlayers: Array<{ playerId: string; name: string }>;
    spots: Array<{ id: string; slot: 'FWD'; slotIndex: number; label: string }>;
    onAssignPlayer: (
      playerId: string,
      spot: { id: string; slot: 'FWD'; slotIndex: number; label: string }
    ) => void;
  }) => (
    <div aria-label="Mock lineup board" data-disabled={String(Boolean(props.disabled))}>
      {props.rosterPlayers.map((player) => (
        <span key={player.playerId}>{player.name}</span>
      ))}
      <button type="button" onClick={() => props.onAssignPlayer('player-1', props.spots[0])}>
        Assign player
      </button>
    </div>
  ),
}));

function response(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  };
}

function lineupPayload(
  lockState: 'OPEN' | 'LOCKED' | 'NO_MATCHUP' = 'OPEN',
  playerName = 'First Player'
) {
  return {
    success: true,
    data: {
      rosterPlayers: [{ playerId: 'player-1', name: playerName, position: 'FWD', club: 'Club' }],
      players: [],
      lineupSlots: { FWD: 1, DEF: 1, MID: 1, RUC: 1, UTIL: 1 },
      interchangeSlots: 0,
      context: {
        source: 'PUBLISHED',
        round: 1,
        aflRound: 1,
        phase: 'REGULAR',
        lockState,
        lockAt: null,
        fallbackLockAt: null,
        opponent: lockState === 'NO_MATCHUP' ? null : { id: 'team-2', teamName: 'Rivals' },
      },
      setupRequired: false,
      canManageCompetition: false,
      savedRound: false,
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('LeagueLineupPanel reliability', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores a stale lineup response after the league changes', async () => {
    let resolveFirstRequest!: (value: ReturnType<typeof response>) => void;
    const firstRequest = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveFirstRequest = resolve;
    });

    authenticatedFetchMock.mockImplementation((url: string) => {
      if (url.includes('league-1')) return firstRequest;
      return Promise.resolve(response(lineupPayload('OPEN', 'Second Player')));
    });

    const { rerender } = render(<LeagueLineupPanel leagueId="league-1" currentUserId="user-1" />);
    rerender(<LeagueLineupPanel leagueId="league-2" currentUserId="user-1" />);

    expect(await screen.findByText('Second Player')).toBeInTheDocument();

    await act(async () => {
      resolveFirstRequest(response(lineupPayload('OPEN', 'Stale Player')));
      await flushPromises();
    });

    expect(screen.getByText('Second Player')).toBeInTheDocument();
    expect(screen.queryByText('Stale Player')).not.toBeInTheDocument();
  });

  it.each(['LOCKED', 'NO_MATCHUP'] as const)(
    'does not mutate or autosave a %s lineup',
    async (lockState) => {
      vi.useFakeTimers();
      authenticatedFetchMock.mockResolvedValue(response(lineupPayload(lockState)));

      render(<LeagueLineupPanel leagueId="league-1" currentUserId="user-1" />);
      await act(flushPromises);

      expect(screen.getByLabelText('Mock lineup board')).toHaveAttribute('data-disabled', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Assign player' }));

      await act(async () => {
        vi.advanceTimersByTime(1_000);
        await flushPromises();
      });

      expect(
        authenticatedFetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
      ).toHaveLength(0);
    }
  );

  it('does not retry a failed autosave snapshot until an explicit save', async () => {
    vi.useFakeTimers();
    authenticatedFetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(response({ success: false, error: 'Save failed.' }, false));
      }
      return Promise.resolve(response(lineupPayload()));
    });

    render(<LeagueLineupPanel leagueId="league-1" currentUserId="user-1" />);
    await act(flushPromises);

    fireEvent.click(screen.getByRole('button', { name: 'Assign player' }));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushPromises();
    });

    expect(
      authenticatedFetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    ).toHaveLength(1);
    expect(screen.getByText('Save failed.')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await flushPromises();
    });
    expect(
      authenticatedFetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    await act(flushPromises);

    expect(
      authenticatedFetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    ).toHaveLength(2);
  });
});
