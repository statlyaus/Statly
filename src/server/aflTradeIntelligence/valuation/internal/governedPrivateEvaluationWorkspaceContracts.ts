import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../../artifacts/artifactReference';
import { aflTradeContentAddressedIdSchema } from '../../artifacts/contentAddress';

const scopedIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(400)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u);
const instantSchema = z.iso.datetime({ offset: true });

const inspectionIdSchema = aflTradeContentAddressedIdSchema('private-evaluation-inspection');
const operationIdSchema = aflTradeContentAddressedIdSchema('private-evaluation-operation');
const generationIdSchema = aflTradeContentAddressedIdSchema(
  'local-private-trade-evaluation-generation'
);
const projectionManifestIdSchema = aflTradeContentAddressedIdSchema(
  'private-evaluation-projection-manifest'
);

export const governedPrivateEvaluationSelectorSchema = z
  .object({
    valuationScopeKey: scopedIdSchema,
    tradeId: scopedIdSchema,
  })
  .strict();

const blockerSchema = z
  .object({
    code: z.enum([
      'source_blocked',
      'insufficient_data',
      'identity_unresolved',
      'lineage_unresolved',
      'model_not_approved',
      'reconciliation_failed',
      'engineering_unavailable',
    ]),
    message: z.string().trim().min(1).max(2_000),
  })
  .strict();

const lifecycleHeadSchema = z
  .object({
    status: z.enum(['absent', 'active', 'withdrawn']),
    revision: z.number().int().nonnegative(),
    generationId: generationIdSchema.nullable(),
  })
  .strict()
  .superRefine((head, context) => {
    if ((head.status === 'active') !== (head.generationId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['generationId'],
        message: 'Only an active lifecycle head may identify a current generation.',
      });
    }
    if (head.status === 'absent' && head.revision !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['revision'],
        message: 'An absent lifecycle head must begin at revision zero.',
      });
    }
    if (head.status !== 'absent' && head.revision === 0) {
      context.addIssue({
        code: 'custom',
        path: ['revision'],
        message: 'An active or withdrawn lifecycle head must follow a committed transition.',
      });
    }
  });

export const governedPrivateEvaluationInspectRequestSchema =
  governedPrivateEvaluationSelectorSchema;

export const governedPrivateEvaluationInspectResultSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('ready'),
      selector: governedPrivateEvaluationSelectorSchema,
      inspectionId: inspectionIdSchema,
      validThrough: instantSchema,
      head: lifecycleHeadSchema,
      blockers: z.tuple([]),
    })
    .strict(),
  z
    .object({
      state: z.literal('unavailable'),
      selector: governedPrivateEvaluationSelectorSchema,
      inspectionId: inspectionIdSchema,
      validThrough: instantSchema,
      head: lifecycleHeadSchema,
      blockers: z.array(blockerSchema).min(1).max(10_000),
    })
    .strict(),
]);

const executionReviewSchema = z
  .object({
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict();

const executionActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('construct_and_activate') }).strict(),
  z.object({ kind: z.literal('recover') }).strict(),
  z
    .object({
      kind: z.literal('withdraw'),
      reason: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rollback'),
      targetGenerationId: generationIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('verify_reconstruction'),
      generationId: generationIdSchema,
    })
    .strict(),
]);

export const governedPrivateEvaluationExecuteRequestSchema = z
  .object({
    inspectionId: inspectionIdSchema,
    operationId: operationIdSchema,
    action: executionActionSchema,
    review: executionReviewSchema,
  })
  .strict();

const executionResultBase = {
  selector: governedPrivateEvaluationSelectorSchema,
  inspectionId: inspectionIdSchema,
  operationId: operationIdSchema,
};

export const governedPrivateEvaluationExecuteResultSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('activated'),
      ...executionResultBase,
      generationId: generationIdSchema,
      head: lifecycleHeadSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('withdrawn'),
      ...executionResultBase,
      head: lifecycleHeadSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('rolled_back'),
      ...executionResultBase,
      generationId: generationIdSchema,
      head: lifecycleHeadSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('recovered'),
      ...executionResultBase,
      generationId: generationIdSchema,
      head: lifecycleHeadSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('reconstruction_verified'),
      ...executionResultBase,
      generationId: generationIdSchema,
      exactMatch: z.literal(true),
    })
    .strict(),
  z
    .object({
      state: z.literal('unavailable'),
      ...executionResultBase,
      blockers: z.array(blockerSchema).min(1).max(10_000),
    })
    .strict(),
  z
    .object({
      state: z.literal('conflict'),
      ...executionResultBase,
      message: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      state: z.literal('invalid_transition'),
      ...executionResultBase,
      message: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      state: z.literal('not_found'),
      ...executionResultBase,
      resource: z.enum(['inspection', 'generation']),
    })
    .strict(),
]);

const readSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('current') }).strict(),
  z.object({ kind: z.literal('generation'), generationId: generationIdSchema }).strict(),
]);
const readDocumentSchema = z
  .object({
    kind: z.enum(['archive_summary', 'detail', 'reader_api', 'json_export']),
  })
  .strict();
const readArtifactBytesSchema = z.custom<Uint8Array>(
  (value) =>
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === '[object Uint8Array]' &&
    'length' in value &&
    typeof value.length === 'number' &&
    value.byteLength === value.length,
  'Authenticated projection bytes must be a Uint8Array.'
);
const readLifecycleSchema = z
  .object({
    status: z.enum(['active', 'withdrawn', 'superseded']),
    current: z.boolean(),
  })
  .strict()
  .superRefine((lifecycle, context) => {
    if ((lifecycle.status === 'active') !== lifecycle.current) {
      context.addIssue({
        code: 'custom',
        path: ['current'],
        message: 'Only the active generation may be labelled current.',
      });
    }
  });

export const governedPrivateEvaluationReadRequestSchema = z
  .object({
    selector: governedPrivateEvaluationSelectorSchema,
    selection: readSelectionSchema,
    document: readDocumentSchema,
  })
  .strict();

export const governedPrivateEvaluationReadResultSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('available'),
      selector: governedPrivateEvaluationSelectorSchema,
      selection: readSelectionSchema,
      generationId: generationIdSchema,
      projectionManifestId: projectionManifestIdSchema,
      lifecycle: readLifecycleSchema,
      document: readDocumentSchema.extend({ artifact: aflTradeArtifactRefSchema }).strict(),
      bytes: readArtifactBytesSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('unavailable'),
      selector: governedPrivateEvaluationSelectorSchema,
      selection: readSelectionSchema,
      document: readDocumentSchema,
      reason: z.enum([
        'not_found',
        'withdrawn',
        'projection_unavailable',
        'authentication_failed',
        'reconstruction_mismatch',
      ]),
    })
    .strict(),
]);

export type GovernedPrivateEvaluationInspectRequest = z.infer<
  typeof governedPrivateEvaluationInspectRequestSchema
>;
export type GovernedPrivateEvaluationInspectResult = z.infer<
  typeof governedPrivateEvaluationInspectResultSchema
>;
export type GovernedPrivateEvaluationExecuteRequest = z.infer<
  typeof governedPrivateEvaluationExecuteRequestSchema
>;
export type GovernedPrivateEvaluationExecuteResult = z.infer<
  typeof governedPrivateEvaluationExecuteResultSchema
>;
export type GovernedPrivateEvaluationReadRequest = z.infer<
  typeof governedPrivateEvaluationReadRequestSchema
>;
export type GovernedPrivateEvaluationReadResult = z.infer<
  typeof governedPrivateEvaluationReadResultSchema
>;
