import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

vi.mock('server-only', () => ({}));

import type { AflTradeProviderIngestionConfig } from '@/server/aflTradeIntelligence/runtime/providerIngestionConfig';
import {
  createAflTradeProviderIngestionCustodyProfile,
  createAflTradeProviderIngestionRuntime,
} from '@/server/aflTradeIntelligence/runtime/providerIngestionRuntime';

function config(
  environment: AflTradeProviderIngestionConfig['environment']
): AflTradeProviderIngestionConfig {
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({
    type: 'spki',
    format: 'pem',
  });
  return {
    environment,
    databaseUrl: 'postgresql://user:pass@localhost:5432/outcomes',
    redisUrl: 'redis://localhost:6379',
    egressEndpoint: 'https://egress.example.test/v1/capture',
    egressBearerToken: 'task-scoped-bearer-token-value',
    egressPublicKeys: { worker: publicKey },
    egressPolicyEvidenceIds: [`artifact:${'a'.repeat(64)}`],
    objectStorage: {
      region: 'ap-southeast-2',
      bucket: 'statly-afl-trade-captures',
      keyPrefix: 'fitzroy',
      kmsKeyId: 'kms-key',
      repositoryId: 'fitzroy-capture',
      infrastructureEvidenceIds: [`artifact:${'b'.repeat(64)}`],
      allowedJurisdictions: ['AU'],
    },
    runtimeIdentity: {
      rVersion: '4.5.1',
      dependencyLockSha256: 'c'.repeat(64),
      imageDigest: `sha256:${'d'.repeat(64)}`,
    },
    rscriptPath: '/opt/R/4.5.1/bin/Rscript',
    limits: {
      captureTimeoutMs: 120_000,
      decoderTimeoutMs: 120_000,
      maximumSourceBytes: 134_217_728,
      maximumDiagnosticsBytes: 1_048_576,
      maximumRows: 1_000_000,
      maximumFields: 500,
      maximumCells: 50_000_000,
      maximumCellBytes: 65_536,
      maximumOutputBytes: 268_435_456,
      rawRetentionDays: 365,
      metadataRetentionDays: 2_555,
    },
  };
}

describe('fitzRoy provider ingestion runtime', () => {
  it('carries non-production authority into both custody profiles', () => {
    const nonProduction = config('non_production');

    expect(
      createAflTradeProviderIngestionCustodyProfile(nonProduction, {
        artifactClass: 'raw_source',
        maximumObjectBytes: nonProduction.limits.maximumSourceBytes,
        retentionDays: nonProduction.limits.rawRetentionDays,
      }).content.environment
    ).toBe('non_production');
    expect(
      createAflTradeProviderIngestionCustodyProfile(nonProduction, {
        artifactClass: 'capture_metadata',
        maximumObjectBytes: nonProduction.limits.maximumOutputBytes,
        retentionDays: nonProduction.limits.metadataRetentionDays,
      }).content.environment
    ).toBe('non_production');
  });

  it('rejects a mismatched Gate environment before durable or provider activity', async () => {
    const runtime = createAflTradeProviderIngestionRuntime(config('non_production'));
    try {
      await expect(
        runtime.ingest({ capture: { gateRequest: { environment: 'production' } } } as never)
      ).rejects.toThrow(/configured authority environment/);
    } finally {
      await runtime.close();
    }
  });
});
