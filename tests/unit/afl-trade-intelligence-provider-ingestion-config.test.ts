import { describe, expect, it } from 'vitest';

import { parseAflTradeProviderIngestionConfig } from '@/server/aflTradeIntelligence/runtime/providerIngestionConfig';

const sha = (value: string) => value.repeat(64);

function environment(): Record<string, string> {
  return {
    AFL_TRADE_CAPTURE_ENVIRONMENT: 'non_production',
    AFL_OUTCOMES_DATABASE_URL: 'postgresql://outcomes:secret@db.example.test/outcomes',
    AFL_TRADE_CAPTURE_REDIS_URL: 'rediss://capture:secret@redis.example.test:6380/0',
    AFL_TRADE_FITZROY_EGRESS_ENDPOINT: 'https://egress.example.test/v1/capture',
    AFL_TRADE_FITZROY_EGRESS_BEARER_TOKEN: 'task-scoped-bearer-token-value',
    AFL_TRADE_FITZROY_EGRESS_PUBLIC_KEYS_JSON: JSON.stringify({ worker: 'public-key-pem' }),
    AFL_TRADE_FITZROY_EGRESS_POLICY_EVIDENCE_IDS: `artifact:${sha('a')}`,
    AFL_TRADE_OBJECT_REGION: 'ap-southeast-2',
    AFL_TRADE_OBJECT_BUCKET: 'statly-afl-trade-evidence',
    AFL_TRADE_OBJECT_PREFIX: 'production/afl-trade',
    AFL_TRADE_OBJECT_KMS_KEY_ID: 'kms-key-id',
    AFL_TRADE_CAPTURE_REPOSITORY_ID: 'afl-trade-capture-production',
    AFL_TRADE_CAPTURE_INFRASTRUCTURE_EVIDENCE_IDS: `artifact:${sha('b')}`,
    AFL_TRADE_CAPTURE_ALLOWED_JURISDICTIONS: 'AU',
    AFL_TRADE_FITZROY_R_VERSION: '4.5.1',
    AFL_TRADE_FITZROY_LOCK_SHA256: sha('c'),
    AFL_TRADE_FITZROY_IMAGE_DIGEST: `sha256:${sha('d')}`,
    AFL_TRADE_FITZROY_RSCRIPT_PATH: '/opt/R/4.5.1/bin/Rscript',
    AFL_TRADE_FITZROY_CAPTURE_TIMEOUT_MS: '120000',
    AFL_TRADE_FITZROY_DECODER_TIMEOUT_MS: '120000',
    AFL_TRADE_FITZROY_MAX_SOURCE_BYTES: '134217728',
    AFL_TRADE_FITZROY_MAX_DIAGNOSTICS_BYTES: '1048576',
    AFL_TRADE_FITZROY_MAX_ROWS: '1000000',
    AFL_TRADE_FITZROY_MAX_FIELDS: '500',
    AFL_TRADE_FITZROY_MAX_CELLS: '50000000',
    AFL_TRADE_FITZROY_MAX_CELL_BYTES: '65536',
    AFL_TRADE_FITZROY_MAX_OUTPUT_BYTES: '268435456',
    AFL_TRADE_FITZROY_RAW_RETENTION_DAYS: '365',
    AFL_TRADE_FITZROY_METADATA_RETENTION_DAYS: '2555',
  };
}

describe('provider-ingestion deployed configuration', () => {
  it('parses every isolated runtime dependency from an injected environment record', () => {
    const config = parseAflTradeProviderIngestionConfig(environment());

    expect(config.environment).toBe('non_production');
    expect(config.runtimeIdentity).toEqual({
      rVersion: '4.5.1',
      dependencyLockSha256: sha('c'),
      imageDigest: `sha256:${sha('d')}`,
    });
    expect(config.objectStorage).toMatchObject({
      region: 'ap-southeast-2',
      repositoryId: 'afl-trade-capture-production',
      allowedJurisdictions: ['AU'],
    });
    expect(config.limits.maximumSourceBytes).toBe(134_217_728);
    expect(config.egressPublicKeys).toEqual({ worker: 'public-key-pem' });
  });

  it.each([
    [
      'missing environment',
      (env: Record<string, string>) => delete env.AFL_TRADE_CAPTURE_ENVIRONMENT,
    ],
    [
      'fixture environment',
      (env: Record<string, string>) => (env.AFL_TRADE_CAPTURE_ENVIRONMENT = 'test_fixture'),
    ],
    ['missing database', (env: Record<string, string>) => delete env.AFL_OUTCOMES_DATABASE_URL],
    [
      'insecure endpoint',
      (env: Record<string, string>) => (env.AFL_TRADE_FITZROY_EGRESS_ENDPOINT = 'http://worker'),
    ],
    [
      'invalid image digest',
      (env: Record<string, string>) => (env.AFL_TRADE_FITZROY_IMAGE_DIGEST = 'latest'),
    ],
    [
      'duplicate evidence',
      (env: Record<string, string>) =>
        (env.AFL_TRADE_FITZROY_EGRESS_POLICY_EVIDENCE_IDS = `artifact:${sha('a')},artifact:${sha('a')}`),
    ],
    [
      'zero byte bound',
      (env: Record<string, string>) => (env.AFL_TRADE_FITZROY_MAX_SOURCE_BYTES = '0'),
    ],
  ])('rejects %s', (_name, mutate) => {
    const env = environment();
    mutate(env);
    expect(() => parseAflTradeProviderIngestionConfig(env)).toThrow();
  });
});
