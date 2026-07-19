import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LeagueLineupPanel } from '@/components/league/matchups/LeagueLineupPanel';
import type { LineupFieldSpot } from '@/components/league/matchups/lineupBuilderTypes';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

vi.mock('@/components/league/matchups/LineupFieldBoard', () => ({
  LineupFieldBoard: ({
    disabled,
    rosterPlayers,
    onAssignPlayer,
    onClearSpot,
  }: {
    disabled?: boolean;
    rosterPlayers: Array<{ name: string }>;
    onAssignPlayer: (playerId: string, spot: LineupFieldSpot) => void;
    onClearSpot: (spot: LineupFieldSpot) => void;
  }) => {
    const forwardSpot: LineupFieldSpot = {
      id: 'FWD-0',
      label: 'Forward 1',
      slot: 'FWD',
      slotIndex: 0,
    };
    const defenderSpot: LineupFieldSpot = {
      id: 'DEF-0',
      label: 'Defender 1',
      slot: 'DEF',
      slotIndex: 0,
    };

    return (
      <div data-testid="lineup-board" data-disabled={String(Boolean(disabled))}>
        <span>{rosterPlayers.map((player) => player.name).join(', ')}</span>
        <button type="button" onClick={() => onAssignPlayer('player-1', forwardSpot)}>
          Assign player
        </button>
        <button type="button" onClick={() => onAssignPlayer('player-2', defenderSpot)}>
          Assign second player
        </button>
        <button type="button" onClick={() => onClearSpot(forwardSpot)}>
          Clear player
        </button>
      </div>
    );
  },
}));

function lineupPayload(
  lockState: 'OPEN' | 'LOCKED' | 'PUBLISHED_PENDING' | 'NO_MATCHUP' = 'OPEN',
  playerName = 'First Player'
) {
  return {
    success: true,
    data: {
      rosterPlayers: [
        { playerId: 'player-1', name: playerName, position: 'FWD', club: 'AAA' },
        { playerId: 'player-2', name: 'Second Player', position: 'DEF', club: 'BBB' },
      ],
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

function response(payload: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => payload };
}

describe('LeagueLineupPanel client state guards', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['LOCKED', 'NO_MATCHUP'] as const)(
    'blocks all mutations and autosave when the round is %s',
    async (lockState) => {
      authenticatedFetchMock.mockResolvedValue(response(lineupPayload(lockState)));

      render(<LeagueLineupPanel leagueId="league-1" currentUserId="user-1" />);

      expect(await screen.findByTestId('lineup-board')).toHaveAttribute('data-disabled', 'true');
      vi.useFakeTimers();
      fireEvent.click(screen.getByRole('button', { name: 'Assign player' }));
      fireEvent.click(screen.getByRole('button', { name: 'Clear player' }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(authenticatedFetchMock).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole('button', { name: lockState === 'LOCKED' ? 'Locked' : 'No matchup' })
      ).toBeDisabled();
    }
  );

  it('does not retry a failed autosave snapshot until a new edit', async () => {
    let patchCalls = 0;
    authenticatedFetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method !== 'PATCH') return Promise.resolve(response(lineupPayload()));
      patchCalls += 1;
      return Promise.resolve(
        patchCalls === 1
          ? response({ success: false, error: 'Autosave failed.' }, false)
          : response({ success: true })
      );
    });

    render(<LeagueLineupPanel leagueId="league-1" currentUserId="user-1" />);
    await screen.findByTestId('lineup-board');
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Assign player' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText('Autosave failed.')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(patchCalls).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Assign second player' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(patchCalls).toBe(2);
  });

  it('allows an explicit save to retry a failed autosave snapshot', async () => {
    let patchCalls = 0;
    authenticatedFetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method !== 'PATCH') return Promise.resolve(response(lineupPayload()));
      patchCalls += 1;
      return Promise.resolve(
        patchCalls === 1
          ? response({ success: false, error: 'Autosave failed.' }, false)
          : response({ success: true })
      );
    });

    render(<LeagueLineupPanel leagueId="league-1" currentUserId="user-1" />);
    await screen.findByTestId('lineup-board');
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Assign player' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText('Autosave failed.')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
      await Promise.resolve();
    });
    expect(patchCalls).toBe(2);
    expect(screen.getByText('Lineup saved.')).toBeInTheDocument();
  });

  it('ignores an older load response after the league changes', async () => {
    let resolveFirst: ((value: ReturnType<typeof response>) => void) | undefined;
    const firstResponse = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveFirst = resolve;
    });

    authenticatedFetchMock.mockImplementation((url: string) => {
      if (url.includes('/league-1/')) return firstResponse;
      return Promise.resolve(response(lineupPayload('OPEN', 'Second League Player')));
    });

    const { rerender } = render(<LeagueLineupPanel leagueId="league-1" currentUserId="user-1" />);
    rerender(<LeagueLineupPanel leagueId="league-2" currentUserId="user-1" />);

    expect(await screen.findByText(/Second League Player/)).toBeInTheDocument();
    await act(async () => {
      resolveFirst?.(response(lineupPayload('OPEN', 'Stale First League Player')));
      await firstResponse;
    });

    expect(screen.queryByText(/Stale First League Player/)).not.toBeInTheDocument();
    expect(screen.getByText(/Second League Player/)).toBeInTheDocument();
  });
});
