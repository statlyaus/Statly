import { describe, expect, it } from 'vitest';

import { parseAflTradeExternalIngestionConfig } from '@/server/aflTradeIntelligence/runtime/externalDraftTradeIngestionConfig';

function env(): Record<string, string> {
  return {
    AFL_TRADE_CAPTURE_ENVIRONMENT: 'non_production',
    AFL_OUTCOMES_DATABASE_URL: 'postgresql://user:pass@localhost:5432/outcomes',
    AFL_TRADE_CAPTURE_REDIS_URL: 'redis://localhost:6379',
    AFL_TRADE_OBJECT_REGION: 'ap-southeast-2',
    AFL_TRADE_OBJECT_BUCKET: 'statly-afl-trade-captures',
    AFL_TRADE_OBJECT_PREFIX: 'external',
    AFL_TRADE_OBJECT_KMS_KEY_ID: 'kms-key',
    AFL_TRADE_CAPTURE_REPOSITORY_ID: 'external-capture',
    AFL_TRADE_CAPTURE_INFRASTRUCTURE_EVIDENCE_IDS: `artifact:${'a'.repeat(64)}`,
    AFL_TRADE_CAPTURE_ALLOWED_JURISDICTIONS: 'AU',
    AFL_TRADE_EXTERNAL_USER_AGENT: 'StatlyAFLTradeResearch/1.0 (contact: data@statly.test)',
    AFL_TRADE_EXTERNAL_TIMEOUT_MS: '15000',
    AFL_TRADE_EXTERNAL_MAX_SOURCE_BYTES: '2000000',
    AFL_TRADE_EXTERNAL_RAW_RETENTION_DAYS: '365',
    AFL_TRADE_EXTERNAL_SOURCE_POLICIES_JSON: JSON.stringify({
      draftguru: {
        requests: 1,
        perSeconds: 2,
        burst: 1,
        cacheSeconds: 300,
        maximumLeaseMs: 30000,
        egressPolicyEvidenceId: `artifact:${'b'.repeat(64)}`,
      },
      footywire: {
        requests: 1,
        perSeconds: 3,
        burst: 1,
        cacheSeconds: 300,
        maximumLeaseMs: 30000,
        egressPolicyEvidenceId: `artifact:${'c'.repeat(64)}`,
      },
      official_afl: {
        requests: 1,
        perSeconds: 2,
        burst: 1,
        cacheSeconds: 300,
        maximumLeaseMs: 30000,
        egressPolicyEvidenceId: `artifact:${'d'.repeat(64)}`,
      },
    }),
  };
}

describe('external AFL draft/trade ingestion configuration', () => {
  it('preserves an explicit non-production authority environment', () => {
    expect(parseAflTradeExternalIngestionConfig(env())).toMatchObject({
      environment: 'non_production',
      limits: { timeoutMs: 15000, maximumSourceBytes: 2000000, rawRetentionDays: 365 },
      providerPolicies: {
        draftguru: { upstreamRate: { requests: 1, perSeconds: 2, burst: 1 } },
      },
    });
  });

  it('preserves an explicit production authority environment', () => {
    const production = env();
    production.AFL_TRADE_CAPTURE_ENVIRONMENT = 'production';

    expect(parseAflTradeExternalIngestionConfig(production).environment).toBe('production');
  });

  it('fails closed when the authority environment is absent or unsupported', () => {
    const missing = env();
    delete missing.AFL_TRADE_CAPTURE_ENVIRONMENT;
    expect(() => parseAflTradeExternalIngestionConfig(missing)).toThrow(
      /AFL_TRADE_CAPTURE_ENVIRONMENT/
    );

    const fixture = env();
    fixture.AFL_TRADE_CAPTURE_ENVIRONMENT = 'test_fixture';
    expect(() => parseAflTradeExternalIngestionConfig(fixture)).toThrow();
  });

  it('fails closed when durable custody, contact identity, or one provider policy is absent', () => {
    const missingBucket = env();
    delete missingBucket.AFL_TRADE_OBJECT_BUCKET;
    expect(() => parseAflTradeExternalIngestionConfig(missingBucket)).toThrow(
      /AFL_TRADE_OBJECT_BUCKET/
    );

    const badAgent = env();
    badAgent.AFL_TRADE_EXTERNAL_USER_AGENT = 'Mozilla/5.0';
    expect(() => parseAflTradeExternalIngestionConfig(badAgent)).toThrow();

    const missingPolicy = env();
    const policies = JSON.parse(missingPolicy.AFL_TRADE_EXTERNAL_SOURCE_POLICIES_JSON) as Record<
      string,
      unknown
    >;
    delete policies.footywire;
    missingPolicy.AFL_TRADE_EXTERNAL_SOURCE_POLICIES_JSON = JSON.stringify(policies);
    expect(() => parseAflTradeExternalIngestionConfig(missingPolicy)).toThrow();
  });
});
