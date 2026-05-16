import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CANONICAL_STAT_KEYS } from '@/lib/stats/statColumns';

const fetchApiMock = vi.fn();

vi.mock('@/lib/api', () => ({
  fetchApi: (...args: unknown[]) => fetchApiMock(...args),
}));

import { useLeagueStatColumns } from '../useLeagueStatColumns';

describe('useLeagueStatColumns', () => {
  it('exposes all canonical stat keys when no league is selected', async () => {
    const { result } = renderHook(() => useLeagueStatColumns(undefined));

    await waitFor(() => {
      expect(result.current.visibleKeys.length).toBe(CANONICAL_STAT_KEYS.length);
      expect(result.current.defaultKeys).toEqual(CANONICAL_STAT_KEYS);
    });
    expect(fetchApiMock).not.toHaveBeenCalled();
  });

  it('treats empty league id like no league (global research)', async () => {
    const { result } = renderHook(() => useLeagueStatColumns(''));

    await waitFor(() => {
      expect(result.current.visibleKeys).toEqual(CANONICAL_STAT_KEYS);
    });
    expect(fetchApiMock).not.toHaveBeenCalled();
  });

  it('loads league category defaults when league id is set', async () => {
    fetchApiMock.mockResolvedValueOnce({
      data: {
        league: {
          categories: ['Kicks', 'Marks', 'Tackles'],
        },
      },
    });

    const { result } = renderHook(() => useLeagueStatColumns('league-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(fetchApiMock).toHaveBeenCalledWith('leagues/league-1');
    expect(result.current.visibleKeys).toEqual(['kicks', 'marks', 'tackles']);
  });
});
