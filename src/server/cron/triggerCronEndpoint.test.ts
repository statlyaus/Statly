import { describe, expect, it, vi } from 'vitest';

import { triggerCronEndpoint } from './triggerCronEndpoint';

function fetchReturning(status: number) {
  return vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;
}

describe('triggerCronEndpoint', () => {
  it('calls the route on the site URL with the secret as a bearer token', async () => {
    const fetchImpl = fetchReturning(200);

    const status = await triggerCronEndpoint('/api/cron/trades', {
      baseUrl: 'https://statly.example/',
      secret: 'cron-secret',
      fetchImpl,
    });

    expect(status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://statly.example/api/cron/trades'),
      expect.objectContaining({ headers: { authorization: 'Bearer cron-secret' } })
    );
  });

  it('refuses to call the route when CRON_SECRET is missing', async () => {
    const fetchImpl = fetchReturning(200);

    await expect(
      triggerCronEndpoint('/api/cron/trades', {
        baseUrl: 'https://statly.example',
        secret: '  ',
        fetchImpl,
      })
    ).rejects.toThrow('CRON_SECRET is not set');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses to call the route when the site URL is missing', async () => {
    const fetchImpl = fetchReturning(200);

    await expect(
      triggerCronEndpoint('/api/cron/trades', { baseUrl: undefined, secret: 's', fetchImpl })
    ).rejects.toThrow('Site URL is not set');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails the scheduled run when the route rejects it', async () => {
    await expect(
      triggerCronEndpoint('/api/cron/trades', {
        baseUrl: 'https://statly.example',
        secret: 'cron-secret',
        fetchImpl: fetchReturning(401),
      })
    ).rejects.toThrow('/api/cron/trades responded with 401');
  });
});
