import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY,
  classifyAflTradePrivateEvaluationExecutionError,
  createAflTradePrivateEvaluationCohortExecutionCycle,
  createAflTradePrivateEvaluationCohortInputFingerprint,
} from '@/server/aflTradeIntelligence/valuation/privateEvaluationCohortExecution';

const digest = (marker: string) => marker.repeat(64);
const authority = {
  scopeKey: 'afl-men:2026-trades',
  preparedInputSetId: `prepared-valuation-input-set:${digest('1')}`,
  preparedInputSetRevision: 4,
  factualReleaseRevision: 3,
  modelQualificationWorkId: `model-qualification-work:${digest('2')}`,
  modelPairRevision: 5,
} as const;

describe('private evaluation cohort durable execution policy', () => {
  it('fixes bounded local execution to three persisted attempts', () => {
    expect(AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY).toEqual({
      schemaVersion: 'private-evaluation-cohort-execution-policy/v1',
      maximumAttemptsPerCycle: 3,
      maximumConcurrency: 8,
      leaseSeconds: 120,
      heartbeatSeconds: 30,
      retryBaseSeconds: 5,
      retryMaximumSeconds: 60,
      concurrencyPolicy: 'bounded_local_workers',
    });
  });

  it('opens a new automatic cycle only when authenticated inputs change', () => {
    const first = createAflTradePrivateEvaluationCohortInputFingerprint(authority);
    expect(createAflTradePrivateEvaluationCohortInputFingerprint(authority)).toBe(first);
    expect(
      createAflTradePrivateEvaluationCohortInputFingerprint({
        ...authority,
        preparedInputSetRevision: authority.preparedInputSetRevision + 1,
      })
    ).not.toBe(first);

    const cycle = createAflTradePrivateEvaluationCohortExecutionCycle({
      authority,
      repairSequence: 0,
      openedAt: '2026-08-21T10:00:00.000Z',
    });
    expect(cycle.content).toMatchObject({
      inputFingerprint: first,
      repairSequence: 0,
      openingCause: 'authenticated_inputs_changed',
      openingPrincipalId: 'system:weekly-valuation-coordinator',
      repairOperationId: null,
      repairReason: null,
      maximumAttemptsPerTrade: 3,
      publicationEligible: false,
    });
  });

  it('opens an explicit repair cycle without changing or deleting prior history', () => {
    const original = createAflTradePrivateEvaluationCohortExecutionCycle({
      authority,
      repairSequence: 0,
      openedAt: '2026-08-21T10:00:00.000Z',
    });
    const repair = createAflTradePrivateEvaluationCohortExecutionCycle({
      authority,
      repairSequence: 1,
      openedAt: '2026-08-21T11:00:00.000Z',
      repairOperationId: `cohort-execution-repair:${digest('9')}`,
      repairReason: 'Retry after the retained upstream outage was corrected.',
    });

    expect(repair.cycleId).not.toBe(original.cycleId);
    expect(repair.content.inputFingerprint).toBe(original.content.inputFingerprint);
    expect(repair.content).toMatchObject({
      repairSequence: 1,
      openingCause: 'explicit_repair',
      openingPrincipalId: 'system:weekly-valuation-coordinator',
      repairOperationId: `cohort-execution-repair:${digest('9')}`,
      repairReason: 'Retry after the retained upstream outage was corrected.',
      repairsCycleId: original.cycleId,
    });
  });

  it('classifies only bounded infrastructure failures as transient', () => {
    expect(
      classifyAflTradePrivateEvaluationExecutionError(
        Object.assign(new Error('serialization conflict'), { code: '40001' })
      )
    ).toEqual({
      code: 'postgres_40001',
      message: 'serialization conflict',
      retryable: true,
    });
    expect(
      classifyAflTradePrivateEvaluationExecutionError(
        Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
      )
    ).toEqual({
      code: 'transport_ECONNRESET',
      message: 'connection reset',
      retryable: true,
    });
    expect(
      classifyAflTradePrivateEvaluationExecutionError(new TypeError('bad custody'))
    ).toBeNull();
  });
});
