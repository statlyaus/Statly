import { describe, expect, it, vi } from 'vitest';

import { runAflTradeFitzRoyProviderIngestionCommand } from '../../Scripts/ingest-fitzroy-provider-season';
import type { AflTradeProviderIngestionRuntime } from '@/server/aflTradeIntelligence/runtime/providerIngestionRuntime';

const sha = (value: string) => value.repeat(64);

function environment(): Record<string, string> {
  return {
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

function command(season = 2026) {
  return {
    capture: {
      gateRequest: {
        decisionKey: 'footywire-player-stats-production',
        environment: 'production',
        rightsArtifactId: `source-rights:${sha('1')}`,
        competition: 'AFLM',
        season,
        accessMechanism: 'automated_web',
        capabilityId: 'footywire-player-stats',
        geography: 'global',
        commercialContext: 'public-research',
        audience: 'public',
        operations: ['bounded_evaluation_capture', 'public_fact_display'],
        fieldUses: [{ sourceField: 'Player', use: 'public_display' }],
        rawRetentionDays: 365,
        metadataRetentionDays: null,
        cacheSeconds: 86_400,
      },
      captureRequest: {
        schemaVersion: 'afl-trade-fitzroy-capture-request/v1',
        capabilityId: 'footywire-player-stats',
        competition: 'AFLM',
        authorizationSeason: 2026,
        parameters: { season: 2026, checkExisting: true },
      },
    },
    fieldMapId: 'footywire-player-stats-2026-reviewed',
    fieldMap: {
      schemaVersion: 'afl-trade-fitzroy-field-map/v1',
      mapId: 'footywire-player-stats-2026-reviewed',
      capabilityId: 'footywire-player-stats',
      fitzRoyVersion: '1.7.0',
      sourceSchemaSha256: sha('2'),
      exactOrderedFields: ['Player'],
      observationKind: 'player_identity',
      competition: 'AFLM',
      invocationArgumentsSha256: sha('3'),
      validFromSeason: 2026,
      validThroughSeason: 2026,
      seasonField: null,
      roundLabelField: null,
      observedDateField: null,
      naturalKeyFields: ['Player'],
      approvedAt: '2026-08-08T00:00:00.000Z',
      approvalDecisionId: 'footywire-player-stats-map-review',
      identity: {
        nativeId: null,
        recordedName: { sourceField: 'Player', required: true },
        recordedClubNativeId: null,
        recordedClubName: null,
      },
      match: null,
      metrics: [],
      achievement: null,
    },
    effectiveAt: '2026-08-08T00:01:00.000Z',
  };
}

describe('fitzRoy provider season ingestion command', () => {
  it('validates the reviewed envelope, emits stable IDs, and always closes the runtime', async () => {
    const result = {
      receipt: { captureReceiptId: `fitzroy-capture:${sha('4')}` },
      snapshotId: `source-snapshot:${sha('5')}`,
      staging: {
        capture: { captureId: `source-capture:${sha('6')}`, idempotentReplay: false },
        normalization: {
          normalizationRunId: `provider-normalization:${sha('7')}`,
          status: 'accepted',
          idempotentReplay: false,
        },
      },
    };
    const runtime = {
      ingest: vi.fn(async () => result as never),
      close: vi.fn(async () => undefined),
    } satisfies AflTradeProviderIngestionRuntime;
    const output: string[] = [];

    const response = await runAflTradeFitzRoyProviderIngestionCommand({
      argv: ['--input', '/reviewed/footywire-2026.json'],
      env: environment(),
      readInput: async () => JSON.stringify(command()),
      writeOutput: (line) => output.push(line),
      createRuntime: () => runtime,
    });

    expect(runtime.ingest).toHaveBeenCalledOnce();
    expect(runtime.close).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      captureReceiptId: result.receipt.captureReceiptId,
      snapshotId: result.snapshotId,
      normalizationStatus: 'accepted',
      idempotentReplay: false,
    });
    expect(JSON.parse(output[0] ?? '{}')).toEqual(response);
  });

  it('rejects a Gate/capture season mismatch before constructing runtime dependencies', async () => {
    const createRuntime = vi.fn();

    await expect(
      runAflTradeFitzRoyProviderIngestionCommand({
        argv: ['--input', '/reviewed/mismatched.json'],
        env: environment(),
        readInput: async () => JSON.stringify(command(2025)),
        createRuntime,
      })
    ).rejects.toThrow('same capability scope');
    expect(createRuntime).not.toHaveBeenCalled();
  });
});
