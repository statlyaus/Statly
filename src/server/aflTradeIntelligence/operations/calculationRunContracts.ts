import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/);

function addUniqueIssue(
  values: readonly string[],
  context: z.RefinementCtx,
  path: string,
  message: string
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', path: [path], message });
  }
}

export const AFL_TRADE_CALCULATION_RUN_STATES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export const aflTradeCalculationRunInputsSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-calculation-inputs/v1'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    calculationAsOf: isoDateTimeSchema,
    knowledgeCutoffAt: isoDateTimeSchema,
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    datasetIds: z.array(aflTradeContentAddressedIdSchema('dataset')).min(1).max(100),
    evidenceManifestIds: z
      .array(aflTradeContentAddressedIdSchema('evidence-manifest'))
      .min(1)
      .max(100),
    sourceRegisterIds: z.array(publicIdSchema).min(1).max(50),
    requestedViews: z.array(z.enum(AFL_TRADE_VALUATION_VIEWS)).min(1).max(4),
    codeCommitSha: gitCommitSchema,
    configurationArtifact: aflTradeArtifactRefSchema,
  })
  .strict()
  .superRefine((inputs, context) => {
    if (Date.parse(inputs.knowledgeCutoffAt) > Date.parse(inputs.calculationAsOf)) {
      context.addIssue({
        code: 'custom',
        path: ['knowledgeCutoffAt'],
        message: 'Knowledge cutoff cannot follow the calculation as-of time.',
      });
    }
    addUniqueIssue(inputs.datasetIds, context, 'datasetIds', 'Dataset identifiers must be unique.');
    addUniqueIssue(
      inputs.evidenceManifestIds,
      context,
      'evidenceManifestIds',
      'Evidence-manifest identifiers must be unique.'
    );
    addUniqueIssue(
      inputs.sourceRegisterIds,
      context,
      'sourceRegisterIds',
      'Source-register identifiers must be unique.'
    );
    addUniqueIssue(
      inputs.requestedViews,
      context,
      'requestedViews',
      'Requested valuation views must be unique.'
    );
    if (Date.parse(inputs.configurationArtifact.createdAt) > Date.parse(inputs.calculationAsOf)) {
      context.addIssue({
        code: 'custom',
        path: ['configurationArtifact', 'createdAt'],
        message: 'Calculation configuration must exist by the calculation as-of time.',
      });
    }
  });

export const aflTradeLastGoodPublicationSnapshotSchema = z
  .object({
    scopeKey: publicIdSchema,
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    projectionId: aflTradeContentAddressedIdSchema('projection'),
    registryRevision: z.number().int().nonnegative(),
    activatedAt: isoDateTimeSchema,
    capturedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (Date.parse(snapshot.activatedAt) > Date.parse(snapshot.capturedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['capturedAt'],
        message: 'A last-good publication cannot be captured before it was activated.',
      });
    }
  });

const attemptIdentityShape = {
  attemptId: aflTradeContentAddressedIdSchema('calculation-attempt'),
  attemptNumber: z.number().int().positive(),
  queuedAt: isoDateTimeSchema,
  initiatedBy: publicIdSchema,
};

const leaseSchema = z
  .object({
    leaseId: publicIdSchema,
    workerIdentity: publicIdSchema,
    acquiredAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((lease, context) => {
    if (Date.parse(lease.expiresAt) <= Date.parse(lease.acquiredAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'A calculation lease must expire after it is acquired.',
      });
    }
  });

const runningAttemptShape = {
  ...attemptIdentityShape,
  startedAt: isoDateTimeSchema,
  heartbeatAt: isoDateTimeSchema,
  lease: leaseSchema,
};

const successfulResultSchema = z
  .object({
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    projectionId: aflTradeContentAddressedIdSchema('projection'),
    publicationManifestArtifact: aflTradeArtifactRefSchema,
    projectionManifestArtifact: aflTradeArtifactRefSchema,
    diagnosticsArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const failedResultSchema = z
  .object({
    classification: z.enum([
      'invalid_input',
      'source_unavailable',
      'data_quality',
      'identity_unresolved',
      'lineage_unresolved',
      'calculation_failure',
      'projection_failure',
      'infrastructure_failure',
      'lease_expired',
    ]),
    retryable: z.boolean(),
    reasonCode: publicIdSchema,
    message: z.string().trim().min(1).max(1_000),
    diagnosticsArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const queuedAttemptSchema = z
  .object({ ...attemptIdentityShape, state: z.literal('queued') })
  .strict();

const runningAttemptSchema = z
  .object({ ...runningAttemptShape, state: z.literal('running') })
  .strict();

const succeededAttemptSchema = z
  .object({
    ...runningAttemptShape,
    state: z.literal('succeeded'),
    finishedAt: isoDateTimeSchema,
    result: successfulResultSchema,
  })
  .strict();

const failedAttemptSchema = z
  .object({
    ...runningAttemptShape,
    state: z.literal('failed'),
    finishedAt: isoDateTimeSchema,
    result: failedResultSchema,
  })
  .strict();

const cancelledExecutionSchema = z
  .object({
    startedAt: isoDateTimeSchema,
    heartbeatAt: isoDateTimeSchema,
    lease: leaseSchema,
  })
  .strict();

const cancelledAttemptSchema = z
  .object({
    ...attemptIdentityShape,
    state: z.literal('cancelled'),
    execution: cancelledExecutionSchema.nullable(),
    finishedAt: isoDateTimeSchema,
    cancelledBy: publicIdSchema,
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const aflTradeCalculationAttemptSchema = z
  .discriminatedUnion('state', [
    queuedAttemptSchema,
    runningAttemptSchema,
    succeededAttemptSchema,
    failedAttemptSchema,
    cancelledAttemptSchema,
  ])
  .superRefine((attempt, context) => {
    const execution =
      attempt.state === 'cancelled' ? attempt.execution : 'startedAt' in attempt ? attempt : null;
    if (execution) {
      const queuedAt = Date.parse(attempt.queuedAt);
      const startedAt = Date.parse(execution.startedAt);
      const heartbeatAt = Date.parse(execution.heartbeatAt);
      if (
        startedAt < queuedAt ||
        Date.parse(execution.lease.acquiredAt) < startedAt ||
        heartbeatAt < Date.parse(execution.lease.acquiredAt) ||
        heartbeatAt > Date.parse(execution.lease.expiresAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['heartbeatAt'],
          message: 'Attempt queue, start, lease, and heartbeat times must be chronological.',
        });
      }
    }
    if ('finishedAt' in attempt) {
      const earliestFinish = execution
        ? Date.parse(execution.heartbeatAt)
        : Date.parse(attempt.queuedAt);
      if (Date.parse(attempt.finishedAt) < earliestFinish) {
        context.addIssue({
          code: 'custom',
          path: ['finishedAt'],
          message: 'A calculation attempt cannot finish before its latest recorded activity.',
        });
      }
    }
    if (attempt.state === 'succeeded' || attempt.state === 'failed') {
      const artifacts =
        attempt.state === 'succeeded'
          ? [
              attempt.result.publicationManifestArtifact,
              attempt.result.projectionManifestArtifact,
              attempt.result.diagnosticsArtifact,
            ]
          : [attempt.result.diagnosticsArtifact];
      if (
        artifacts.some(
          (artifact) =>
            Date.parse(artifact.createdAt) < Date.parse(attempt.startedAt) ||
            Date.parse(artifact.createdAt) > Date.parse(attempt.finishedAt)
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['result'],
          message: 'Terminal result artifacts must be created during the recorded attempt.',
        });
      }
    }
  });

export const aflTradeCalculationRunSchema = z
  .object({
    runId: aflTradeContentAddressedIdSchema('calculation-run'),
    inputs: aflTradeCalculationRunInputsSchema,
    state: z.enum(AFL_TRADE_CALCULATION_RUN_STATES),
    attempts: z.array(aflTradeCalculationAttemptSchema).min(1).max(100),
    lastGoodAtStart: aflTradeLastGoodPublicationSnapshotSchema.nullable(),
    candidatePublicationId: aflTradeContentAddressedIdSchema('publication').nullable(),
    candidateProjectionId: aflTradeContentAddressedIdSchema('projection').nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((run, context) => {
    addAflTradeContentAddressIssue('calculation-run', run.runId, run.inputs, context, ['runId']);
    const seenAttemptIds = new Set<string>();
    for (let index = 0; index < run.attempts.length; index += 1) {
      const attempt = run.attempts[index];
      const expectedNumber = index + 1;
      if (attempt.attemptNumber !== expectedNumber) {
        context.addIssue({
          code: 'custom',
          path: ['attempts', index, 'attemptNumber'],
          message: 'Calculation attempts must be contiguous and one-indexed.',
        });
      }
      addAflTradeContentAddressIssue(
        'calculation-attempt',
        attempt.attemptId,
        { runId: run.runId, attemptNumber: attempt.attemptNumber },
        context,
        ['attempts', index, 'attemptId']
      );
      if (seenAttemptIds.has(attempt.attemptId)) {
        context.addIssue({
          code: 'custom',
          path: ['attempts', index, 'attemptId'],
          message: 'Calculation attempt identifiers must be unique.',
        });
      }
      seenAttemptIds.add(attempt.attemptId);
      if (index > 0) {
        const previous = run.attempts[index - 1];
        const previousFinishedAt = 'finishedAt' in previous ? previous.finishedAt : null;
        if (!previousFinishedAt || Date.parse(attempt.queuedAt) < Date.parse(previousFinishedAt)) {
          context.addIssue({
            code: 'custom',
            path: ['attempts', index, 'queuedAt'],
            message: 'A retry may be queued only after the previous attempt finishes.',
          });
        }
      }
    }

    const latest = run.attempts.at(-1);
    if (!latest || run.state !== latest.state) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Run state must match the latest calculation attempt.',
      });
      return;
    }
    const latestActivity =
      'finishedAt' in latest
        ? latest.finishedAt
        : 'heartbeatAt' in latest
          ? latest.heartbeatAt
          : latest.queuedAt;
    if (run.createdAt !== run.attempts[0].queuedAt || run.updatedAt !== latestActivity) {
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'Run timestamps must match the first queue time and latest attempt activity.',
      });
    }
    if (
      run.lastGoodAtStart &&
      Date.parse(run.lastGoodAtStart.capturedAt) > Date.parse(run.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lastGoodAtStart', 'capturedAt'],
        message: 'The last-good snapshot must be captured before the run is queued.',
      });
    }
    if (run.lastGoodAtStart && run.lastGoodAtStart.scopeKey !== run.inputs.scopeKey) {
      context.addIssue({
        code: 'custom',
        path: ['lastGoodAtStart', 'scopeKey'],
        message: 'The last-good publication must belong to the calculation public scope.',
      });
    }
    if (latest.state === 'succeeded') {
      if (
        run.candidatePublicationId !== latest.result.publicationId ||
        run.candidateProjectionId !== latest.result.projectionId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['candidatePublicationId'],
          message: 'A successful run must pin its exact publication and projection candidate.',
        });
      }
    } else if (run.candidatePublicationId !== null || run.candidateProjectionId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['candidatePublicationId'],
        message: 'Only a successful run may expose a publication candidate.',
      });
    }
  });

export type AflTradeCalculationRunInputs = z.infer<typeof aflTradeCalculationRunInputsSchema>;
export type AflTradeLastGoodPublicationSnapshot = z.infer<
  typeof aflTradeLastGoodPublicationSnapshotSchema
>;
export type AflTradeCalculationAttempt = z.infer<typeof aflTradeCalculationAttemptSchema>;
export type AflTradeCalculationRun = z.infer<typeof aflTradeCalculationRunSchema>;

export function createAflTradeCalculationRunId(inputs: AflTradeCalculationRunInputs): string {
  return createAflTradeContentAddress('calculation-run', inputs);
}

export function createAflTradeCalculationAttemptId(runId: string, attemptNumber: number): string {
  return createAflTradeContentAddress('calculation-attempt', { runId, attemptNumber });
}
