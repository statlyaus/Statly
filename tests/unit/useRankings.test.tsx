import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRankings } from '@/hooks/useRankings';

const fetchApiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  fetchApi: fetchApiMock,
}));

describe('useRankings', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('settles with a timeout error when the rankings request stalls', async () => {
    vi.useFakeTimers();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    fetchApiMock.mockImplementation((_endpoint: string, init?: RequestInit) => {
      const signal = init?.signal;

      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Request aborted', 'AbortError'));
        });
      });
    });

    const { result } = renderHook(() => useRankings());

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchApiMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('Rankings request timed out.');
    expect(result.current.rankings).toEqual([]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
