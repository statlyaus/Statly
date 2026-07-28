import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
  createAdapter: vi.fn(),
}));

vi.mock('@socket.io/redis-adapter', () => ({
  createAdapter: adapterMocks.createAdapter,
}));

import { installSocketRedisAdapter } from '@/server/socketRedisAdapter';

describe('installSocketRedisAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('installs the adapter and closes both duplicate clients', async () => {
    const publishClient = client();
    const subscribeClient = client();
    const redis = {
      duplicate: vi.fn().mockReturnValueOnce(publishClient).mockReturnValueOnce(subscribeClient),
    };
    const io = { adapter: vi.fn() };
    const adapter = Symbol('adapter');
    adapterMocks.createAdapter.mockReturnValue(adapter);

    const lifecycle = await installSocketRedisAdapter(io as never, redis as never);

    expect(publishClient.ping).toHaveBeenCalledOnce();
    expect(subscribeClient.ping).toHaveBeenCalledOnce();
    expect(adapterMocks.createAdapter).toHaveBeenCalledWith(publishClient, subscribeClient, {
      publishOnSpecificResponseChannel: true,
    });
    expect(io.adapter).toHaveBeenCalledWith(adapter);

    await lifecycle.close();
    expect(publishClient.quit).toHaveBeenCalledOnce();
    expect(subscribeClient.quit).toHaveBeenCalledOnce();
  });

  it('disconnects both duplicate clients when initialization fails', async () => {
    const publishClient = client();
    const subscribeClient = client();
    subscribeClient.ping.mockRejectedValue(new Error('subscription failed'));
    const redis = {
      duplicate: vi.fn().mockReturnValueOnce(publishClient).mockReturnValueOnce(subscribeClient),
    };

    await expect(
      installSocketRedisAdapter({ adapter: vi.fn() } as never, redis as never)
    ).rejects.toThrow('subscription failed');
    expect(publishClient.disconnect).toHaveBeenCalledOnce();
    expect(subscribeClient.disconnect).toHaveBeenCalledOnce();
  });
});

function client() {
  return {
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn(),
  };
}
