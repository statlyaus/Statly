import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradePrivatePreparedValuationAuthoritySchema } from './preparedValuationInputSet';

const idSchema = z.string().trim().min(1).max(400);
const publicAuthoritySchema = z
  .object({
    scopeKey: idSchema,
    preparedInputSetId: aflTradeContentAddressedIdSchema('prepared-valuation-input-set'),
    preparedInputSetRevision: z.number().int().positive(),
    factualReleaseRevision: z.number().int().positive(),
    modelQualificationWorkId: aflTradeContentAddressedIdSchema('model-qualification-work'),
    modelPairRevision: z.number().int().positive(),
  })
  .strict();

const privateAuthoritySchema = z
  .object({
    preparationAuthority: z.literal('dispatch_bound_private_factual_output'),
    scopeKey: idSchema,
    preparedInputSetId: aflTradeContentAddressedIdSchema('prepared-valuation-input-set'),
    preparedInputSetRevision: z.number().int().positive(),
    modelQualificationWorkId: aflTradeContentAddressedIdSchema('model-qualification-work'),
    modelPairRevision: z.number().int().positive(),
    privateAuthority: aflTradePrivatePreparedValuationAuthoritySchema,
  })
  .strict()
  .superRefine((authority, context) => {
    if (
      authority.modelQualificationWorkId !== authority.privateAuthority.modelQualificationWorkId ||
      authority.modelPairRevision !== authority.privateAuthority.modelQualificationRevision
    ) {
      context.addIssue({
        code: 'custom',
        path: ['privateAuthority'],
        message: 'Execution authority must preserve the exact prepared private model authority.',
      });
    }
  });

const authoritySchema = z.union([publicAuthoritySchema, privateAuthoritySchema]);

export const AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY = {
  schemaVersion: 'private-evaluation-cohort-execution-policy/v1',
  maximumAttemptsPerCycle: 3,
  maximumConcurrency: 8,
  leaseSeconds: 120,
  heartbeatSeconds: 30,
  retryBaseSeconds: 5,
  retryMaximumSeconds: 60,
  concurrencyPolicy: 'bounded_local_workers',
} as const;

const cycleContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-cohort-execution-cycle/v1'),
    environment: z.literal('non_production'),
    inputFingerprint: aflTradeContentAddressedIdSchema('cohort-execution-input'),
    authority: authoritySchema,
    repairSequence: z.number().int().nonnegative(),
    openingCause: z.enum(['authenticated_inputs_changed', 'explicit_repair']),
    openingPrincipalId: z.literal('system:weekly-valuation-coordinator'),
    repairOperationId: aflTradeContentAddressedIdSchema('cohort-execution-repair').nullable(),
    repairReason: z.string().trim().min(1).max(2_000).nullable(),
    repairsCycleId: aflTradeContentAddressedIdSchema('cohort-execution-cycle').nullable(),
    maximumAttemptsPerTrade: z.literal(3),
    openedAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    limitation: z.literal(
      'Private local execution control only; it grants no factual, model, production, or publication authority.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    if (
      (content.repairSequence === 0) !==
        (content.openingCause === 'authenticated_inputs_changed') ||
      (content.repairSequence === 0) !== (content.repairsCycleId === null) ||
      (content.repairSequence === 0) !== (content.repairOperationId === null) ||
      (content.repairSequence === 0) !== (content.repairReason === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['repairSequence'],
        message: 'Only an explicit repair may follow an existing execution cycle.',
      });
    }
    const expectedFingerprint = createAflTradePrivateEvaluationCohortInputFingerprint(
      content.authority
    );
    if (content.inputFingerprint !== expectedFingerprint) {
      context.addIssue({
        code: 'custom',
        path: ['inputFingerprint'],
        message: 'Execution fingerprint must bind exact authenticated cohort authority.',
      });
    }
    if (
      content.repairSequence > 0 &&
      content.repairsCycleId !==
        createAflTradeContentAddress('cohort-execution-cycle', {
          inputFingerprint: content.inputFingerprint,
          repairSequence: content.repairSequence - 1,
        })
    ) {
      context.addIssue({
        code: 'custom',
        path: ['repairsCycleId'],
        message: 'A repair must name the immediately preceding immutable cycle.',
      });
    }
  });

export const aflTradePrivateEvaluationCohortExecutionCycleSchema = z
  .object({
    cycleId: aflTradeContentAddressedIdSchema('cohort-execution-cycle'),
    content: cycleContentSchema,
  })
  .strict()
  .superRefine((cycle, context) => {
    addAflTradeContentAddressIssue(
      'cohort-execution-cycle',
      cycle.cycleId,
      {
        inputFingerprint: cycle.content.inputFingerprint,
        repairSequence: cycle.content.repairSequence,
      },
      context,
      ['cycleId']
    );
  });

export type AflTradePrivateEvaluationCohortExecutionCycle = z.infer<
  typeof aflTradePrivateEvaluationCohortExecutionCycleSchema
>;

export const aflTradePrivateEvaluationExecutionCauseSchema = z
  .object({
    code: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(4_000),
    retryable: z.boolean(),
  })
  .strict();

export const aflTradePrivateEvaluationExecutionResultSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('activated'),
      generationId: aflTradeContentAddressedIdSchema('local-private-trade-evaluation-generation'),
      generatedAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      state: z.literal('unavailable'),
      blockers: z
        .array(
          z
            .object({
              code: z.string().trim().min(1).max(200),
              message: z.string().trim().min(1).max(2_000),
            })
            .strict()
        )
        .min(1)
        .max(10_000),
    })
    .strict(),
]);

export type AflTradePrivateEvaluationExecutionCause = z.infer<
  typeof aflTradePrivateEvaluationExecutionCauseSchema
>;
export type AflTradePrivateEvaluationExecutionResult = z.infer<
  typeof aflTradePrivateEvaluationExecutionResultSchema
>;

export class AflTradePrivateEvaluationTransientExecutionError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AflTradePrivateEvaluationTransientExecutionError';
    this.code = z.string().trim().min(1).max(200).parse(code);
  }
}

const transientPostgresCodes = new Set([
  '40001',
  '40P01',
  '55P03',
  '57014',
  '57P01',
  '57P02',
  '57P03',
  '58030',
]);
const transientTransportCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENETDOWN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

function boundedErrorMessage(error: unknown): string {
  const normalized = String(error instanceof Error ? error.message : error).trim();
  return Array.from(normalized || 'Unknown transient execution failure.')
    .slice(0, 4_000)
    .join('');
}

export function classifyAflTradePrivateEvaluationExecutionError(
  error: unknown
): AflTradePrivateEvaluationExecutionCause | null {
  if (error instanceof AflTradePrivateEvaluationTransientExecutionError) {
    return { code: error.code, message: boundedErrorMessage(error), retryable: true };
  }
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = String(error.code);
  if (code.startsWith('08') || code.startsWith('53') || transientPostgresCodes.has(code)) {
    return { code: `postgres_${code}`, message: boundedErrorMessage(error), retryable: true };
  }
  if (transientTransportCodes.has(code)) {
    return { code: `transport_${code}`, message: boundedErrorMessage(error), retryable: true };
  }
  return null;
}

export function createAflTradePrivateEvaluationCohortInputFingerprint(
  input: z.input<typeof authoritySchema>
): string {
  return createAflTradeContentAddress('cohort-execution-input', authoritySchema.parse(input));
}

export function createAflTradePrivateEvaluationCohortExecutionCycle(input: {
  readonly authority: z.input<typeof authoritySchema>;
  readonly repairSequence: number;
  readonly openedAt: string;
  readonly repairOperationId?: string;
  readonly repairReason?: string;
}): AflTradePrivateEvaluationCohortExecutionCycle {
  const authority = authoritySchema.parse(input.authority);
  const repairSequence = z.number().int().nonnegative().parse(input.repairSequence);
  const inputFingerprint = createAflTradePrivateEvaluationCohortInputFingerprint(authority);
  const content = {
    schemaVersion: 'private-evaluation-cohort-execution-cycle/v1' as const,
    environment: 'non_production' as const,
    inputFingerprint,
    authority,
    repairSequence,
    openingCause:
      repairSequence === 0
        ? ('authenticated_inputs_changed' as const)
        : ('explicit_repair' as const),
    openingPrincipalId: 'system:weekly-valuation-coordinator' as const,
    repairOperationId:
      repairSequence === 0
        ? null
        : aflTradeContentAddressedIdSchema('cohort-execution-repair').parse(
            input.repairOperationId
          ),
    repairReason:
      repairSequence === 0 ? null : z.string().trim().min(1).max(2_000).parse(input.repairReason),
    repairsCycleId:
      repairSequence === 0
        ? null
        : createAflTradeContentAddress('cohort-execution-cycle', {
            inputFingerprint,
            repairSequence: repairSequence - 1,
          }),
    maximumAttemptsPerTrade:
      AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY.maximumAttemptsPerCycle,
    openedAt: input.openedAt,
    publicationEligible: false as const,
    limitation:
      'Private local execution control only; it grants no factual, model, production, or publication authority.' as const,
  };
  return aflTradePrivateEvaluationCohortExecutionCycleSchema.parse({
    cycleId: createAflTradeContentAddress('cohort-execution-cycle', {
      inputFingerprint,
      repairSequence,
    }),
    content,
  });
}
