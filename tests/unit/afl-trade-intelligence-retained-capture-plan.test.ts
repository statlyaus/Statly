import { expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeRetainedExternalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { createAflTradeRetainedExternalCaptureCompletion } from '@/server/aflTradeIntelligence/source/externalHistoricalCaptureCompletionContracts';
const at = '2026-09-10T00:00:00.000Z';
const id = (kind: string, letter: string) => `${kind}:${letter.repeat(64)}`;
const target = {
  captureId: id('source-capture', 'a'),
  evidenceBatchId: id('external-evidence-batch', 'b'),
  executionReceiptId: id('external-capture-execution', 'c'),
  rightsArtifactId: id('source-rights', 'd'),
  gateDecisionId: id('gate-decision', 'e'),
  sourceArtifact: createAflTradeCanonicalJsonArtifactRef({ syntheticSource: true }, at),
  request: {
    environment: 'non_production' as const,
    provider: 'draftguru' as const,
    competition: 'AFLM',
    anchorSeasonYear: 2024,
    discoveryFromSeasonYear: null,
    draftPathway: 'national' as const,
    dataset: 'Synthetic national selections',
    datasetVersion: 'synthetic/v1',
    accessMechanism: 'automated_web',
    capabilityId: 'draftguru-national-year-page',
    sourceUrl: 'https://www.draftguru.com.au/years/2024',
    capturedAt: at,
    effectiveAt: '2024-11-21T00:00:00.000Z',
    parserVersion: 'synthetic-national/v1',
    fieldManifestSha256: 'f'.repeat(64),
    maximumBytes: 2097152,
  },
};
it('plans an exact retained private capture without a discovery inventory or fictional dispatch', () => {
  const input = {
    environment: 'non_production' as const,
    competition: 'AFLM' as const,
    plannedAt: '2026-09-10T00:01:00.000Z',
    scopeEvidence: [createAflTradeCanonicalJsonArtifactRef({ syntheticReview: true }, at)],
    targets: [target],
  };
  const plan = createAflTradeRetainedExternalCapturePlan(input);
  expect(plan.content.schemaVersion).toBe('afl-trade-external-historical-capture-plan/v2');
  expect(plan.content.targetCount).toBe(1);
  expect(plan.content.fromYear).toBe(2024);
  expect(plan.content.throughYear).toBe(2024);
  expect(plan.content).not.toHaveProperty('inventoryId');
  expect(plan.content.targets[0]!.content).not.toHaveProperty('schedule');
  expect(plan.content.targets[0]!.content.request.capturedAt).toBe(at);
  expect(createAflTradeRetainedExternalCapturePlan(input)).toEqual(plan);
  expect(() =>
    createAflTradeRetainedExternalCapturePlan({ ...input, targets: [target, target] })
  ).toThrow();
  expect(() =>
    createAflTradeRetainedExternalCapturePlan({ ...input, plannedAt: '2026-09-09T00:00:00.000Z' })
  ).toThrow();
  expect(() =>
    createAflTradeRetainedExternalCapturePlan({
      ...input,
      targets: [
        {
          ...target,
          request: { ...target.request, sourceUrl: 'https://www.draftguru.com.au/years/2023' },
        },
      ],
    })
  ).toThrow();
  expect(() =>
    createAflTradeRetainedExternalCapturePlan({ ...input, environment: 'test_fixture' })
  ).toThrow();
});
it('completes only the exact retained target set while preserving actual source finalization time', () => {
  const plan = createAflTradeRetainedExternalCapturePlan({
    environment: 'non_production',
    competition: 'AFLM',
    plannedAt: '2026-09-10T00:01:00.000Z',
    scopeEvidence: [createAflTradeCanonicalJsonArtifactRef({ syntheticReview: true }, at)],
    targets: [target],
  });
  const result = {
    ordinal: 1,
    targetId: plan.content.targets[0]!.targetId,
    captureMode: 'retained' as const,
    resultId: target.evidenceBatchId,
    captureId: target.captureId,
    evidenceBatchId: target.evidenceBatchId,
    evidenceBatchSha256: 'b'.repeat(64),
    evidenceCount: 71,
    executionReceiptId: target.executionReceiptId,
    finalizedAt: '2026-09-10T00:00:30.000Z',
  };
  const completion = createAflTradeRetainedExternalCaptureCompletion({
    plan,
    completedAt: '2026-09-10T00:02:00.000Z',
    results: [result],
  });
  expect(completion.content.results[0]!.finalizedAt).toBe('2026-09-10T00:00:30.000Z');
  expect(completion.content.results[0]).not.toHaveProperty('dispatchKey');
  expect(completion.content.sourceBatchIds).toEqual([target.evidenceBatchId]);
  expect(() =>
    createAflTradeRetainedExternalCaptureCompletion({ plan, completedAt: at, results: [result] })
  ).toThrow();
  expect(() =>
    createAflTradeRetainedExternalCaptureCompletion({
      plan,
      completedAt: completion.content.completedAt,
      results: [{ ...result, captureId: id('source-capture', 'f') }],
    })
  ).toThrow();
  expect(() =>
    createAflTradeRetainedExternalCaptureCompletion({
      plan,
      completedAt: completion.content.completedAt,
      results: [{ ...result, executionReceiptId: id('external-capture-execution', 'f') }],
    })
  ).toThrow();
});
