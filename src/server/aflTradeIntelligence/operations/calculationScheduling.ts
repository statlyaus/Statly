import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import {
  aflTradeCalculationRunInputsSchema,
  createAflTradeCalculationRunId,
} from './calculationRunContracts';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z.string().trim().min(1).max(200);

export const aflTradeCalculationScheduleDefinitionSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-calculation-schedule-definition/v1'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    anchorAt: isoDateTimeSchema,
    cadenceSeconds: z.number().int().positive().max(31_536_000),
    maximumLatenessSeconds: z.number().int().nonnegative().max(604_800),
    maximumPrerequisiteAgeSeconds: z.number().int().positive().max(604_800),
    concurrencyPolicy: z.literal('forbid_overlap'),
  })
  .strict();

export const aflTradeCalculationScheduleSchema = z
  .object({
    scheduleId: aflTradeContentAddressedIdSchema('calculation-schedule'),
    definition: aflTradeCalculationScheduleDefinitionSchema,
  })
  .strict()
  .superRefine((schedule, context) => {
    addAflTradeContentAddressIssue(
      'calculation-schedule',
      schedule.scheduleId,
      schedule.definition,
      context,
      ['scheduleId']
    );
  });

export const aflTradeCalculationDispatchClaimSchema = z
  .object({
    dispatchKey: aflTradeContentAddressedIdSchema('calculation-dispatch'),
    scheduleId: aflTradeContentAddressedIdSchema('calculation-schedule'),
    dueAt: isoDateTimeSchema,
    runId: aflTradeContentAddressedIdSchema('calculation-run'),
    claimedAt: isoDateTimeSchema,
    claimedBy: publicIdSchema,
  })
  .strict()
  .superRefine((claim, context) => {
    addAflTradeContentAddressIssue(
      'calculation-dispatch',
      claim.dispatchKey,
      { scheduleId: claim.scheduleId, dueAt: claim.dueAt },
      context,
      ['dispatchKey']
    );
    if (Date.parse(claim.claimedAt) < Date.parse(claim.dueAt)) {
      context.addIssue({
        code: 'custom',
        path: ['claimedAt'],
        message: 'A schedule occurrence cannot be claimed before it is due.',
      });
    }
  });

const activeRunSchema = z
  .object({
    runId: aflTradeContentAddressedIdSchema('calculation-run'),
    scopeKey: publicIdSchema,
    state: z.enum(['queued', 'running']),
  })
  .strict();

export const aflTradeCalculationScheduleEvaluationSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-calculation-schedule-evaluation/v1'),
    schedule: aflTradeCalculationScheduleSchema,
    dueAt: isoDateTimeSchema,
    observedAt: isoDateTimeSchema,
    observedBy: publicIdSchema,
    calculationInputs: aflTradeCalculationRunInputsSchema,
    prerequisites: z
      .object({
        sourceUseApproved: z.boolean(),
        sourceEvidenceId: publicIdSchema,
        sourceCheckedAt: isoDateTimeSchema,
        calculationGateApproved: z.boolean(),
        gateEvidenceId: publicIdSchema,
        gateCheckedAt: isoDateTimeSchema,
      })
      .strict(),
    existingClaim: aflTradeCalculationDispatchClaimSchema.nullable(),
    activeRuns: z.array(activeRunSchema).max(100),
  })
  .strict()
  .superRefine((evaluation, context) => {
    const { definition } = evaluation.schedule;
    if (
      evaluation.calculationInputs.environment !== definition.environment ||
      evaluation.calculationInputs.scopeKey !== definition.scopeKey
    ) {
      context.addIssue({
        code: 'custom',
        path: ['calculationInputs'],
        message: 'Calculation inputs must match the schedule environment and public scope.',
      });
    }
    if (evaluation.calculationInputs.calculationAsOf !== evaluation.dueAt) {
      context.addIssue({
        code: 'custom',
        path: ['calculationInputs', 'calculationAsOf'],
        message: 'Periodic calculation as-of time must equal the schedule occurrence.',
      });
    }
    const cadenceMilliseconds = definition.cadenceSeconds * 1_000;
    const offset = Date.parse(evaluation.dueAt) - Date.parse(definition.anchorAt);
    if (offset < 0 || offset % cadenceMilliseconds !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['dueAt'],
        message: 'The due time must be an aligned occurrence on or after the schedule anchor.',
      });
    }
    const expectedDispatchKey = createAflTradeCalculationDispatchKey(
      evaluation.schedule.scheduleId,
      evaluation.dueAt
    );
    const expectedRunId = createAflTradeCalculationRunId(evaluation.calculationInputs);
    if (
      evaluation.existingClaim &&
      (evaluation.existingClaim.dispatchKey !== expectedDispatchKey ||
        evaluation.existingClaim.scheduleId !== evaluation.schedule.scheduleId ||
        evaluation.existingClaim.dueAt !== evaluation.dueAt ||
        evaluation.existingClaim.runId !== expectedRunId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['existingClaim'],
        message: 'An existing claim must match the exact occurrence and calculation run.',
      });
    }
    if (
      evaluation.existingClaim &&
      Date.parse(evaluation.existingClaim.claimedAt) > Date.parse(evaluation.observedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['existingClaim', 'claimedAt'],
        message: 'An existing claim cannot postdate schedule observation.',
      });
    }
    if (
      Date.parse(evaluation.prerequisites.sourceCheckedAt) > Date.parse(evaluation.observedAt) ||
      Date.parse(evaluation.prerequisites.gateCheckedAt) > Date.parse(evaluation.observedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['prerequisites'],
        message: 'Prerequisite checks cannot postdate schedule observation.',
      });
    }
    if (evaluation.activeRuns.some((run) => run.scopeKey !== definition.scopeKey)) {
      context.addIssue({
        code: 'custom',
        path: ['activeRuns'],
        message: 'Active runs must belong to the scheduled public scope.',
      });
    }
  });

export const AFL_TRADE_CALCULATION_SCHEDULE_ACTIONS = [
  'enqueue',
  'deduplicate',
  'not_due',
  'skip_late',
  'blocked',
  'defer_overlap',
] as const;

export const aflTradeCalculationScheduleDecisionSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-calculation-schedule-decision/v1'),
    decisionId: aflTradeContentAddressedIdSchema('schedule-decision'),
    dispatchKey: aflTradeContentAddressedIdSchema('calculation-dispatch'),
    scheduleId: aflTradeContentAddressedIdSchema('calculation-schedule'),
    dueAt: isoDateTimeSchema,
    observedAt: isoDateTimeSchema,
    runId: aflTradeContentAddressedIdSchema('calculation-run'),
    action: z.enum(AFL_TRADE_CALCULATION_SCHEDULE_ACTIONS),
    reason: publicIdSchema,
    requiresAtomicUniqueClaim: z.boolean(),
    proposedClaim: aflTradeCalculationDispatchClaimSchema.nullable(),
  })
  .strict();

export type AflTradeCalculationScheduleDefinition = z.infer<
  typeof aflTradeCalculationScheduleDefinitionSchema
>;
export type AflTradeCalculationSchedule = z.infer<typeof aflTradeCalculationScheduleSchema>;
export type AflTradeCalculationScheduleEvaluation = z.infer<
  typeof aflTradeCalculationScheduleEvaluationSchema
>;
export type AflTradeCalculationScheduleDecision = z.infer<
  typeof aflTradeCalculationScheduleDecisionSchema
>;

export function createAflTradeCalculationSchedule(
  unparsedDefinition: AflTradeCalculationScheduleDefinition
): AflTradeCalculationSchedule {
  const definition = aflTradeCalculationScheduleDefinitionSchema.parse(unparsedDefinition);
  return aflTradeCalculationScheduleSchema.parse({
    scheduleId: createAflTradeContentAddress('calculation-schedule', definition),
    definition,
  });
}

export function createAflTradeCalculationDispatchKey(scheduleId: string, dueAt: string): string {
  return createAflTradeContentAddress('calculation-dispatch', { scheduleId, dueAt });
}

export function evaluateAflTradeCalculationSchedule(
  unparsedEvaluation: AflTradeCalculationScheduleEvaluation
): AflTradeCalculationScheduleDecision {
  const evaluation = aflTradeCalculationScheduleEvaluationSchema.parse(unparsedEvaluation);
  const { schedule, dueAt, observedAt } = evaluation;
  const dispatchKey = createAflTradeCalculationDispatchKey(schedule.scheduleId, dueAt);
  const runId = createAflTradeCalculationRunId(evaluation.calculationInputs);
  const latenessSeconds = (Date.parse(observedAt) - Date.parse(dueAt)) / 1_000;
  const sourceEvidenceAgeSeconds =
    (Date.parse(observedAt) - Date.parse(evaluation.prerequisites.sourceCheckedAt)) / 1_000;
  const gateEvidenceAgeSeconds =
    (Date.parse(observedAt) - Date.parse(evaluation.prerequisites.gateCheckedAt)) / 1_000;
  const prerequisitesFresh =
    sourceEvidenceAgeSeconds <= schedule.definition.maximumPrerequisiteAgeSeconds &&
    gateEvidenceAgeSeconds <= schedule.definition.maximumPrerequisiteAgeSeconds;

  let action: AflTradeCalculationScheduleDecision['action'];
  let reason: string;
  if (evaluation.existingClaim) {
    action = 'deduplicate';
    reason = 'occurrence_already_claimed';
  } else if (latenessSeconds < 0) {
    action = 'not_due';
    reason = 'occurrence_not_due';
  } else if (latenessSeconds > schedule.definition.maximumLatenessSeconds) {
    action = 'skip_late';
    reason = 'occurrence_exceeded_lateness_limit';
  } else if (
    !evaluation.prerequisites.sourceUseApproved ||
    !evaluation.prerequisites.calculationGateApproved ||
    !prerequisitesFresh
  ) {
    action = 'blocked';
    reason = 'calculation_prerequisite_not_approved';
  } else if (evaluation.activeRuns.length > 0) {
    action = 'defer_overlap';
    reason = 'public_scope_calculation_already_active';
  } else {
    action = 'enqueue';
    reason = 'occurrence_ready_for_atomic_claim';
  }

  const proposedClaim =
    action === 'enqueue'
      ? {
          dispatchKey,
          scheduleId: schedule.scheduleId,
          dueAt,
          runId,
          claimedAt: observedAt,
          claimedBy: evaluation.observedBy,
        }
      : null;
  const decisionContent = {
    schemaVersion: 'afl-trade-calculation-schedule-decision/v1' as const,
    dispatchKey,
    scheduleId: schedule.scheduleId,
    dueAt,
    observedAt,
    runId,
    action,
    reason,
    requiresAtomicUniqueClaim: action === 'enqueue',
    proposedClaim,
  };

  return aflTradeCalculationScheduleDecisionSchema.parse({
    ...decisionContent,
    decisionId: createAflTradeContentAddress('schedule-decision', decisionContent),
  });
}
