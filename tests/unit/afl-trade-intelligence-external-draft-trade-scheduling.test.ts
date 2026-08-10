import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeExternalCaptureDispatchKey,
  createAflTradeExternalCaptureSchedule,
  evaluateAflTradeExternalCaptureOccurrence,
  type AflTradeExternalCaptureScheduleEvaluation,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeScheduling';

const digest = (character: string) => character.repeat(64);

function occurrenceFromClaim(
  claim: NonNullable<ReturnType<typeof evaluateAflTradeExternalCaptureOccurrence>['proposedClaim']>,
  state: {
    status: 'leased' | 'retry_wait' | 'completed';
    availableAt: string;
    completedAt: string | null;
    resultId: string | null;
    failureCode: string | null;
  }
) {
  return {
    dispatchKey: claim.dispatchKey,
    scheduleId: claim.scheduleId,
    dueAt: claim.dueAt,
    ...state,
    lastClaim: claim,
  };
}

function withAttempt(
  claim: NonNullable<ReturnType<typeof evaluateAflTradeExternalCaptureOccurrence>['proposedClaim']>,
  attemptNumber: number
) {
  const content = {
    dispatchKey: claim.dispatchKey,
    attemptNumber,
    claimedAt: claim.claimedAt,
    leaseExpiresAt: claim.leaseExpiresAt,
    workerId: claim.workerId,
    leaseTokenSha256: claim.leaseTokenSha256,
  };
  return {
    ...claim,
    attemptNumber,
    claimId: createAflTradeContentAddress('external-capture-claim', content),
  };
}

function schedule() {
  return createAflTradeExternalCaptureSchedule({
    schemaVersion: 'afl-trade-external-capture-schedule-definition/v1',
    requestTemplate: {
      environment: 'production',
      provider: 'draftguru',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      draftPathway: null,
      dataset: 'draftguru-trades',
      datasetVersion: '2025',
      accessMechanism: 'automated_web',
      capabilityId: 'draftguru-trade-detail',
      sourceUrl: 'https://www.draftguru.com.au/trades/2025-liam-reidy',
      effectiveAt: '2025-10-15T00:00:00.000Z',
      parserVersion: 'draftguru-trade-detail/v1',
      fieldManifestSha256: digest('a'),
      maximumBytes: 1_048_576,
    },
    gateRequestTemplate: {
      decisionKey: 'draftguru-trade-detail-production',
      environment: 'production',
      rightsArtifactId: `source-rights:${digest('b')}`,
      competition: 'AFLM',
      season: 2025,
      accessMechanism: 'automated_web',
      capabilityId: null,
      geography: 'Australia',
      commercialContext: 'public_archive',
      audience: 'public',
      operations: ['bounded_evaluation_capture', 'raw_evidence_retention'],
      fieldUses: [{ sourceField: 'trade_id', use: 'public_display' }],
      rawRetentionDays: 365,
      metadataRetentionDays: 2_555,
      cacheSeconds: 86_400,
    },
    cadence: {
      anchorAt: '2026-08-09T00:00:00.000Z',
      intervalSeconds: 86_400,
      maximumLatenessSeconds: 3_600,
    },
    execution: {
      maximumAttempts: 4,
      leaseSeconds: 900,
      retryBaseSeconds: 30,
      retryMaximumSeconds: 900,
      circuitFailureThreshold: 3,
      circuitResetSeconds: 1_800,
    },
    concurrencyPolicy: 'forbid_overlap',
    publicationEligible: false,
  });
}

function evaluation(): AflTradeExternalCaptureScheduleEvaluation {
  return {
    schemaVersion: 'afl-trade-external-capture-schedule-evaluation/v1',
    schedule: schedule(),
    dueAt: '2026-08-10T00:00:00.000Z',
    observedAt: '2026-08-10T00:00:05.000Z',
    workerId: 'capture-worker-1',
    leaseTokenSha256: digest('c'),
    priorOccurrence: null,
    consecutiveProviderFailures: 0,
    circuitOpenedAt: null,
  };
}

describe('AFL external draft/trade capture scheduling', () => {
  it('creates one deterministic immutable schedule and aligned dispatch key', () => {
    const first = schedule();
    const repeated = schedule();
    const dispatchKey = createAflTradeExternalCaptureDispatchKey(
      first.scheduleId,
      '2026-08-10T00:00:00.000Z'
    );

    expect(repeated).toEqual(first);
    expect(dispatchKey).toMatch(/^external-capture-dispatch:[a-f0-9]{64}$/);
    expect(first.definition.publicationEligible).toBe(false);
  });

  it('claims ready work with the exact runtime command and an expiring lease', () => {
    const decision = evaluateAflTradeExternalCaptureOccurrence(evaluation());

    expect(decision.action).toBe('claim');
    expect(decision.dispatchKey).toBe(
      createAflTradeExternalCaptureDispatchKey(decision.scheduleId, decision.dueAt)
    );
    expect(decision.proposedClaim).toMatchObject({
      attemptNumber: 1,
      workerId: 'capture-worker-1',
      leaseTokenSha256: digest('c'),
    });
    expect(decision.command?.request.capturedAt).toBe(evaluation().observedAt);
    expect(decision.command?.gateRequest.evaluatedAt).toBe(evaluation().observedAt);
  });

  it('deduplicates terminal success and does not overlap an unexpired lease', () => {
    const claimed = evaluateAflTradeExternalCaptureOccurrence(evaluation());
    const completed = evaluateAflTradeExternalCaptureOccurrence({
      ...evaluation(),
      priorOccurrence: occurrenceFromClaim(claimed.proposedClaim!, {
        status: 'completed',
        availableAt: claimed.proposedClaim!.claimedAt,
        completedAt: '2026-08-10T00:01:00.000Z',
        resultId: `external-evidence-batch:${digest('d')}`,
        failureCode: null,
      }),
    });
    const leased = evaluateAflTradeExternalCaptureOccurrence({
      ...evaluation(),
      priorOccurrence: occurrenceFromClaim(claimed.proposedClaim!, {
        status: 'leased',
        availableAt: claimed.proposedClaim!.claimedAt,
        completedAt: null,
        resultId: null,
        failureCode: null,
      }),
    });

    expect(completed.action).toBe('deduplicate');
    expect(leased.action).toBe('defer_lease');
    expect(completed.command).toBeNull();
    expect(leased.command).toBeNull();
  });

  it('reclaims an expired lease with the next bounded attempt', () => {
    const first = evaluateAflTradeExternalCaptureOccurrence(evaluation());
    const reclaimed = evaluateAflTradeExternalCaptureOccurrence({
      ...evaluation(),
      observedAt: '2026-08-10T00:20:00.000Z',
      leaseTokenSha256: digest('e'),
      priorOccurrence: occurrenceFromClaim(first.proposedClaim!, {
        status: 'leased',
        availableAt: first.proposedClaim!.claimedAt,
        completedAt: null,
        resultId: null,
        failureCode: null,
      }),
    });

    expect(reclaimed.action).toBe('claim');
    expect(reclaimed.proposedClaim?.attemptNumber).toBe(2);
    expect(reclaimed.proposedClaim?.leaseTokenSha256).toBe(digest('e'));
  });

  it('waits for deterministic backoff and dead-letters exhausted work', () => {
    const first = evaluateAflTradeExternalCaptureOccurrence(evaluation());
    const retryWaiting = evaluateAflTradeExternalCaptureOccurrence({
      ...evaluation(),
      priorOccurrence: occurrenceFromClaim(first.proposedClaim!, {
        status: 'retry_wait',
        availableAt: '2026-08-10T00:05:00.000Z',
        completedAt: null,
        resultId: null,
        failureCode: 'TRANSPORT_FAILURE',
      }),
    });
    const exhausted = evaluateAflTradeExternalCaptureOccurrence({
      ...evaluation(),
      observedAt: '2026-08-10T00:05:00.000Z',
      priorOccurrence: occurrenceFromClaim(withAttempt(first.proposedClaim!, 4), {
        status: 'retry_wait',
        availableAt: '2026-08-10T00:05:00.000Z',
        completedAt: null,
        resultId: null,
        failureCode: 'TRANSPORT_FAILURE',
      }),
    });

    expect(retryWaiting.action).toBe('defer_retry');
    expect(exhausted.action).toBe('dead_letter');
    expect(exhausted.proposedClaim).toBeNull();
  });

  it('blocks an open provider circuit and permanently records late work', () => {
    const circuit = evaluateAflTradeExternalCaptureOccurrence({
      ...evaluation(),
      consecutiveProviderFailures: 3,
      circuitOpenedAt: '2026-08-09T23:50:00.000Z',
    });
    const late = evaluateAflTradeExternalCaptureOccurrence({
      ...evaluation(),
      observedAt: '2026-08-10T01:00:01.000Z',
    });

    expect(circuit.action).toBe('defer_circuit');
    expect(circuit.retryAt).toBe('2026-08-10T00:20:00.000Z');
    expect(late.action).toBe('skip_late');
  });

  it('rejects scope drift, misaligned occurrences, and ownership fields', () => {
    expect(() =>
      createAflTradeExternalCaptureSchedule({
        ...schedule().definition,
        gateRequestTemplate: {
          ...schedule().definition.gateRequestTemplate,
          season: 2024,
        },
      })
    ).toThrow();
    expect(() =>
      evaluateAflTradeExternalCaptureOccurrence({
        ...evaluation(),
        dueAt: '2026-08-10T00:30:00.000Z',
      })
    ).toThrow();
    expect(() =>
      createAflTradeExternalCaptureSchedule({
        ...schedule().definition,
        userId: 'fantasy-user',
      } as never)
    ).toThrow();
  });
});
