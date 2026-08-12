import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { AflTradeExternalIngestionConfig } from '@/server/aflTradeIntelligence/runtime/externalDraftTradeIngestionConfig';
import {
  createAflTradeExternalIngestionCustodyProfile,
  createAflTradeExternalIngestionRuntime,
} from '@/server/aflTradeIntelligence/runtime/externalDraftTradeIngestionRuntime';

function config(
  environment: AflTradeExternalIngestionConfig['environment']
): AflTradeExternalIngestionConfig {
  return {
    environment,
    databaseUrl: 'postgresql://user:pass@localhost:5432/outcomes',
    redisUrl: 'redis://localhost:6379',
    objectStorage: {
      region: 'ap-southeast-2',
      bucket: 'statly-afl-trade-captures',
      keyPrefix: 'external',
      kmsKeyId: 'kms-key',
      repositoryId: 'external-capture',
      infrastructureEvidenceIds: [`artifact:${'a'.repeat(64)}`],
      allowedJurisdictions: ['AU'],
    },
    userAgent: 'StatlyAFLTradeResearch/1.0 (contact: data@statly.test)',
    limits: { timeoutMs: 15000, maximumSourceBytes: 2000000, rawRetentionDays: 365 },
    providerPolicies: {
      draftguru: {
        upstreamRate: { requests: 1, perSeconds: 2, burst: 1 },
        cacheSeconds: 300,
        maximumLeaseMs: 30000,
        egressPolicyEvidenceId: `artifact:${'b'.repeat(64)}`,
      },
      footywire: {
        upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
        cacheSeconds: 300,
        maximumLeaseMs: 30000,
        egressPolicyEvidenceId: `artifact:${'c'.repeat(64)}`,
      },
      official_afl: {
        upstreamRate: { requests: 1, perSeconds: 2, burst: 1 },
        cacheSeconds: 300,
        maximumLeaseMs: 30000,
        egressPolicyEvidenceId: `artifact:${'d'.repeat(64)}`,
      },
    },
  };
}

describe('external AFL draft/trade ingestion runtime', () => {
  it('carries non-production authority into raw-source custody', () => {
    expect(
      createAflTradeExternalIngestionCustodyProfile(config('non_production')).content.environment
    ).toBe('non_production');
  });

  it('rejects a mismatched request environment before external activity', async () => {
    const runtime = createAflTradeExternalIngestionRuntime(config('non_production'));
    try {
      await expect(
        runtime.ingest({ request: { environment: 'production' } } as never)
      ).rejects.toThrow(/configured authority environment/);
    } finally {
      await runtime.close();
    }
  });
});
