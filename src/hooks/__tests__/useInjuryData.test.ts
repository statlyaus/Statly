import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useInjuryData } from '../useInjuryData';

const injury = {
  id: 'sam-example-carlton',
  name: 'Sam Example',
  team: 'Carlton',
  position: '',
  injury: 'Hamstring',
  status: '1-2 weeks',
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const unavailable = {
  success: false,
  data: [],
  source: 'footywire_scrape_failed',
  count: 0,
  lastUpdated: null,
  teamFilter: null,
  error: 'Injury list unavailable: the Footywire scrape failed',
};

describe('useInjuryData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports injuries unavailable and shows no rows when the route fails closed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(unavailable, 502))
    );

    const { result } = renderHook(() => useInjuryData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(unavailable.error);
    expect(result.current.injuries).toEqual([]);
  });

  it('drops an earlier list when a later refresh fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: true,
            data: [injury],
            count: 1,
            lastUpdated: '2026-10-09T00:00:00.000Z',
            teamFilter: null,
          },
          200
        )
      )
      .mockResolvedValueOnce(jsonResponse(unavailable, 502));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useInjuryData());
    await waitFor(() => expect(result.current.injuries).toHaveLength(1));

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.error).toBe(unavailable.error));
    expect(result.current.injuries).toEqual([]);
  });
});
