import { describe, expect, it, vi } from 'vitest';

import { runAflTradeExternalIngestionCommand } from '../../Scripts/ingest-external-draft-trade-page';

const artifact = (letter: string) => `artifact:${letter.repeat(64)}`;
const env = {
  AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture',
  AFL_TRADE_CAPTURE_REDIS_URL: 'redis://127.0.0.1:6379',
  AFL_TRADE_OBJECT_REGION: 'ap-southeast-2',
  AFL_TRADE_OBJECT_BUCKET: 'fixture-bucket',
  AFL_TRADE_OBJECT_PREFIX: 'afl-trade',
  AFL_TRADE_OBJECT_KMS_KEY_ID: 'fixture-kms-key',
  AFL_TRADE_CAPTURE_REPOSITORY_ID: 'fixture-external-capture',
  AFL_TRADE_CAPTURE_INFRASTRUCTURE_EVIDENCE_IDS: artifact('a'),
  AFL_TRADE_CAPTURE_ALLOWED_JURISDICTIONS: 'AU',
  AFL_TRADE_EXTERNAL_USER_AGENT: 'Statly AFL trade evidence capture (contact: data@example.com)',
  AFL_TRADE_EXTERNAL_TIMEOUT_MS: '30000',
  AFL_TRADE_EXTERNAL_MAX_SOURCE_BYTES: '1000000',
  AFL_TRADE_EXTERNAL_RAW_RETENTION_DAYS: '365',
  AFL_TRADE_EXTERNAL_SOURCE_POLICIES_JSON: JSON.stringify({
    draftguru: {
      requests: 1,
      perSeconds: 3,
      burst: 1,
      cacheSeconds: 86400,
      maximumLeaseMs: 60000,
      egressPolicyEvidenceId: artifact('b'),
    },
    footywire: {
      requests: 1,
      perSeconds: 3,
      burst: 1,
      cacheSeconds: 86400,
      maximumLeaseMs: 60000,
      egressPolicyEvidenceId: artifact('c'),
    },
    official_afl: {
      requests: 1,
      perSeconds: 5,
      burst: 1,
      cacheSeconds: 3600,
      maximumLeaseMs: 60000,
      egressPolicyEvidenceId: artifact('d'),
    },
  }),
};

function command(provider = 'draftguru', capabilityId = 'draftguru-trade-detail') {
  return JSON.stringify({
    request: {
      environment: 'production',
      provider,
      competition: 'AFLM',
      anchorSeasonYear: 2026,
      draftPathway: null,
      dataset: 'Draftguru AFL trade transaction detail',
      datasetVersion: '2026-08-09',
      accessMechanism: 'automated_web',
      capabilityId,
      sourceUrl: 'https://www.draftguru.com.au/trades/2026-fixture',
      effectiveAt: '2026-08-09T00:00:00.000Z',
      parserVersion: 'draftguru-trade-parser/v1',
      fieldManifestSha256: 'f'.repeat(64),
      maximumBytes: 1000000,
    },
    gateRequest: {
      decisionKey: `${capabilityId}-production`,
      environment: 'production',
      rightsArtifactId: `source-rights:${'e'.repeat(64)}`,
      competition: 'AFLM',
      season: 2026,
      accessMechanism: 'automated_web',
      capabilityId: null,
      geography: 'global',
      commercialContext: 'public-research',
      audience: 'public',
      operations: ['bounded_evaluation_capture', 'raw_evidence_retention'],
      fieldUses: [{ sourceField: 'trade_id', use: 'archive_fact' }],
      rawRetentionDays: 365,
      metadataRetentionDays: null,
      cacheSeconds: 86400,
    },
  });
}

describe('external source ingestion command', () => {
  it('derives capture time from the trusted command clock and closes the runtime', async () => {
    const ingest = vi.fn(async () => ({
      status: 'completed' as const,
      result: {
        status: 'staged' as const,
        captureId: 'capture-1',
        artifactId: 'artifact-1',
        batchId: 'batch-1',
        evidenceCount: 1,
        issueCount: 0,
        idempotentReplay: false,
      },
    }));
    const close = vi.fn(async () => undefined);

    const result = await runAflTradeExternalIngestionCommand({
      argv: ['--input', '/reviewed/input.json'],
      env,
      readInput: async () => command(),
      now: () => '2026-08-10T01:02:03.000Z',
      createRuntime: () => ({ ingest, close }),
      writeOutput: () => undefined,
    });

    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ capturedAt: '2026-08-10T01:02:03.000Z' }),
        gateRequest: expect.objectContaining({ evaluatedAt: '2026-08-10T01:02:03.000Z' }),
      })
    );
    expect(result).toMatchObject({ captureStatus: 'staged', captureId: 'capture-1' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects provider/capability substitution before constructing the runtime', async () => {
    const createRuntime = vi.fn();

    await expect(
      runAflTradeExternalIngestionCommand({
        argv: ['--input', '/reviewed/input.json'],
        env,
        readInput: async () => command('official_afl', 'draftguru-trade-detail'),
        now: () => '2026-08-10T01:02:03.000Z',
        createRuntime,
      })
    ).rejects.toThrow(/provider must match/);
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it('requires the isolated production configuration with no fallback', async () => {
    await expect(
      runAflTradeExternalIngestionCommand({
        argv: ['--input', '/reviewed/input.json'],
        env: {},
        readInput: async () => command(),
      })
    ).rejects.toThrow(/AFL_OUTCOMES_DATABASE_URL/);
  });
});
