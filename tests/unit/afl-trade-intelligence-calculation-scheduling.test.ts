import { describe, expect, it } from 'vitest';

import type { AflTradeCalculationRunInputs } from '@/server/aflTradeIntelligence/operations/calculationRunContracts';
import {
  aflTradeCalculationScheduleEvaluationSchema,
  createAflTradeCalculationSchedule,
  evaluateAflTradeCalculationSchedule,
  type AflTradeCalculationScheduleEvaluation,
} from '@/server/aflTradeIntelligence/operations/calculationScheduling';

const digest = (character: string) => character.repeat(64);

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt: '2026-08-05T01:00:00.000Z',
  };
}

function calculationInputs(): AflTradeCalculationRunInputs {
  return {
    schemaVersion: 'afl-trade-calculation-inputs/v1',
    environment: 'non_production',
    scopeKey: 'public-afl-trades-current',
    calculationAsOf: '2026-08-05T03:00:00.000Z',
    knowledgeCutoffAt: '2026-08-05T02:00:00.000Z',
    valuationBundleId: `valuation-bundle:${digest('a')}`,
    datasetIds: [`dataset:${digest('b')}`],
    evidenceManifestIds: [`evidence-manifest:${digest('c')}`],
    sourceRegisterIds: ['fixture-public-source'],
    requestedViews: ['current'],
    codeCommitSha: 'd'.repeat(40),
    configurationArtifact: artifact('e'),
  };
}

function evaluation(): AflTradeCalculationScheduleEvaluation {
  const schedule = createAflTradeCalculationSchedule({
    schemaVersion: 'afl-trade-calculation-schedule-definition/v1',
    environment: 'non_production',
    scopeKey: 'public-afl-trades-current',
    anchorAt: '2026-08-05T00:00:00.000Z',
    cadenceSeconds: 3_600,
    maximumLatenessSeconds: 300,
    maximumPrerequisiteAgeSeconds: 600,
    concurrencyPolicy: 'forbid_overlap',
  });
  return {
    schemaVersion: 'afl-trade-calculation-schedule-evaluation/v1',
    schedule,
    dueAt: '2026-08-05T03:00:00.000Z',
    observedAt: '2026-08-05T03:00:05.000Z',
    observedBy: 'fixture-scheduler',
    calculationInputs: calculationInputs(),
    prerequisites: {
      sourceUseApproved: true,
      sourceEvidenceId: 'fixture-source-approval',
      sourceCheckedAt: '2026-08-05T02:59:00.000Z',
      calculationGateApproved: true,
      gateEvidenceId: 'fixture-gate-approval',
      gateCheckedAt: '2026-08-05T02:59:00.000Z',
    },
    existingClaim: null,
    activeRuns: [],
  };
}

describe('AFL trade-intelligence calculation scheduling', () => {
  it('proposes one atomic unique claim for an aligned ready occurrence', () => {
    const decision = evaluateAflTradeCalculationSchedule(evaluation());

    expect(decision.action).toBe('enqueue');
    expect(decision.requiresAtomicUniqueClaim).toBe(true);
    expect(decision.proposedClaim).toMatchObject({
      dispatchKey: decision.dispatchKey,
      scheduleId: decision.scheduleId,
      dueAt: decision.dueAt,
      runId: decision.runId,
    });
  });

  it('is deterministic and deduplicates redelivery after a matching claim', () => {
    const first = evaluateAflTradeCalculationSchedule(evaluation());
    const repeated = evaluateAflTradeCalculationSchedule(evaluation());
    expect(repeated).toEqual(first);

    const deduplicated = evaluateAflTradeCalculationSchedule({
      ...evaluation(),
      existingClaim: first.proposedClaim,
    });
    expect(deduplicated.action).toBe('deduplicate');
    expect(deduplicated.requiresAtomicUniqueClaim).toBe(false);
    expect(deduplicated.proposedClaim).toBeNull();
    expect(deduplicated.dispatchKey).toBe(first.dispatchKey);
    expect(deduplicated.runId).toBe(first.runId);
  });

  it('rejects a claim that points the occurrence at different work', () => {
    const first = evaluateAflTradeCalculationSchedule(evaluation());
    expect(
      aflTradeCalculationScheduleEvaluationSchema.safeParse({
        ...evaluation(),
        existingClaim: {
          ...first.proposedClaim!,
          runId: `calculation-run:${digest('f')}`,
        },
      }).success
    ).toBe(false);
  });

  it('does not enqueue before due time or beyond the lateness limit', () => {
    const early = evaluateAflTradeCalculationSchedule({
      ...evaluation(),
      observedAt: '2026-08-05T02:59:59.000Z',
    });
    const late = evaluateAflTradeCalculationSchedule({
      ...evaluation(),
      observedAt: '2026-08-05T03:05:01.000Z',
    });

    expect(early.action).toBe('not_due');
    expect(late.action).toBe('skip_late');
    expect(early.proposedClaim).toBeNull();
    expect(late.proposedClaim).toBeNull();
  });

  it('fails closed when source or calculation approval is absent', () => {
    const sourceBlocked = evaluateAflTradeCalculationSchedule({
      ...evaluation(),
      prerequisites: {
        ...evaluation().prerequisites,
        sourceUseApproved: false,
      },
    });
    const gateBlocked = evaluateAflTradeCalculationSchedule({
      ...evaluation(),
      prerequisites: {
        ...evaluation().prerequisites,
        calculationGateApproved: false,
      },
    });

    expect(sourceBlocked.action).toBe('blocked');
    expect(gateBlocked.action).toBe('blocked');
  });

  it('fails closed when prerequisite evidence exceeds its freshness bound', () => {
    const input = evaluation();
    const decision = evaluateAflTradeCalculationSchedule({
      ...input,
      prerequisites: {
        ...input.prerequisites,
        sourceCheckedAt: '2026-08-05T02:49:00.000Z',
      },
    });

    expect(decision.action).toBe('blocked');
    expect(decision.proposedClaim).toBeNull();
  });

  it('defers instead of overlapping active work in the same public scope', () => {
    const decision = evaluateAflTradeCalculationSchedule({
      ...evaluation(),
      activeRuns: [
        {
          runId: `calculation-run:${digest('1')}`,
          scopeKey: 'public-afl-trades-current',
          state: 'running',
        },
      ],
    });

    expect(decision.action).toBe('defer_overlap');
    expect(decision.requiresAtomicUniqueClaim).toBe(false);
  });

  it('rejects misaligned occurrences, cross-scope work, and fantasy ownership fields', () => {
    const input = evaluation();
    expect(
      aflTradeCalculationScheduleEvaluationSchema.safeParse({
        ...input,
        dueAt: '2026-08-05T03:30:00.000Z',
        calculationInputs: {
          ...input.calculationInputs,
          calculationAsOf: '2026-08-05T03:30:00.000Z',
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeCalculationScheduleEvaluationSchema.safeParse({
        ...input,
        activeRuns: [
          {
            runId: `calculation-run:${digest('2')}`,
            scopeKey: 'different-public-scope',
            state: 'queued',
          },
        ],
      }).success
    ).toBe(false);
    expect(
      aflTradeCalculationScheduleEvaluationSchema.safeParse({
        ...input,
        userId: 'fixture-user',
        fantasyLeagueId: 'fixture-league',
      }).success
    ).toBe(false);
  });
});
