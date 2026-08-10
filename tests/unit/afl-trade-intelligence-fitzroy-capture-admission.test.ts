import { describe, expect, it } from 'vitest';

import {
  AflTradeFitzRoyCaptureAdmissionError,
  createAflTradeRedisCaptureAdmission,
  type AflTradeCaptureAdmissionRedis,
} from '@/server/aflTradeIntelligence/source/fitzRoyCaptureAdmission';

class FixtureRedis implements AflTradeCaptureAdmissionRedis {
  readonly leases = new Map<string, { token: string; expiresAt: number }>();
  readonly providerCooldowns = new Map<string, number>();
  readonly cooldowns = new Map<string, number>();
  unavailable = false;

  async acquire(input: {
    providerKey: string;
    requestKey: string;
    token: string;
    nowMs: number;
    leaseMs: number;
  }) {
    if (this.unavailable) throw new Error('redis unavailable');
    const lease = this.leases.get(input.providerKey);
    const providerCooldownUntil = this.providerCooldowns.get(input.providerKey) ?? 0;
    const cooldownUntil = this.cooldowns.get(input.requestKey) ?? 0;
    if (lease !== undefined && lease.expiresAt > input.nowMs) {
      return { acquired: false as const, retryAtMs: lease.expiresAt };
    }
    if (cooldownUntil > input.nowMs) {
      return { acquired: false as const, retryAtMs: cooldownUntil };
    }
    if (providerCooldownUntil > input.nowMs) {
      return { acquired: false as const, retryAtMs: providerCooldownUntil };
    }
    this.leases.set(input.providerKey, {
      token: input.token,
      expiresAt: input.nowMs + input.leaseMs,
    });
    return { acquired: true as const, expiresAtMs: input.nowMs + input.leaseMs };
  }

  async complete(input: {
    providerKey: string;
    requestKey: string;
    token: string;
    completedAtMs: number;
    providerCooldownMs: number;
    requestCooldownMs: number;
  }) {
    if (this.unavailable) throw new Error('redis unavailable');
    const lease = this.leases.get(input.providerKey);
    if (lease?.token !== input.token) return false;
    this.leases.delete(input.providerKey);
    this.providerCooldowns.set(input.providerKey, input.completedAtMs + input.providerCooldownMs);
    this.cooldowns.set(input.requestKey, input.completedAtMs + input.requestCooldownMs);
    return true;
  }
}

const command = {
  provider: 'footywire' as const,
  capabilityId: 'footywire-player-stats' as const,
  invocationSha256: 'a'.repeat(64),
  policy: {
    upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
    cacheSeconds: 86_400,
    maximumLeaseMs: 15 * 60 * 1_000,
    egressPolicyEvidenceId: `artifact:${'b'.repeat(64)}`,
  },
  nowMs: 1_000,
};

describe('fitzRoy distributed capture admission', () => {
  it('serializes a provider across workers while allowing a different provider', async () => {
    const redis = new FixtureRedis();
    let token = 0;
    const admission = createAflTradeRedisCaptureAdmission({
      redis,
      createToken: () => `lease-${++token}`,
    });

    const first = await admission.acquire(command);
    const competing = await admission.acquire({ ...command, invocationSha256: 'c'.repeat(64) });
    const otherProvider = await admission.acquire({
      ...command,
      provider: 'afl_tables',
      capabilityId: 'afl-tables-player-stats',
      invocationSha256: 'd'.repeat(64),
    });

    expect(first.status).toBe('admitted');
    if (first.status !== 'admitted') throw new Error('expected admission');
    expect(first.lease.providerKey).toContain('{footywire}');
    expect(first.lease.requestKey).toContain('{footywire}');
    expect(competing).toEqual({ status: 'deferred', retryAtMs: 901_000 });
    expect(otherProvider.status).toBe('admitted');
  });

  it('uses the approved cache period after success and only the request interval after failure', async () => {
    const redis = new FixtureRedis();
    let token = 0;
    const admission = createAflTradeRedisCaptureAdmission({
      redis,
      createToken: () => `lease-${++token}`,
    });

    const successful = await admission.acquire(command);
    if (successful.status !== 'admitted') throw new Error('expected admission');
    await admission.complete(successful.lease, { outcome: 'succeeded', completedAtMs: 2_000 });
    expect(
      await admission.acquire({ ...command, invocationSha256: 'f'.repeat(64), nowMs: 2_001 })
    ).toEqual({ status: 'deferred', retryAtMs: 5_000 });
    expect(await admission.acquire({ ...command, nowMs: 3_000 })).toEqual({
      status: 'deferred',
      retryAtMs: 86_402_000,
    });

    const failedRequest = { ...command, invocationSha256: 'e'.repeat(64), nowMs: 5_001 };
    const failed = await admission.acquire(failedRequest);
    if (failed.status !== 'admitted') throw new Error('expected admission');
    await admission.complete(failed.lease, { outcome: 'failed', completedAtMs: 6_000 });
    expect(await admission.acquire({ ...failedRequest, nowMs: 6_001 })).toEqual({
      status: 'deferred',
      retryAtMs: 9_000,
    });
  });

  it('fails closed when distributed coordination is unavailable or the upstream policy is invalid', async () => {
    const redis = new FixtureRedis();
    redis.unavailable = true;
    const admission = createAflTradeRedisCaptureAdmission({
      redis,
      createToken: () => 'lease-1',
    });

    await expect(admission.acquire(command)).rejects.toMatchObject({
      code: 'ADMISSION_UNAVAILABLE',
    } satisfies Partial<AflTradeFitzRoyCaptureAdmissionError>);
    await expect(
      admission.acquire({
        ...command,
        policy: { ...command.policy, upstreamRate: { requests: 0, perSeconds: 3, burst: 1 } },
      })
    ).rejects.toMatchObject({ code: 'INVALID_POLICY' });
  });
});
