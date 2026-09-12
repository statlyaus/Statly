import { describe, expect, it } from 'vitest';
import {
  createAflTradeContentAddress,
  canonicalizeAflTradeJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  aflTradeModelRunCheckpointSchema,
  createAflTradeModelRunCheckpoint,
  createAflTradeModelRunCheckpointV2,
  aflTradeModelRunCheckpointV2Schema,
} from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';

const id = (prefix: string) => createAflTradeContentAddress(prefix, { fixture: prefix });
function started() {
  return {
    schemaVersion: 'afl-trade-model-run-checkpoint/v1' as const,
    authorityBoundary: 'durable_model_run_stage_no_execution_or_qualification_authority' as const,
    publicationEligible: false as const,
    environment: 'non_production' as const,
    intentId: id('model-run-intent'),
    rootIntentId: id('model-run-intent'),
    authorizationId: id('model-run-authorization'),
    dispatchRequestId: id('private-valuation-dispatch'),
    substantiveOperationId: id('private-valuation-model-operation'),
    dispatchClaimId: id('private-valuation-dispatch-claim'),
    dispatchAttemptNumber: 1,
    stage: 'started' as const,
    previousCheckpointId: null,
    recordedAt: '2026-09-02T00:30:00.000Z',
    candidateArtifact: null,
    evidenceArtifact: null,
  };
}

describe('model-run checkpoint structural contract', () => {
  it('replays the same strict content-addressed started checkpoint', () => {
    const { schemaVersion, authorityBoundary, publicationEligible, environment, ...input } =
      started();
    const checkpoint = createAflTradeModelRunCheckpoint(input);
    expect(checkpoint.content).toMatchObject({
      schemaVersion,
      authorityBoundary,
      publicationEligible,
      environment,
    });
    expect(checkpoint.checkpointId).toBe(
      createAflTradeContentAddress('model-run-checkpoint', started())
    );
    const replay = aflTradeModelRunCheckpointSchema.parse(
      JSON.parse(canonicalizeAflTradeJson(checkpoint))
    );
    expect(replay).toEqual(checkpoint);
    expect(checkpoint.content.publicationEligible).toBe(false);
  });

  function later(stage: 'candidate_locked' | 'final_test_started' | 'final_test_completed') {
    const content = started();
    return {
      ...content,
      stage,
      previousCheckpointId: createAflTradeModelRunCheckpoint(content).checkpointId,
      candidateArtifact: createAflTradeCanonicalJsonArtifactRef(
        { fixture: 'candidate' },
        content.recordedAt
      ),
      evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
        { fixture: 'stage evidence' },
        content.recordedAt
      ),
    };
  }

  it.each(['candidate_fitted', 'pre_final_retained', 'validation_plan_retained'] as const)(
    'retains versioned %s progress without relabeling legacy checkpoints',
    (stage) => {
      const { schemaVersion: _version, ...input } = later('candidate_locked');
      const checkpoint = createAflTradeModelRunCheckpointV2({ ...input, stage });
      expect(checkpoint.content.schemaVersion).toBe('afl-trade-model-run-checkpoint/v2');
      expect(
        aflTradeModelRunCheckpointV2Schema.parse(JSON.parse(canonicalizeAflTradeJson(checkpoint)))
      ).toEqual(checkpoint);
      expect(aflTradeModelRunCheckpointSchema.safeParse(checkpoint).success).toBe(false);
      expect(() =>
        createAflTradeModelRunCheckpointV2({ ...input, stage, evidenceArtifact: null })
      ).toThrow();
    }
  );

  it.each(['candidate_locked', 'final_test_started', 'final_test_completed'] as const)(
    'accepts exact structural evidence for %s without certifying predecessor state',
    (stage) => {
      const checkpoint = createAflTradeModelRunCheckpoint(later(stage));
      expect(checkpoint.content.stage).toBe(stage);
      expect(checkpoint.content.previousCheckpointId).not.toBeNull();
    }
  );

  it('rejects tampered content and unknown fields at either envelope level', () => {
    const checkpoint = createAflTradeModelRunCheckpoint(started());
    expect(
      aflTradeModelRunCheckpointSchema.safeParse({
        ...checkpoint,
        content: { ...checkpoint.content, dispatchAttemptNumber: 2 },
      }).success
    ).toBe(false);
    expect(
      aflTradeModelRunCheckpointSchema.safeParse({ ...checkpoint, executionGranted: true }).success
    ).toBe(false);
    expect(() =>
      createAflTradeModelRunCheckpoint({ ...started(), executionGranted: true } as never)
    ).toThrow();
  });

  it.each(['previousCheckpointId', 'candidateArtifact', 'evidenceArtifact'] as const)(
    'requires %s null at start and present at every later stage',
    (field) => {
      const locked = later('candidate_locked');
      expect(() =>
        createAflTradeModelRunCheckpoint({ ...started(), [field]: locked[field] })
      ).toThrow();
      for (const stage of [
        'candidate_locked',
        'final_test_started',
        'final_test_completed',
      ] as const)
        expect(() =>
          createAflTradeModelRunCheckpoint({ ...later(stage), [field]: null })
        ).toThrow();
    }
  );

  it('requires a started checkpoint to be its own root intent', () => {
    expect(() =>
      createAflTradeModelRunCheckpoint({
        ...started(),
        rootIntentId: `model-run-intent:${'f'.repeat(64)}`,
      })
    ).toThrow(/root/);
  });

  it.each(['candidateArtifact', 'evidenceArtifact'] as const)(
    'requires nonempty JSON for %s',
    (field) => {
      const content = later('candidate_locked');
      for (const replacement of [{ mediaType: 'text/plain' }, { byteLength: 0 }]) {
        expect(() =>
          createAflTradeModelRunCheckpoint({
            ...content,
            [field]: { ...content[field], ...replacement },
          })
        ).toThrow();
      }
    }
  );

  it.each(['candidateArtifact', 'evidenceArtifact'] as const)(
    'rejects future %s custody',
    (field) => {
      const content = later('candidate_locked');
      const future = createAflTradeCanonicalJsonArtifactRef(
        { fixture: field },
        '2026-09-02T00:30:00.001Z'
      );
      expect(() => createAflTradeModelRunCheckpoint({ ...content, [field]: future })).toThrow(
        /recording time/
      );
    }
  );

  it.each(['2026-09-02T10:30:00.000+10:00', '2026-09-02T00:30:00', 'not-a-time'])(
    'rejects non-UTC or invalid recording timestamp %s',
    (recordedAt) => {
      expect(() => createAflTradeModelRunCheckpoint({ ...started(), recordedAt })).toThrow();
    }
  );

  it.each([
    { environment: 'production' },
    { publicationEligible: true },
    { dispatchAttemptNumber: 0 },
    { dispatchAttemptNumber: 4 },
  ])('rejects unsupported structural authority fields %j', (replacement) => {
    expect(() =>
      createAflTradeModelRunCheckpoint({ ...started(), ...replacement } as never)
    ).toThrow();
  });
});
