import { describe, expect, it, vi } from 'vitest';

import {
  createAflTradeExternalCaptureAdmission,
  type AflTradeExternalCaptureAdmissionRedis,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeCaptureAdmission';

const policy = {
  upstreamRate: { requests: 1, perSeconds: 2, burst: 1 },
  cacheSeconds: 300,
  maximumLeaseMs: 30_000,
  egressPolicyEvidenceId: `artifact:${'a'.repeat(64)}`,
};

describe('external AFL draft/trade capture admission', () => {
  it('uses one Redis Cluster slot per provider and applies reviewed cooldowns', async () => {
    const acquire = vi.fn(async () => ({ acquired: true as const, expiresAtMs: 31_000 }));
    const complete = vi.fn(async () => true);
    const redis: AflTradeExternalCaptureAdmissionRedis = { acquire, complete };
    const admission = createAflTradeExternalCaptureAdmission({
      redis,
      createToken: () => 'lease-token',
    });

    const result = await admission.acquire({
      provider: 'draftguru',
      capabilityId: 'draftguru-trade-detail',
      requestSha256: 'b'.repeat(64),
      policy,
      nowMs: 1_000,
    });

    expect(result.status).toBe('admitted');
    if (result.status !== 'admitted') throw new Error('expected admitted lease');
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKey: 'afl-trade:external-capture:{draftguru}:provider',
        requestKey:
          `afl-trade:external-capture:{draftguru}:request:draftguru-trade-detail:${'b'.repeat(64)}`,
      })
    );

    await admission.complete(result.lease, { outcome: 'succeeded', completedAtMs: 2_000 });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ providerCooldownMs: 2_000, requestCooldownMs: 300_000 })
    );
  });

  it('fails closed on invalid policy or a lost lease', async () => {
    const redis: AflTradeExternalCaptureAdmissionRedis = {
      acquire: vi.fn(async () => ({ acquired: true as const, expiresAtMs: 31_000 })),
      complete: vi.fn(async () => false),
    };
    const admission = createAflTradeExternalCaptureAdmission({
      redis,
      createToken: () => 'lease-token',
    });

    await expect(
      admission.acquire({
        provider: 'footywire',
        capabilityId: 'footywire-draft-results',
        requestSha256: 'c'.repeat(64),
        policy: { ...policy, cacheSeconds: 0 },
        nowMs: 1_000,
      })
    ).rejects.toMatchObject({ code: 'INVALID_POLICY' });

    const admitted = await admission.acquire({
      provider: 'footywire',
      capabilityId: 'footywire-draft-results',
      requestSha256: 'c'.repeat(64),
      policy,
      nowMs: 1_000,
    });
    if (admitted.status !== 'admitted') throw new Error('expected admitted lease');
    await expect(
      admission.complete(admitted.lease, { outcome: 'failed', completedAtMs: 2_000 })
    ).rejects.toMatchObject({ code: 'LEASE_LOST' });
  });
});
