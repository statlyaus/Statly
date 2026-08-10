import type { AflTradeExternalHistoricalCapturePlanPage } from './postgresExternalDraftTradeDiscoveryRepository';
import type { ClaimAflTradeExternalCaptureOccurrenceInput } from './postgresExternalDraftTradeScheduleRepository';
import type { AflTradeExternalCaptureScheduleRunResult } from './externalDraftTradeScheduledRunner';

export interface RunAflTradeExternalHistoricalCapturePlanPageInput {
  planId: string;
  afterOrdinal: number;
  maximumTargets: number;
  workerId: string;
}

export interface AflTradeExternalHistoricalCapturePlanRunnerDependencies {
  loadPlanPage(input: {
    planId: string;
    afterOrdinal: number;
    maximumTargets: number;
  }): Promise<AflTradeExternalHistoricalCapturePlanPage>;
  runCapture(
    input: ClaimAflTradeExternalCaptureOccurrenceInput
  ): Promise<AflTradeExternalCaptureScheduleRunResult>;
  clock: { now(): string };
  createLeaseTokenSha256(ordinal: number): string;
}

export interface AflTradeExternalHistoricalCaptureTargetRun {
  ordinal: number;
  targetId: string;
  scheduleId: string;
  result: AflTradeExternalCaptureScheduleRunResult;
}

export type AflTradeExternalHistoricalCapturePlanPageResult =
  | {
      status: 'plan_completed' | 'page_completed';
      planId: string;
      targetCount: number;
      completedThroughOrdinal: number;
      nextAfterOrdinal: number | null;
      results: readonly AflTradeExternalHistoricalCaptureTargetRun[];
    }
  | {
      status: 'blocked';
      planId: string;
      targetCount: number;
      completedThroughOrdinal: number;
      nextAfterOrdinal: number;
      blockedTargetOrdinal: number;
      results: readonly AflTradeExternalHistoricalCaptureTargetRun[];
    };

const terminalNoRunActions = new Set(['deduplicate', 'skip_late', 'dead_letter']);

function validateInput(input: RunAflTradeExternalHistoricalCapturePlanPageInput): void {
  if (
    !/^external-historical-capture-plan:[a-f0-9]{64}$/.test(input.planId) ||
    !Number.isInteger(input.afterOrdinal) ||
    input.afterOrdinal < 0 ||
    !Number.isInteger(input.maximumTargets) ||
    input.maximumTargets < 1 ||
    input.maximumTargets > 1_000 ||
    input.workerId.trim().length === 0 ||
    input.workerId.length > 240
  ) {
    throw new TypeError('Historical plan runner requires a valid plan, cursor, bound and worker.');
  }
}

function isTerminal(result: AflTradeExternalCaptureScheduleRunResult): boolean {
  return (
    result.status === 'completed' ||
    (result.status === 'not_run' && terminalNoRunActions.has(result.action))
  );
}

export async function runAflTradeExternalHistoricalCapturePlanPage(
  input: RunAflTradeExternalHistoricalCapturePlanPageInput,
  dependencies: AflTradeExternalHistoricalCapturePlanRunnerDependencies
): Promise<AflTradeExternalHistoricalCapturePlanPageResult> {
  validateInput(input);
  const page = await dependencies.loadPlanPage({
    planId: input.planId,
    afterOrdinal: input.afterOrdinal,
    maximumTargets: input.maximumTargets,
  });
  if (page.planId !== input.planId || page.afterOrdinal !== input.afterOrdinal) {
    throw new TypeError('Loaded historical plan page does not match the requested cursor.');
  }
  if (page.targets.length === 0) {
    return {
      status: 'plan_completed',
      planId: input.planId,
      targetCount: page.targetCount,
      completedThroughOrdinal: input.afterOrdinal,
      nextAfterOrdinal: null,
      results: [],
    };
  }

  let completedThroughOrdinal = input.afterOrdinal;
  const results: AflTradeExternalHistoricalCaptureTargetRun[] = [];
  for (const target of page.targets) {
    if (target.content.ordinal !== completedThroughOrdinal + 1) {
      throw new TypeError('Historical plan page must be contiguous from its requested cursor.');
    }
    const leaseTokenSha256 = dependencies.createLeaseTokenSha256(target.content.ordinal);
    if (!/^[a-f0-9]{64}$/.test(leaseTokenSha256)) {
      throw new TypeError('Historical plan worker produced an invalid lease-token digest.');
    }
    const result = await dependencies.runCapture({
      scheduleId: target.content.schedule.scheduleId,
      dueAt: target.content.schedule.definition.cadence.anchorAt,
      observedAt: dependencies.clock.now(),
      workerId: input.workerId,
      leaseTokenSha256,
    });
    results.push({
      ordinal: target.content.ordinal,
      targetId: target.targetId,
      scheduleId: target.content.schedule.scheduleId,
      result,
    });
    if (!isTerminal(result)) {
      return {
        status: 'blocked',
        planId: input.planId,
        targetCount: page.targetCount,
        completedThroughOrdinal,
        nextAfterOrdinal: completedThroughOrdinal,
        blockedTargetOrdinal: target.content.ordinal,
        results,
      };
    }
    completedThroughOrdinal = target.content.ordinal;
  }

  const completed = completedThroughOrdinal >= page.targetCount;
  return {
    status: completed ? 'plan_completed' : 'page_completed',
    planId: input.planId,
    targetCount: page.targetCount,
    completedThroughOrdinal,
    nextAfterOrdinal: completed ? null : completedThroughOrdinal,
    results,
  };
}
