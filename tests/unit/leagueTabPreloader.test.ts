import { describe, expect, it, vi } from 'vitest';

import { createIntentPreloader } from '@/components/league/leagueTabPreloader';

describe('createIntentPreloader', () => {
  it('deduplicates successful work for the same intent', async () => {
    let completeLoad: (() => void) | undefined;
    const loader = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeLoad = resolve;
        })
    );
    const onError = vi.fn();
    const preload = createIntentPreloader({ roster: loader }, onError);

    const firstRequest = preload('roster');
    const secondRequest = preload('roster');

    expect(firstRequest).toBe(secondRequest);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));

    completeLoad?.();
    await firstRequest;

    await preload('roster');
    expect(loader).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('consumes rejected preloads and permits a later retry', async () => {
    const error = new Error('temporary chunk failure');
    const loader = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const preload = createIntentPreloader({ roster: loader }, onError);

    await expect(preload('roster')).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith('roster', error);

    await expect(preload('roster')).resolves.toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does no work for an intent without a deferred loader', async () => {
    const onError = vi.fn();
    const preload = createIntentPreloader<'overview'>({}, onError);

    await expect(preload('overview')).resolves.toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });
});
