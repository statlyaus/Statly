import { describe, expect, it } from 'vitest';
import { createAflTradeModelRunCheckpoint } from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import {
  createAflTradeNativeFinalTestCompletionEvidence,
  aflTradeNativeFinalTestCompletionEvidenceSchema,
  aflTradeAnyModelRunManifestSchema,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { artifact, runContent } from '../testUtils/admittedPlayerModelRunFixture';

const id = (prefix: string) => `${prefix}:${'a'.repeat(64)}`;

function input() {
  return {
    finalTestStartedCheckpoint: createAflTradeModelRunCheckpoint({
      intentId: id('model-run-intent'),
      rootIntentId: id('model-run-intent'),
      authorizationId: id('model-run-authorization'),
      dispatchRequestId: id('private-valuation-dispatch'),
      substantiveOperationId: id('private-valuation-model-operation'),
      dispatchClaimId: id('private-valuation-dispatch-claim'),
      dispatchAttemptNumber: 1,
      stage: 'final_test_started',
      previousCheckpointId: id('model-run-checkpoint'),
      recordedAt: '2026-08-10T00:04:00.000Z',
      candidateArtifact: artifact('8'),
      evidenceArtifact: artifact('9'),
    }),
    evaluatedAt: '2026-08-10T00:05:00.000Z',
    recordedAt: '2026-08-10T00:06:00.000Z',
    outcome: runContent().outcome,
  };
}

describe('retained native final-test completion evidence', () => {
  it('preserves actual evaluation time and the exact start checkpoint independently of retention time', () => {
    const fixture = input();
    const evidence = createAflTradeNativeFinalTestCompletionEvidence(fixture);
    expect(evidence.evaluatedAt).toBe('2026-08-10T00:05:00.000Z');
    expect(evidence.recordedAt).toBe('2026-08-10T00:06:00.000Z');
    expect(evidence.finalTestStartedCheckpoint).toEqual(fixture.finalTestStartedCheckpoint);
    expect(evidence.outcome).toEqual(fixture.outcome);
    expect(evidence.publicationEligible).toBe(false);
  });
  it.each(['candidate_locked', 'final_test_completed'] as const)(
    'rejects a %s checkpoint as permission evidence for a completed evaluation',
    (stage) => {
      const fixture = input();
      fixture.finalTestStartedCheckpoint = createAflTradeModelRunCheckpoint({
        ...fixture.finalTestStartedCheckpoint.content,
        stage,
      });
      expect(() => createAflTradeNativeFinalTestCompletionEvidence(fixture)).toThrow();
    }
  );
  it.each([
    { evaluatedAt: '2026-08-10T00:03:00.000Z' },
    { recordedAt: '2026-08-10T00:04:30.000Z' },
  ])('rejects impossible evaluation or retention chronology: %j', (change) => {
    expect(() =>
      createAflTradeNativeFinalTestCompletionEvidence({ ...input(), ...change })
    ).toThrow();
  });
  it('rejects a substituted locked model and output artifacts created after retention', () => {
    const fixture = input();
    expect(() =>
      createAflTradeNativeFinalTestCompletionEvidence({
        ...fixture,
        outcome: { ...fixture.outcome, modelArtifact: artifact('f') },
      })
    ).toThrow();
    expect(() =>
      createAflTradeNativeFinalTestCompletionEvidence({
        ...fixture,
        outcome: {
          ...fixture.outcome,
          diagnosticsArtifact: { ...artifact('2'), createdAt: '2026-08-10T00:07:00.000Z' },
        },
      })
    ).toThrow();
  });
  it('does not become an accepted terminal manifest or execution authority', () => {
    const evidence = createAflTradeNativeFinalTestCompletionEvidence(input());
    expect(aflTradeAnyModelRunManifestSchema.safeParse(evidence).success).toBe(false);
    expect(
      aflTradeNativeFinalTestCompletionEvidenceSchema.safeParse({
        ...evidence,
        publicationEligible: true,
      }).success
    ).toBe(false);
    expect(
      aflTradeNativeFinalTestCompletionEvidenceSchema.safeParse({
        ...evidence,
        finalTestStartedCheckpoint: {
          ...evidence.finalTestStartedCheckpoint,
          checkpointId: `model-run-checkpoint:${'f'.repeat(64)}`,
        },
      }).success
    ).toBe(false);
  });
});
