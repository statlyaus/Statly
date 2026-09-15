import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion', () => ({
  ingestAuthorizedAflTradeExternalPage: async (
    command: { request: { sourceUrl: string; parserVersion: string } },
    dependencies: { ingestion: { parsePage: (input: unknown) => unknown } }
  ) =>
    dependencies.ingestion.parsePage({
      html: '<article>unverified bytes</article>',
      capture: {
        sourceUrl: command.request.sourceUrl,
        parserVersion: command.request.parserVersion,
        mediaType: 'text/html',
        contentSha256: '0'.repeat(64),
      },
    }),
}));

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

// Exercise the dispatch installed by the real runtime, including the real parser's
// byte rejection. No provider, database, Redis or object-store activity is needed.
it.each([
  [
    'continuity',
    'https://www.hawthornfc.com.au/news/412198/hale-calls-time-on-decorated-career',
    2013,
  ],
  ['departure', 'https://www.westernbulldogs.com.au/news/752883/sherman-seeks-new-home', 2012],
])(
  'dispatches admitted player %s captures to the bounded parser',
  async (kind, sourceUrl, year) => {
    const runtime = createAflTradeExternalIngestionRuntime(config('non_production'));
    try {
      await expect(
        runtime.ingest({
          request: {
            environment: 'non_production',
            maximumBytes: 1000,
            effectiveAt: '2026-09-01T00:00:00.000Z',
            capabilityId: `official-afl-player-${kind}`,
            sourceUrl,
            parserVersion: `official-afl-player-${kind}/v1`,
            anchorSeasonYear: year,
          },
        } as never)
      ).rejects.toThrow(/exact reviewed/);
    } finally {
      await runtime.close();
    }
  }
);
