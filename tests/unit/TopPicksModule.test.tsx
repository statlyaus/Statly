import { act, render, screen, within } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayerStat } from '../../src/hooks/usePlayerStats';
import TopPicksModuleClient from '../../src/components/dashboard/TopPicksModule.client';

const playerStatsMocks = vi.hoisted(() => ({
  usePlayerStatsETL: vi.fn(),
}));

vi.mock('../../src/hooks/usePlayerStats', () => ({
  usePlayerStatsETL: playerStatsMocks.usePlayerStatsETL,
}));

vi.mock('@/hooks/usePlayerStats', () => ({
  usePlayerStatsETL: playerStatsMocks.usePlayerStatsETL,
}));

describe('TopPicksModuleClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sorts top picks by total value and keeps zero-value players', () => {
    playerStatsMocks.usePlayerStatsETL.mockReturnValue({
      data: [
        playerStat({ player_id: 'zero', player_name: 'Zero Value', totalValue: 0 }),
        playerStat({ player_id: 'high', player_name: 'High Value', totalValue: 42 }),
        playerStat({ player_id: 'mid', player_name: 'Mid Value', totalValue: 7 }),
      ],
      error: null,
      loading: false,
      refetch: vi.fn(),
    });

    render(<TopPicksModuleClient socket={null} />);

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('High Value')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Mid Value')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Zero Value')).toBeInTheDocument();
  });

  it('refetches when the top picks realtime event arrives', () => {
    const refetch = vi.fn();
    const socketHandlers = new Map<string, () => void>();
    const socket = {
      off: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        socketHandlers.set(event, handler);
      }),
    } as unknown as Socket;

    playerStatsMocks.usePlayerStatsETL.mockReturnValue({
      data: [playerStat({ player_id: 'high', player_name: 'High Value', totalValue: 42 })],
      error: null,
      loading: false,
      refetch,
    });

    render(<TopPicksModuleClient socket={socket} />);

    act(() => {
      socketHandlers.get('top-picks:update')?.();
    });

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(socket.on).toHaveBeenCalledWith('top-picks:update', expect.any(Function));
  });
});

function playerStat(overrides: Partial<PlayerStat>): PlayerStat {
  return {
    behinds: 0,
    categories: {
      contestedMarks: 0,
      contestedPossessions: 0,
      effectiveDisposals: 0,
      goals: 0,
      inside50s: 0,
      intercepts: 0,
      rebound50s: 0,
      scoreInvolvements: 0,
      tackles: 0,
    },
    fantasy_points: 0,
    goals: 0,
    id: overrides.player_id ?? 'player-id',
    match_id: 'match-1',
    opposition: 'OPP',
    perGameLog: {} as PlayerStat['perGameLog'],
    player_id: 'player-id',
    player_name: 'Player Name',
    position: 'MID',
    round_number: 1,
    season: 2026,
    tackles: 0,
    team: 'STAT',
    tenthCell: {
      label: 'SI',
      type: 'count',
      value: 0,
    },
    totalValue: 0,
    ...overrides,
  };
}
