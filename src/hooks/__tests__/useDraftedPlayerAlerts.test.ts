import { renderHook, act, waitFor } from '@testing-library/react';
import { useDraftedPlayerAlerts } from '../useDraftedPlayerAlerts';

describe('useDraftedPlayerAlerts', () => {
  const player = { id: '1', name: 'Test Player', position: 'MID', club: 'AAA' };
  const watchlistItems = [{ playerId: '1', rank: 1, addedAt: '2024-01-01T00:00:00Z' }];

  it('creates and dismisses alerts for drafted watchlist players', async () => {
    const { result, rerender } = renderHook((props) => useDraftedPlayerAlerts(props), {
      initialProps: {
        draftedPlayerIds: [] as string[],
        allPlayers: [player],
        watchlistItems,
      },
    });

    rerender({
      draftedPlayerIds: ['1'],
      allPlayers: [player],
      watchlistItems,
    });

    await waitFor(() => expect(result.current.alerts.length).toBe(1));
    expect(result.current.alerts[0].id).toBe('1');

    act(() => result.current.dismissAlert('1'));
    await waitFor(() => expect(result.current.alerts.length).toBe(0));
  });
});
