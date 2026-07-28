import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/performance', () => ({ getPerformanceMonitor: () => null }));

import { useTeamRoster } from '@/hooks/useTeamRoster';

describe('useTeamRoster request replacement', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears players from the previous team while a replacement roster is loading', async () => {
    const responses: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            responses.push(resolve);
          })
      )
    );

    const { result, rerender } = renderHook(
      ({ leagueId, userId }) => useTeamRoster(leagueId, userId),
      { initialProps: { leagueId: 'league-1', userId: 'user-1' } }
    );

    await waitFor(() => expect(responses).toHaveLength(1));
    responses[0](
      new Response(
        JSON.stringify({
          success: true,
          data: { roster: { players: [{ id: 'player-1', name: 'Old Player' }] } },
        }),
        { status: 200 }
      )
    );
    await waitFor(() => expect(result.current.players).toHaveLength(1));

    rerender({ leagueId: 'league-2', userId: 'user-2' });

    await waitFor(() => expect(responses).toHaveLength(2));
    expect(result.current.players).toEqual([]);
    expect(result.current.loading).toBe(true);

    responses[1](
      new Response(
        JSON.stringify({
          success: true,
          data: { roster: { players: [{ id: 'player-2', name: 'New Player' }] } },
        }),
        { status: 200 }
      )
    );
    await waitFor(() => expect(result.current.players[0]?.id).toBe('player-2'));
  });
});
