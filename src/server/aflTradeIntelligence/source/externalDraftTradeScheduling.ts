import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import type { AflTradeGate0ARequest } from './gate0aEvaluation';
import { AFL_TRADE_SOURCE_OPERATIONS, AFL_TRADE_SOURCE_USES } from './sourceRights';
import type { IngestAflTradeExternalPageRequest } from './externalDraftTradeIngestion';
import {
  validateAflTradeExternalCaptureScope,
  type AflTradeExternalProviderIngestionCommand,
} from './externalDraftTradeProviderIngestion';

const isoInstantSchema = z.iso.datetime({ offset: true });
const boundedIdSchema = z.string().trim().min(1).max(240);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const environmentSchema = z.enum(AFL_TRADE_DECISION_ENVIRONMENTS);
const providerSchema = z.enum(['draftguru', 'footywire', 'official_afl']);
const pathwaySchema = z.enum(['national', 'rookie', 'pre_season', 'mid_season']).nullable();

const requestTemplateSchema = z
  .object({
    environment: environmentSchema,
    provider: providerSchema,
    competition: boundedIdSchema,
    anchorSeasonYear: z.number().int().min(1897).max(2200),
    discoveryFromSeasonYear: z.number().int().min(1988).max(2200).nullable().optional(),
    draftPathway: pathwaySchema,
    dataset: boundedIdSchema,
    datasetVersion: boundedIdSchema,
    accessMechanism: z.literal('automated_web'),
    capabilityId: z.enum([
      'draftguru-trade-index',
      'draftguru-trade-detail',
      'draftguru-player-trade-detail',
      'draftguru-year-page',
      'footywire-draft-results',
      'official-afl-indicative-draft-order',
    ]),
    sourceUrl: z.string().url().startsWith('https://').max(2_048),
    effectiveAt: isoInstantSchema,
    parserVersion: boundedIdSchema,
    fieldManifestSha256: sha256Schema,
    maximumBytes: z
      .number()
      .int()
      .positive()
      .max(128 * 1024 * 1024),
  })
  .strict();

const gateRequestTemplateSchema = z
  .object({
    decisionKey: z.string().trim().min(1).max(200),
    environment: environmentSchema,
    rightsArtifactId: aflTradeContentAddressedIdSchema('source-rights'),
    competition: boundedIdSchema,
    season: z.number().int().min(1897).max(2200),
    accessMechanism: z.literal('automated_web'),
    capabilityId: z.null(),
    geography: z.string().trim().min(1).max(100),
    commercialContext: z.string().trim().min(1).max(100),
    audience: z.string().trim().min(1).max(100),
    operations: z.array(z.enum(AFL_TRADE_SOURCE_OPERATIONS)).min(1).max(50),
    fieldUses: z
      .array(
        z
          .object({
            sourceField: z.string().trim().min(1).max(300),
            use: z.enum(AFL_TRADE_SOURCE_USES),
          })
          .strict()
      )
      .min(1)
      .max(1_000),
    rawRetentionDays: z.number().int().positive().nullable(),
    metadataRetentionDays: z.number().int().positive().nullable(),
    cacheSeconds: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.operations).size !== request.operations.length) {
      context.addIssue({
        code: 'custom',
        path: ['operations'],
        message: 'Scheduled Gate operations must be unique.',
      });
    }
    const fieldUseKeys = request.fieldUses.map(({ sourceField, use }) => `${sourceField}\0${use}`);
    if (new Set(fieldUseKeys).size !== fieldUseKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['fieldUses'],
        message: 'Scheduled source-field uses must be unique.',
      });
    }
  });

export const aflTradeExternalCaptureScheduleDefinitionSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-external-capture-schedule-definition/v1'),
    requestTemplate: requestTemplateSchema,
    gateRequestTemplate: gateRequestTemplateSchema,
    cadence: z
      .object({
        anchorAt: isoInstantSchema,
        intervalSeconds: z.number().int().positive().max(31_536_000),
        maximumLatenessSeconds: z.number().int().nonnegative().max(2_592_000),
      })
      .strict(),
    execution: z
      .object({
        maximumAttempts: z.number().int().min(1).max(20),
        leaseSeconds: z.number().int().positive().max(86_400),
        retryBaseSeconds: z.number().int().positive().max(86_400),
        retryMaximumSeconds: z.number().int().positive().max(604_800),
        circuitFailureThreshold: z.number().int().positive().max(100),
        circuitResetSeconds: z.number().int().positive().max(604_800),
      })
      .strict(),
    concurrencyPolicy: z.literal('forbid_overlap'),
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((definition, context) => {
    const { requestTemplate, gateRequestTemplate, cadence, execution } = definition;
    if (
      requestTemplate.environment !== gateRequestTemplate.environment ||
      requestTemplate.competition !== gateRequestTemplate.competition ||
      requestTemplate.anchorSeasonYear !== gateRequestTemplate.season ||
      requestTemplate.accessMechanism !== gateRequestTemplate.accessMechanism ||
      gateRequestTemplate.decisionKey !==
        `${requestTemplate.capabilityId}-${requestTemplate.environment}`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['gateRequestTemplate'],
        message: 'The scheduled capture and Gate request scopes must agree exactly.',
      });
    }
    if (Date.parse(requestTemplate.effectiveAt) > Date.parse(cadence.anchorAt)) {
      context.addIssue({
        code: 'custom',
        path: ['requestTemplate', 'effectiveAt'],
        message: 'A scheduled source fact cannot become effective after the first occurrence.',
      });
    }
    if (execution.retryBaseSeconds > execution.retryMaximumSeconds) {
      context.addIssue({
        code: 'custom',
        path: ['execution', 'retryBaseSeconds'],
        message: 'Retry base duration cannot exceed its maximum.',
      });
    }
    try {
      validateAflTradeExternalCaptureScope({
        ...requestTemplate,
        capturedAt: cadence.anchorAt,
      });
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path: ['requestTemplate'],
        message: error instanceof Error ? error.message : 'Scheduled source scope is invalid.',
      });
    }
  });

export const aflTradeExternalCaptureScheduleSchema = z
  .object({
    scheduleId: aflTradeContentAddressedIdSchema('external-capture-schedule'),
    definition: aflTradeExternalCaptureScheduleDefinitionSchema,
  })
  .strict()
  .superRefine((schedule, context) => {
    addAflTradeContentAddressIssue(
      'external-capture-schedule',
      schedule.scheduleId,
      schedule.definition,
      context,
      ['scheduleId']
    );
  });

const occurrenceStatusSchema = z.enum([
  'leased',
  'retry_wait',
  'completed',
  'not_modified',
  'skipped_late',
  'dead_letter',
]);

const captureClaimContentShape = {
  dispatchKey: aflTradeContentAddressedIdSchema('external-capture-dispatch'),
  scheduleId: aflTradeContentAddressedIdSchema('external-capture-schedule'),
  dueAt: isoInstantSchema,
  attemptNumber: z.number().int().positive(),
  claimedAt: isoInstantSchema,
  leaseExpiresAt: isoInstantSchema,
  workerId: boundedIdSchema,
  leaseTokenSha256: sha256Schema,
} as const;

export const aflTradeExternalCaptureClaimSchema = z
  .object({
    claimId: aflTradeContentAddressedIdSchema('external-capture-claim'),
    ...captureClaimContentShape,
  })
  .strict()
  .superRefine((claim, context) => {
    addAflTradeContentAddressIssue(
      'external-capture-claim',
      claim.claimId,
      {
        dispatchKey: claim.dispatchKey,
        attemptNumber: claim.attemptNumber,
        claimedAt: claim.claimedAt,
        leaseExpiresAt: claim.leaseExpiresAt,
        workerId: claim.workerId,
        leaseTokenSha256: claim.leaseTokenSha256,
      },
      context,
      ['claimId']
    );
    if (Date.parse(claim.claimedAt) >= Date.parse(claim.leaseExpiresAt)) {
      context.addIssue({
        code: 'custom',
        path: ['leaseExpiresAt'],
        message: 'A capture lease must expire after it is claimed.',
      });
    }
  });

export const aflTradeExternalCaptureOccurrenceSchema = z
  .object({
    dispatchKey: aflTradeContentAddressedIdSchema('external-capture-dispatch'),
    scheduleId: aflTradeContentAddressedIdSchema('external-capture-schedule'),
    dueAt: isoInstantSchema,
    status: occurrenceStatusSchema,
    availableAt: isoInstantSchema,
    completedAt: isoInstantSchema.nullable(),
    resultId: z.string().trim().min(1).max(240).nullable(),
    failureCode: z.string().trim().min(1).max(160).nullable(),
    lastClaim: aflTradeExternalCaptureClaimSchema.nullable(),
  })
  .strict()
  .superRefine((occurrence, context) => {
    const terminal = ['completed', 'not_modified', 'skipped_late', 'dead_letter'].includes(
      occurrence.status
    );
    if (terminal !== (occurrence.completedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Only terminal capture occurrences have a completion time.',
      });
    }
    if (
      ['completed', 'not_modified'].includes(occurrence.status) !==
      (occurrence.resultId !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['resultId'],
        message: 'Only successful capture occurrences carry a result identity.',
      });
    }
    if ((occurrence.status === 'retry_wait') !== (occurrence.failureCode !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Retry-wait occurrences require one bounded failure code.',
      });
    }
    if (
      (occurrence.status === 'skipped_late' && occurrence.lastClaim !== null) ||
      (occurrence.status !== 'skipped_late' && occurrence.lastClaim === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lastClaim'],
        message: 'Only a never-claimed late occurrence may omit its last lease claim.',
      });
    }
  });

export const aflTradeExternalCaptureScheduleEvaluationSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-external-capture-schedule-evaluation/v1'),
    schedule: aflTradeExternalCaptureScheduleSchema,
    dueAt: isoInstantSchema,
    observedAt: isoInstantSchema,
    workerId: boundedIdSchema,
    leaseTokenSha256: sha256Schema,
    priorOccurrence: aflTradeExternalCaptureOccurrenceSchema.nullable(),
    consecutiveProviderFailures: z.number().int().nonnegative().max(1_000_000),
    circuitOpenedAt: isoInstantSchema.nullable(),
  })
  .strict()
  .superRefine((evaluation, context) => {
    const { definition } = evaluation.schedule;
    const cadenceMs = definition.cadence.intervalSeconds * 1_000;
    const offset = Date.parse(evaluation.dueAt) - Date.parse(definition.cadence.anchorAt);
    if (offset < 0 || offset % cadenceMs !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['dueAt'],
        message: 'The capture occurrence must align with its immutable schedule cadence.',
      });
    }
    const expectedDispatchKey = createAflTradeExternalCaptureDispatchKey(
      evaluation.schedule.scheduleId,
      evaluation.dueAt
    );
    if (
      evaluation.priorOccurrence &&
      (evaluation.priorOccurrence.dispatchKey !== expectedDispatchKey ||
        evaluation.priorOccurrence.scheduleId !== evaluation.schedule.scheduleId ||
        evaluation.priorOccurrence.dueAt !== evaluation.dueAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['priorOccurrence'],
        message: 'Prior occurrence state must belong to this exact scheduled occurrence.',
      });
    }
    const threshold = definition.execution.circuitFailureThreshold;
    if (
      (evaluation.consecutiveProviderFailures === 0 && evaluation.circuitOpenedAt !== null) ||
      (evaluation.consecutiveProviderFailures < threshold && evaluation.circuitOpenedAt !== null) ||
      (evaluation.consecutiveProviderFailures >= threshold && evaluation.circuitOpenedAt === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['circuitOpenedAt'],
        message: 'A provider circuit opens exactly when its failure threshold is reached.',
      });
    }
  });

export const AFL_TRADE_EXTERNAL_CAPTURE_SCHEDULE_ACTIONS = [
  'claim',
  'deduplicate',
  'not_due',
  'skip_late',
  'defer_lease',
  'defer_retry',
  'defer_circuit',
  'dead_letter',
] as const;

export const aflTradeExternalCaptureScheduleDecisionSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-external-capture-schedule-decision/v1'),
    decisionId: aflTradeContentAddressedIdSchema('external-capture-schedule-decision'),
    scheduleId: aflTradeContentAddressedIdSchema('external-capture-schedule'),
    dispatchKey: aflTradeContentAddressedIdSchema('external-capture-dispatch'),
    dueAt: isoInstantSchema,
    observedAt: isoInstantSchema,
    action: z.enum(AFL_TRADE_EXTERNAL_CAPTURE_SCHEDULE_ACTIONS),
    reason: boundedIdSchema,
    retryAt: isoInstantSchema.nullable(),
    proposedClaim: aflTradeExternalCaptureClaimSchema.nullable(),
    proposedOccurrence: aflTradeExternalCaptureOccurrenceSchema.nullable(),
    command: z.custom<AflTradeExternalProviderIngestionCommand>().nullable(),
  })
  .strict()
  .superRefine((decision, context) => {
    const claimsWork = decision.action === 'claim';
    if (claimsWork !== (decision.proposedClaim !== null && decision.command !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Only a claim decision may carry a lease and ingestion command.',
      });
    }
    const mutatesOccurrence = ['claim', 'skip_late', 'dead_letter'].includes(decision.action);
    if (mutatesOccurrence !== (decision.proposedOccurrence !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['proposedOccurrence'],
        message: 'Only state-changing schedule decisions may propose occurrence state.',
      });
    }
    addAflTradeContentAddressIssue(
      'external-capture-schedule-decision',
      decision.decisionId,
      {
        schemaVersion: decision.schemaVersion,
        scheduleId: decision.scheduleId,
        dispatchKey: decision.dispatchKey,
        dueAt: decision.dueAt,
        observedAt: decision.observedAt,
        action: decision.action,
        reason: decision.reason,
        retryAt: decision.retryAt,
        proposedClaim: decision.proposedClaim,
        proposedOccurrence: decision.proposedOccurrence,
        command: decision.command,
      },
      context,
      ['decisionId']
    );
  });

export type AflTradeExternalCaptureScheduleDefinition = z.infer<
  typeof aflTradeExternalCaptureScheduleDefinitionSchema
>;
export type AflTradeExternalCaptureSchedule = z.infer<typeof aflTradeExternalCaptureScheduleSchema>;
export type AflTradeExternalCaptureClaim = z.infer<typeof aflTradeExternalCaptureClaimSchema>;
export type AflTradeExternalCaptureOccurrence = z.infer<
  typeof aflTradeExternalCaptureOccurrenceSchema
>;
export type AflTradeExternalCaptureScheduleEvaluation = z.infer<
  typeof aflTradeExternalCaptureScheduleEvaluationSchema
>;
export type AflTradeExternalCaptureScheduleDecision = z.infer<
  typeof aflTradeExternalCaptureScheduleDecisionSchema
>;

export function createAflTradeExternalCaptureSchedule(
  input: AflTradeExternalCaptureScheduleDefinition
): AflTradeExternalCaptureSchedule {
  const definition = aflTradeExternalCaptureScheduleDefinitionSchema.parse(input);
  return aflTradeExternalCaptureScheduleSchema.parse({
    scheduleId: createAflTradeContentAddress('external-capture-schedule', definition),
    definition,
  });
}

export function createAflTradeExternalCaptureDispatchKey(
  scheduleId: string,
  dueAt: string
): string {
  return createAflTradeContentAddress('external-capture-dispatch', { scheduleId, dueAt });
}

function addSeconds(instant: string, seconds: number): string {
  return new Date(Date.parse(instant) + seconds * 1_000).toISOString();
}

function commandFor(
  schedule: AflTradeExternalCaptureSchedule,
  observedAt: string
): AflTradeExternalProviderIngestionCommand {
  const request: IngestAflTradeExternalPageRequest = {
    ...schedule.definition.requestTemplate,
    capturedAt: observedAt,
  };
  const gateRequest: AflTradeGate0ARequest = {
    ...schedule.definition.gateRequestTemplate,
    evaluatedAt: observedAt,
  };
  validateAflTradeExternalCaptureScope(request);
  return { request, gateRequest };
}

export function evaluateAflTradeExternalCaptureOccurrence(
  input: AflTradeExternalCaptureScheduleEvaluation
): AflTradeExternalCaptureScheduleDecision {
  const evaluation = aflTradeExternalCaptureScheduleEvaluationSchema.parse(input);
  const { schedule, dueAt, observedAt, priorOccurrence } = evaluation;
  const dispatchKey = createAflTradeExternalCaptureDispatchKey(schedule.scheduleId, dueAt);
  const latenessSeconds = (Date.parse(observedAt) - Date.parse(dueAt)) / 1_000;
  const terminalStatuses = new Set(['completed', 'not_modified', 'skipped_late', 'dead_letter']);
  let action: AflTradeExternalCaptureScheduleDecision['action'];
  let reason: string;
  let retryAt: string | null = null;

  if (priorOccurrence && terminalStatuses.has(priorOccurrence.status)) {
    action = 'deduplicate';
    reason = 'occurrence_already_terminal';
  } else if (latenessSeconds < 0) {
    action = 'not_due';
    reason = 'occurrence_not_due';
    retryAt = dueAt;
  } else if (latenessSeconds > schedule.definition.cadence.maximumLatenessSeconds) {
    action = 'skip_late';
    reason = 'occurrence_exceeded_lateness_limit';
  } else if (
    evaluation.consecutiveProviderFailures >=
      schedule.definition.execution.circuitFailureThreshold &&
    evaluation.circuitOpenedAt !== null &&
    Date.parse(observedAt) <
      Date.parse(evaluation.circuitOpenedAt) +
        schedule.definition.execution.circuitResetSeconds * 1_000
  ) {
    action = 'defer_circuit';
    reason = 'provider_circuit_open';
    retryAt = addSeconds(
      evaluation.circuitOpenedAt,
      schedule.definition.execution.circuitResetSeconds
    );
  } else if (
    priorOccurrence?.status === 'leased' &&
    Date.parse(priorOccurrence.lastClaim!.leaseExpiresAt) > Date.parse(observedAt)
  ) {
    action = 'defer_lease';
    reason = 'occurrence_lease_active';
    retryAt = priorOccurrence.lastClaim!.leaseExpiresAt;
  } else if (
    priorOccurrence?.status === 'retry_wait' &&
    Date.parse(priorOccurrence.availableAt) > Date.parse(observedAt)
  ) {
    action = 'defer_retry';
    reason = 'occurrence_retry_not_due';
    retryAt = priorOccurrence.availableAt;
  } else if (
    priorOccurrence &&
    priorOccurrence.lastClaim!.attemptNumber >= schedule.definition.execution.maximumAttempts
  ) {
    action = 'dead_letter';
    reason = 'occurrence_attempts_exhausted';
  } else {
    action = 'claim';
    reason = priorOccurrence ? 'occurrence_ready_for_reclaim' : 'occurrence_ready';
  }

  const attemptNumber = (priorOccurrence?.lastClaim?.attemptNumber ?? 0) + 1;
  const leaseExpiresAt = addSeconds(observedAt, schedule.definition.execution.leaseSeconds);
  const claimContent = {
    dispatchKey,
    attemptNumber,
    claimedAt: observedAt,
    leaseExpiresAt,
    workerId: evaluation.workerId,
    leaseTokenSha256: evaluation.leaseTokenSha256,
  };
  const proposedClaim =
    action === 'claim'
      ? aflTradeExternalCaptureClaimSchema.parse({
          claimId: createAflTradeContentAddress('external-capture-claim', claimContent),
          scheduleId: schedule.scheduleId,
          dueAt,
          ...claimContent,
        })
      : null;
  const command = action === 'claim' ? commandFor(schedule, observedAt) : null;
  const proposedOccurrence =
    action === 'claim'
      ? aflTradeExternalCaptureOccurrenceSchema.parse({
          dispatchKey,
          scheduleId: schedule.scheduleId,
          dueAt,
          status: 'leased',
          availableAt: observedAt,
          completedAt: null,
          resultId: null,
          failureCode: null,
          lastClaim: proposedClaim,
        })
      : action === 'skip_late'
        ? aflTradeExternalCaptureOccurrenceSchema.parse({
            dispatchKey,
            scheduleId: schedule.scheduleId,
            dueAt,
            status: 'skipped_late',
            availableAt: observedAt,
            completedAt: observedAt,
            resultId: null,
            failureCode: null,
            lastClaim: null,
          })
        : action === 'dead_letter'
          ? aflTradeExternalCaptureOccurrenceSchema.parse({
              ...priorOccurrence!,
              status: 'dead_letter',
              availableAt: observedAt,
              completedAt: observedAt,
              resultId: null,
              failureCode: null,
            })
          : null;
  const content = {
    schemaVersion: 'afl-trade-external-capture-schedule-decision/v1' as const,
    scheduleId: schedule.scheduleId,
    dispatchKey,
    dueAt,
    observedAt,
    action,
    reason,
    retryAt,
    proposedClaim,
    proposedOccurrence,
    command,
  };
  return aflTradeExternalCaptureScheduleDecisionSchema.parse({
    decisionId: createAflTradeContentAddress('external-capture-schedule-decision', content),
    ...content,
  });
}
