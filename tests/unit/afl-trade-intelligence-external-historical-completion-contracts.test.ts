import { describe, expect, it } from 'vitest';

import {
  createAflTradeExternalDiscoveryInventory,
  createAflTradeExternalHistoricalCapturePlan,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { createAflTradeExternalHistoricalCaptureCompletion } from '@/server/aflTradeIntelligence/source/externalHistoricalCaptureCompletionContracts';

const sha = (character: string) => character.repeat(64);

function plan() {
  const inventory = createAflTradeExternalDiscoveryInventory({
    schemaVersion: 'afl-trade-external-discovery-inventory/v1',
    environment: 'test_fixture',
    provider: 'draftguru',
    competition: 'AFLM',
    sourceCaptureId: `source-capture:${sha('a')}`,
    sourceEvidenceBatchId: `external-evidence-batch:${sha('b')}`,
    sourceContentSha256: sha('c'),
    sourceUrl: 'https://www.draftguru.com.au/trades',
    fromYear: 2025,
    throughYear: 2025,
    links: [
      {
        ordinal: 1,
        evidenceId: `external-evidence:${sha('d')}`,
        anchorSeasonYear: 2025,
        nativeEventId: '2025-example-trade',
        sourceUrl: 'https://www.draftguru.com.au/trades/2025-example-trade',
      },
    ],
    discoveredAt: '2026-08-10T00:00:00.000Z',
    completeForCapturedIndex: true,
    publicationEligible: false,
  });
  return createAflTradeExternalHistoricalCapturePlan({
    inventory,
    plannedAt: '2026-08-10T00:01:00.000Z',
    parserVersions: { tradeDetail: 'trade/v1', yearPage: 'year/v1' },
    datasetVersions: { tradeDetail: 'trade-2026-08-10', yearPage: 'year-2026-08-10' },
    fieldManifestSha256: { tradeDetail: sha('e'), yearPage: sha('f') },
    authorities: {
      tradeDetail: {
        rightsArtifactId: `source-rights:${sha('1')}`,
        fieldUses: [{ sourceField: 'trade_id', use: 'archive_fact' }],
        cacheSeconds: 86_400,
        rawRetentionDays: 365,
      },
      yearPage: {
        rightsArtifactId: `source-rights:${sha('2')}`,
        fieldUses: [{ sourceField: 'selection_number', use: 'archive_fact' }],
        cacheSeconds: 86_400,
        rawRetentionDays: 365,
      },
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
  });
}

function completionInput() {
  const sourcePlan = plan();
  return {
    plan: sourcePlan,
    completedAt: '2026-08-10T00:10:00.000Z',
    results: sourcePlan.content.targets.map((target, index) => ({
      ordinal: target.content.ordinal,
      targetId: target.targetId,
      scheduleId: target.content.schedule.scheduleId,
      dispatchKey: `external-capture-dispatch:${sha(String(index + 3))}`,
      occurrenceEventId: `external-capture-occurrence-event:${sha(String(index + 5))}`,
      occurrenceRevision: 2,
      captureMode: index === 0 ? ('captured' as const) : ('not_modified' as const),
      resultId:
        index === 0
          ? `external-evidence-batch:${sha(String(index + 7))}`
          : `source-capture-attempt:${sha(String(index + 7))}`,
      captureId: `source-capture:${sha(index === 0 ? '9' : 'a')}`,
      evidenceBatchId: `external-evidence-batch:${sha(String(index + 7))}`,
      evidenceBatchSha256: sha(String(index + 7)),
      evidenceCount: 4 + index,
      finalizedAt: `2026-08-10T00:0${5 + index}:00.000Z`,
    })),
  };
}

describe('external historical capture completion contracts', () => {
  it('seals every planned target to one exact finalized evidence batch', () => {
    const result = createAflTradeExternalHistoricalCaptureCompletion(completionInput());

    expect(result.completionId).toMatch(/^external-historical-capture-completion:[a-f0-9]{64}$/);
    expect(result.content.targetCount).toBe(2);
    expect(result.content.sourceBatchIds).toEqual(
      result.content.results.map(({ evidenceBatchId }) => evidenceBatchId)
    );
    expect(result.content.status).toBe('complete');
    expect(result.content.reconciliationEligible).toBe(true);
    expect(result.content.publicationEligible).toBe(false);
  });

  it('rejects missing, reordered, or substituted target results', () => {
    const input = completionInput();
    expect(() =>
      createAflTradeExternalHistoricalCaptureCompletion({
        ...input,
        results: input.results.slice(0, 1),
      })
    ).toThrow();
    expect(() =>
      createAflTradeExternalHistoricalCaptureCompletion({
        ...input,
        results: [...input.results].reverse(),
      })
    ).toThrow();
    expect(() =>
      createAflTradeExternalHistoricalCaptureCompletion({
        ...input,
        results: [{ ...input.results[0], targetId: input.results[1]!.targetId }, input.results[1]!],
      })
    ).toThrow();
  });

  it('rejects duplicate batches and invalid captured-versus-304 result identities', () => {
    const input = completionInput();
    expect(() =>
      createAflTradeExternalHistoricalCaptureCompletion({
        ...input,
        results: [
          input.results[0]!,
          { ...input.results[1], evidenceBatchId: input.results[0]!.evidenceBatchId },
        ],
      })
    ).toThrow();
    expect(() =>
      createAflTradeExternalHistoricalCaptureCompletion({
        ...input,
        results: [
          { ...input.results[0], resultId: `source-capture-attempt:${sha('a')}` },
          input.results[1]!,
        ],
      })
    ).toThrow();
    expect(() =>
      createAflTradeExternalHistoricalCaptureCompletion({
        ...input,
        results: [{ ...input.results[0], captureMode: 'not_modified' }, input.results[1]!],
      })
    ).toThrow();
  });

  it('rejects evidence finalized after the completion instant', () => {
    const input = completionInput();
    expect(() =>
      createAflTradeExternalHistoricalCaptureCompletion({
        ...input,
        results: [
          { ...input.results[0], finalizedAt: '2026-08-10T00:11:00.000Z' },
          input.results[1]!,
        ],
      })
    ).toThrow();
  });
});
