import { describe, expect, it, vi } from 'vitest';

import { runAflTradeExternalHistoricalDiscoveryCommand } from '../../Scripts/discover-external-draft-trade-history';
import { createAflTradeExternalDiscoveryInventory } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';

const sha = (character: string) => character.repeat(64);
const now = '2026-08-10T00:00:00.000Z';

const env = {
  AFL_TRADE_CAPTURE_ENVIRONMENT: 'non_production',
  AFL_OUTCOMES_DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
  AFL_TRADE_CAPTURE_REDIS_URL: 'redis://127.0.0.1:6379',
  AFL_TRADE_OBJECT_REGION: 'ap-southeast-2',
  AFL_TRADE_OBJECT_BUCKET: 'statly-test-artifacts',
  AFL_TRADE_OBJECT_PREFIX: 'afl-trade',
  AFL_TRADE_OBJECT_KMS_KEY_ID: 'test-kms-key',
  AFL_TRADE_CAPTURE_REPOSITORY_ID: 'test-repository',
  AFL_TRADE_CAPTURE_INFRASTRUCTURE_EVIDENCE_IDS: `artifact:${sha('8')}`,
  AFL_TRADE_CAPTURE_ALLOWED_JURISDICTIONS: 'AU',
  AFL_TRADE_EXTERNAL_USER_AGENT: 'Statly AFL trade evidence (contact: test@example.com)',
  AFL_TRADE_EXTERNAL_TIMEOUT_MS: '30000',
  AFL_TRADE_EXTERNAL_MAX_SOURCE_BYTES: '2000000',
  AFL_TRADE_EXTERNAL_RAW_RETENTION_DAYS: '365',
  AFL_TRADE_EXTERNAL_SOURCE_POLICIES_JSON: JSON.stringify({
    draftguru: {
      requests: 1,
      perSeconds: 3,
      burst: 1,
      cacheSeconds: 86400,
      maximumLeaseMs: 300000,
      egressPolicyEvidenceId: `artifact:${sha('7')}`,
    },
    footywire: {
      requests: 1,
      perSeconds: 3,
      burst: 1,
      cacheSeconds: 86400,
      maximumLeaseMs: 300000,
      egressPolicyEvidenceId: `artifact:${sha('6')}`,
    },
    official_afl: {
      requests: 1,
      perSeconds: 3,
      burst: 1,
      cacheSeconds: 86400,
      maximumLeaseMs: 300000,
      egressPolicyEvidenceId: `artifact:${sha('5')}`,
    },
  }),
} as const;

function reviewedInput(environment: 'non_production' | 'production' = 'non_production') {
  const authority = (character: string, sourceField: string) => ({
    rightsArtifactId: `source-rights:${sha(character)}`,
    fieldUses: [{ sourceField, use: 'archive_fact' }],
    cacheSeconds: 86_400,
    rawRetentionDays: 365,
  });
  return {
    index: {
      request: {
        environment,
        provider: 'draftguru',
        competition: 'AFLM',
        anchorSeasonYear: 2025,
        discoveryFromSeasonYear: 2024,
        draftPathway: null,
        dataset: 'Draftguru AFL trade index',
        datasetVersion: 'draftguru-2026-08-10',
        accessMechanism: 'automated_web',
        capabilityId: 'draftguru-trade-index',
        sourceUrl: 'https://www.draftguru.com.au/trades',
        effectiveAt: now,
        parserVersion: 'draftguru-trade-index/v1',
        fieldManifestSha256: sha('1'),
        maximumBytes: 2_000_000,
      },
      gateRequest: {
        decisionKey: `draftguru-trade-index-${environment}`,
        environment,
        rightsArtifactId: `source-rights:${sha('2')}`,
        competition: 'AFLM',
        season: 2025,
        accessMechanism: 'automated_web',
        capabilityId: null,
        geography: 'global',
        commercialContext: 'public-research',
        audience: 'public',
        operations: ['bounded_evaluation_capture', 'raw_evidence_retention'],
        fieldUses: [{ sourceField: 'trade_detail_link.sourceUrl', use: 'archive_fact' }],
        rawRetentionDays: 365,
        metadataRetentionDays: null,
        cacheSeconds: 86_400,
      },
    },
    plan: {
      plannedAt: '2026-08-10T00:01:00.000Z',
      parserVersions: {
        tradeDetail: 'draftguru-trade-detail/v1',
        yearPage: 'draftguru-year-page/v1',
      },
      datasetVersions: {
        tradeDetail: 'draftguru-2026-08-10',
        yearPage: 'draftguru-2026-08-10',
      },
      fieldManifestSha256: { tradeDetail: sha('3'), yearPage: sha('4') },
      authorities: {
        tradeDetail: authority('a', 'transaction.nativeEventId'),
        yearPage: authority('b', 'draft_selection.selectionNumber'),
      },
      execution: {
        maximumAttempts: 5,
        leaseSeconds: 300,
        retryBaseSeconds: 30,
        retryMaximumSeconds: 3_600,
        maximumLatenessSeconds: 2_592_000,
        circuitFailureThreshold: 5,
        circuitResetSeconds: 900,
      },
      maximumBytes: 2_000_000,
    },
  };
}

describe('external historical discovery command', () => {
  it('captures the index and persists the exact inventory and plan without publishing', async () => {
    const inventory = createAflTradeExternalDiscoveryInventory({
      schemaVersion: 'afl-trade-external-discovery-inventory/v1',
      environment: 'non_production',
      provider: 'draftguru',
      competition: 'AFLM',
      sourceCaptureId: `source-capture:${sha('c')}`,
      sourceEvidenceBatchId: `external-evidence-batch:${sha('d')}`,
      sourceContentSha256: sha('e'),
      sourceUrl: 'https://www.draftguru.com.au/trades',
      fromYear: 2024,
      throughYear: 2025,
      links: [
        {
          ordinal: 1,
          evidenceId: `external-evidence:${sha('f')}`,
          anchorSeasonYear: 2025,
          nativeEventId: '2025-alpha-trade',
          sourceUrl: 'https://www.draftguru.com.au/trades/2025-alpha-trade',
        },
      ],
      discoveredAt: now,
      completeForCapturedIndex: true,
      publicationEligible: false,
    });
    const ingest = vi.fn().mockResolvedValue({
      status: 'completed',
      result: {
        status: 'staged',
        captureId: inventory.content.sourceCaptureId,
        artifactId: `artifact:${sha('e')}`,
        batchId: inventory.content.sourceEvidenceBatchId,
        evidenceCount: 1,
        issueCount: 0,
        idempotentReplay: false,
      },
    });
    const persistPlan = vi.fn(async (plan) => ({
      planId: plan.planId,
      targetCount: plan.content.targetCount,
      idempotentReplay: false,
    }));
    const findLatestFinalizedIndexBatch = vi
      .fn()
      .mockResolvedValue(inventory.content.sourceEvidenceBatchId);
    const output = await runAflTradeExternalHistoricalDiscoveryCommand({
      argv: ['--input', 'reviewed.json'],
      env,
      readInput: async () => JSON.stringify(reviewedInput()),
      now: () => now,
      createRuntime: () => ({ ingest, close: vi.fn().mockResolvedValue(undefined) }),
      createPool: () => ({ end: vi.fn().mockResolvedValue(undefined) }) as never,
      createRepository: () => ({
        findLatestFinalizedIndexBatch,
        loadInventoryFromBatch: vi.fn().mockResolvedValue(inventory),
        persistInventory: vi.fn().mockResolvedValue({
          inventoryId: inventory.inventoryId,
          linkCount: 1,
          idempotentReplay: false,
        }),
        persistPlan,
      }),
      writeOutput: vi.fn(),
    });

    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          capabilityId: 'draftguru-trade-index',
          discoveryFromSeasonYear: 2024,
        }),
      })
    );
    expect(findLatestFinalizedIndexBatch).toHaveBeenCalledWith({
      environment: 'non_production',
      fromYear: 2024,
      throughYear: 2025,
    });
    expect(persistPlan.mock.calls[0]?.[0].content.targets).toHaveLength(3);
    expect(output).toMatchObject({
      status: 'planned',
      batchId: inventory.content.sourceEvidenceBatchId,
      plan: { targetCount: 3 },
    });
    expect(JSON.stringify(output)).not.toMatch(/release|publication|valuation/i);
  });

  it('does not create a plan while provider admission is deferred', async () => {
    const repositoryFactory = vi.fn();
    const output = await runAflTradeExternalHistoricalDiscoveryCommand({
      argv: ['--input', 'reviewed.json'],
      env,
      readInput: async () => JSON.stringify(reviewedInput()),
      now: () => now,
      createRuntime: () => ({
        ingest: vi.fn().mockResolvedValue({
          status: 'deferred',
          retryAt: '2026-08-10T00:02:00.000Z',
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      createPool: () => ({ end: vi.fn().mockResolvedValue(undefined) }) as never,
      createRepository: repositoryFactory,
      writeOutput: vi.fn(),
    });

    expect(output).toEqual({ status: 'deferred', retryAt: '2026-08-10T00:02:00.000Z' });
    expect(repositoryFactory).toHaveBeenCalledOnce();
  });

  it('rejects discovery authority that does not match the configured environment', async () => {
    const createRuntime = vi.fn();
    const createPool = vi.fn();

    await expect(
      runAflTradeExternalHistoricalDiscoveryCommand({
        argv: ['--input', 'reviewed.json'],
        env,
        readInput: async () => JSON.stringify(reviewedInput('production')),
        now: () => now,
        createRuntime,
        createPool,
      })
    ).rejects.toThrow(/configured authority environment/);
    expect(createRuntime).not.toHaveBeenCalled();
    expect(createPool).not.toHaveBeenCalled();
  });
});
