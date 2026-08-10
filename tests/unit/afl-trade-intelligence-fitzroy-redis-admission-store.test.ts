import { describe, expect, it } from 'vitest';

import { createAflTradeIoredisCaptureAdmissionStore } from '@/server/aflTradeIntelligence/source/fitzRoyRedisCaptureAdmissionStore';

class FixtureEvalClient {
  readonly calls: { script: string; numberOfKeys: number; arguments: (string | number)[] }[] = [];
  responses: unknown[] = [];

  async eval(script: string, numberOfKeys: number, ...args: (string | number)[]) {
    this.calls.push({ script, numberOfKeys, arguments: args });
    return this.responses.shift();
  }
}

describe('fitzRoy Redis capture admission store', () => {
  it('uses one atomic three-key acquisition and decodes admitted or deferred responses', async () => {
    const client = new FixtureEvalClient();
    client.responses.push([1, '901000'], [0, '902000']);
    const store = createAflTradeIoredisCaptureAdmissionStore(client);
    const input = {
      providerKey: 'afl-trade:capture:provider:footywire',
      requestKey: `afl-trade:capture:request:footywire-player-stats:${'a'.repeat(64)}`,
      token: 'lease-token',
      nowMs: 1_000,
      leaseMs: 900_000,
    };

    await expect(store.acquire(input)).resolves.toEqual({
      acquired: true,
      expiresAtMs: 901_000,
    });
    await expect(store.acquire(input)).resolves.toEqual({
      acquired: false,
      retryAtMs: 902_000,
    });
    expect(client.calls[0]).toMatchObject({
      numberOfKeys: 3,
      arguments: [
        input.providerKey,
        `${input.providerKey}:cooldown`,
        input.requestKey,
        input.token,
        String(input.nowMs),
        String(input.leaseMs),
      ],
    });
  });

  it('atomically verifies the lease token before applying provider and request cooldowns', async () => {
    const client = new FixtureEvalClient();
    client.responses.push(1, 0);
    const store = createAflTradeIoredisCaptureAdmissionStore(client);
    const input = {
      providerKey: 'afl-trade:capture:provider:afl_tables',
      requestKey: `afl-trade:capture:request:afl-tables-player-stats:${'b'.repeat(64)}`,
      token: 'lease-token',
      completedAtMs: 10_000,
      providerCooldownMs: 2_000,
      requestCooldownMs: 86_400_000,
    };

    await expect(store.complete(input)).resolves.toBe(true);
    await expect(store.complete(input)).resolves.toBe(false);
    expect(client.calls[0]).toMatchObject({
      numberOfKeys: 3,
      arguments: [
        input.providerKey,
        `${input.providerKey}:cooldown`,
        input.requestKey,
        input.token,
        String(input.completedAtMs),
        String(input.providerCooldownMs),
        String(input.requestCooldownMs),
      ],
    });
  });

  it('rejects malformed Redis responses instead of guessing admission state', async () => {
    const client = new FixtureEvalClient();
    client.responses.push(['yes', 'later']);
    const store = createAflTradeIoredisCaptureAdmissionStore(client);

    await expect(
      store.acquire({
        providerKey: 'afl-trade:capture:provider:fryzigg',
        requestKey: `afl-trade:capture:request:fryzigg-player-stats:${'c'.repeat(64)}`,
        token: 'lease-token',
        nowMs: 1_000,
        leaseMs: 900_000,
      })
    ).rejects.toThrow('malformed');
  });
});
