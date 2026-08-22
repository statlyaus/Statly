import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../../artifacts/contentAddress';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from '../automatedPrivateEvaluationPolicy';

const LIMITATION =
  'Private non-production evaluation batch only; it grants no factual, production, or publication authority.' as const;
const WITHDRAWAL_LIMITATION =
  'Emergency private-reader suppression only; it does not alter factual, model, production, or publication authority.' as const;
const ROLLBACK_LIMITATION =
  'Emergency private batch rollback only; it restores previously authenticated private visibility and grants no factual, model, production, or publication authority.' as const;
const ROLLBACK_AUTHORIZATION_WINDOW_MILLISECONDS = 15 * 60 * 1_000;
const scopedIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(400)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u);
const instantSchema = z.iso.datetime({ offset: true });
const batchIdSchema = aflTradeContentAddressedIdSchema('private-evaluation-batch');
const generationIdSchema = aflTradeContentAddressedIdSchema(
  'local-private-trade-evaluation-generation'
);

const batchBlockerSchema = z
  .object({
    code: z.enum([
      'source_blocked',
      'insufficient_data',
      'identity_unresolved',
      'lineage_unresolved',
      'model_not_approved',
      'reconciliation_failed',
      'engineering_unavailable',
      'component_output_unavailable',
      'unsupported_trade',
      'policy_unavailable',
      'temporal_evidence_unavailable',
    ]),
    message: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const governedPrivateEvaluationBatchEntrySchema = z.discriminatedUnion('state', [
  z
    .object({
      tradeId: scopedIdSchema,
      state: z.literal('ready'),
      generationId: generationIdSchema,
    })
    .strict(),
  z
    .object({
      tradeId: scopedIdSchema,
      state: z.literal('unavailable'),
      blockers: z.array(batchBlockerSchema).min(1).max(10_000),
    })
    .strict(),
]);

const batchContentSchema = z
  .object({
    schemaVersion: z.literal('governed-private-evaluation-batch/v1'),
    environment: z.literal('non_production'),
    scopeKey: scopedIdSchema,
    preparedInputSetId: aflTradeContentAddressedIdSchema('prepared-valuation-input-set'),
    preparedInputSetRevision: z.number().int().positive(),
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    modelQualificationId: aflTradeContentAddressedIdSchema('model-qualification'),
    modelQualificationWorkId: aflTradeContentAddressedIdSchema('model-qualification-work'),
    entries: z.array(governedPrivateEvaluationBatchEntrySchema).min(1).max(10_000),
    tradeCount: z.number().int().positive(),
    readyCount: z.number().int().nonnegative(),
    unavailableCount: z.number().int().nonnegative(),
    createdAt: instantSchema,
    publicationEligible: z.literal(false),
    limitation: z.literal(LIMITATION),
  })
  .strict()
  .superRefine((batch, context) => {
    const tradeIds = batch.entries.map(({ tradeId }) => tradeId);
    if (
      new Set(tradeIds).size !== tradeIds.length ||
      tradeIds.some((tradeId, index) => index > 0 && tradeIds[index - 1]! > tradeId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Private evaluation batch trades must be unique and canonically ordered.',
      });
    }
    const readyCount = batch.entries.filter(({ state }) => state === 'ready').length;
    if (
      batch.tradeCount !== batch.entries.length ||
      batch.readyCount !== readyCount ||
      batch.unavailableCount !== batch.entries.length - readyCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tradeCount'],
        message: 'Private evaluation batch counts must exactly match its exhaustive entries.',
      });
    }
  });

export const governedPrivateEvaluationBatchSchema = z
  .object({ batchId: batchIdSchema, content: batchContentSchema })
  .strict()
  .superRefine((batch, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-batch',
      batch.batchId,
      batch.content,
      context,
      ['batchId']
    );
  });

export type GovernedPrivateEvaluationBatch = z.infer<typeof governedPrivateEvaluationBatchSchema>;

export function createGovernedPrivateEvaluationBatchOperationId(input: {
  readonly scopeKey: string;
  readonly batchId: string;
  readonly expectedRevision: number;
  readonly action: 'activate';
}): string {
  return createAflTradeContentAddress('private-evaluation-batch-operation', {
    ...input,
    principalId: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
  });
}

export function createGovernedPrivateEvaluationBatch(
  input: Omit<
    z.input<typeof batchContentSchema>,
    | 'schemaVersion'
    | 'environment'
    | 'tradeCount'
    | 'readyCount'
    | 'unavailableCount'
    | 'publicationEligible'
    | 'limitation'
  >
): GovernedPrivateEvaluationBatch {
  const entries = input.entries;
  const readyCount = entries.filter(({ state }) => state === 'ready').length;
  const content = batchContentSchema.parse({
    schemaVersion: 'governed-private-evaluation-batch/v1',
    environment: 'non_production',
    ...input,
    tradeCount: entries.length,
    readyCount,
    unavailableCount: entries.length - readyCount,
    publicationEligible: false,
    limitation: LIMITATION,
  });
  return governedPrivateEvaluationBatchSchema.parse({
    batchId: createAflTradeContentAddress('private-evaluation-batch', content),
    content,
  });
}

const rollbackContentSchema = z
  .object({
    schemaVersion: z.literal('governed-private-evaluation-batch-rollback/v1'),
    environment: z.literal('non_production'),
    scopeKey: scopedIdSchema,
    fromBatchId: batchIdSchema,
    toBatchId: batchIdSchema,
    expectedRevision: z.number().int().positive(),
    principalId: z.string().trim().min(1).max(400),
    authorityEvidenceId: aflTradeContentAddressedIdSchema('reviewer-authority-evidence'),
    reason: z.string().trim().min(1).max(2_000),
    authorizedAt: instantSchema,
    expiresAt: instantSchema,
    publicationEligible: z.literal(false),
    limitation: z.literal(ROLLBACK_LIMITATION),
  })
  .strict()
  .superRefine((rollback, context) => {
    if (rollback.fromBatchId === rollback.toBatchId) {
      context.addIssue({
        code: 'custom',
        path: ['toBatchId'],
        message: 'Emergency rollback must restore a different retained batch.',
      });
    }
    if (
      Date.parse(rollback.expiresAt) - Date.parse(rollback.authorizedAt) !==
      ROLLBACK_AUTHORIZATION_WINDOW_MILLISECONDS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Emergency rollback authorization must use an exact 15-minute window.',
      });
    }
  });

export const governedPrivateEvaluationBatchRollbackSchema = z
  .object({
    operationId: aflTradeContentAddressedIdSchema('private-evaluation-batch-operation'),
    content: rollbackContentSchema,
  })
  .strict()
  .superRefine((rollback, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-batch-operation',
      rollback.operationId,
      rollback.content,
      context,
      ['operationId']
    );
  });

export type GovernedPrivateEvaluationBatchRollback = z.infer<
  typeof governedPrivateEvaluationBatchRollbackSchema
>;

export function createGovernedPrivateEvaluationBatchRollback(
  input: Omit<
    z.input<typeof rollbackContentSchema>,
    'schemaVersion' | 'environment' | 'publicationEligible' | 'limitation'
  >
): GovernedPrivateEvaluationBatchRollback {
  const content = rollbackContentSchema.parse({
    ...input,
    schemaVersion: 'governed-private-evaluation-batch-rollback/v1',
    environment: 'non_production',
    publicationEligible: false,
    limitation: ROLLBACK_LIMITATION,
  });
  return governedPrivateEvaluationBatchRollbackSchema.parse({
    operationId: createAflTradeContentAddress('private-evaluation-batch-operation', content),
    content,
  });
}

const withdrawalContentSchema = z
  .object({
    schemaVersion: z.literal('governed-private-evaluation-batch-withdrawal/v1'),
    environment: z.literal('non_production'),
    scopeKey: scopedIdSchema,
    batchId: batchIdSchema,
    tradeId: scopedIdSchema,
    generationId: generationIdSchema,
    principalId: z.string().trim().min(1).max(400),
    reason: z.string().trim().min(1).max(2_000),
    withdrawnAt: instantSchema,
    publicationEligible: z.literal(false),
    limitation: z.literal(WITHDRAWAL_LIMITATION),
  })
  .strict();

export const governedPrivateEvaluationBatchWithdrawalSchema = z
  .object({
    withdrawalId: aflTradeContentAddressedIdSchema('private-evaluation-batch-withdrawal'),
    content: withdrawalContentSchema,
  })
  .strict()
  .superRefine((withdrawal, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-batch-withdrawal',
      withdrawal.withdrawalId,
      withdrawal.content,
      context,
      ['withdrawalId']
    );
  });

export type GovernedPrivateEvaluationBatchWithdrawal = z.infer<
  typeof governedPrivateEvaluationBatchWithdrawalSchema
>;

export function createGovernedPrivateEvaluationBatchWithdrawal(
  input: Omit<
    z.input<typeof withdrawalContentSchema>,
    'schemaVersion' | 'environment' | 'publicationEligible' | 'limitation'
  >
): GovernedPrivateEvaluationBatchWithdrawal {
  const content = withdrawalContentSchema.parse({
    schemaVersion: 'governed-private-evaluation-batch-withdrawal/v1',
    environment: 'non_production',
    ...input,
    publicationEligible: false,
    limitation: WITHDRAWAL_LIMITATION,
  });
  return governedPrivateEvaluationBatchWithdrawalSchema.parse({
    withdrawalId: createAflTradeContentAddress('private-evaluation-batch-withdrawal', content),
    content,
  });
}
