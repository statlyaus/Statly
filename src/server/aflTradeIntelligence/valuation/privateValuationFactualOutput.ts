import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const AFL_TRADE_PRIVATE_VALUATION_FACTUAL_OUTPUT_SCHEMA_VERSION =
  'afl-trade-private-valuation-factual-output/v1' as const;
export const AFL_TRADE_PRIVATE_VALUATION_FACTUAL_OUTPUT_LIMITATION =
  'Retained non-production factual preparation custody only; it grants no model-training, private-evaluation, publication, or production authority.' as const;

const boundedPublicIdSchema = z.string().trim().min(1).max(300);
const utcInstantSchema = z
  .string()
  .datetime({ offset: true, precision: 3 })
  .regex(/Z$/, 'Factual-output instants must use canonical UTC Z notation.');

function immutableReferenceSchema(prefix: string, idKey: string, shaKey: string) {
  return z
    .object({
      [idKey]: aflTradeContentAddressedIdSchema(prefix),
      [shaKey]: aflTradeSha256Schema,
    })
    .strict()
    .superRefine((reference, context) => {
      if (reference[idKey] !== `${prefix}:${reference[shaKey]}`) {
        context.addIssue({
          code: 'custom',
          path: [shaKey],
          message: `${prefix} digest must equal its content-address suffix.`,
        });
      }
    });
}

const factBatchSchema = immutableReferenceSchema('source-fact-batch', 'batchId', 'batchSha256');
const spellMetricBatchSchema = immutableReferenceSchema(
  'acquisition-spell-metric-batch',
  'batchId',
  'batchSha256'
);
const candidateSchema = immutableReferenceSchema(
  'factual-release-candidate',
  'candidateId',
  'candidateSha256'
).extend({ memberSetSha256: aflTradeSha256Schema });
const factualReleaseSchema = immutableReferenceSchema(
  'outcome-release',
  'releaseId',
  'releaseSha256'
);

export const aflTradePrivateValuationFactualOutputContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_VALUATION_FACTUAL_OUTPUT_SCHEMA_VERSION),
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    valuationScopeKey: boundedPublicIdSchema,
    captureBindingId: aflTradeContentAddressedIdSchema('private-valuation-capture-binding'),
    sourceAdmissionId: aflTradeContentAddressedIdSchema(
      'private-valuation-source-admission'
    ),
    normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
    factBatch: factBatchSchema,
    reconciliation: z
      .object({
        factualRunId: aflTradeContentAddressedIdSchema('factual-reconciliation-run'),
        runSha256: aflTradeSha256Schema,
        outputSetSha256: aflTradeSha256Schema,
        finalizedAt: utcInstantSchema,
      })
      .strict()
      .superRefine((reconciliation, context) => {
        if (
          reconciliation.factualRunId !==
          `factual-reconciliation-run:${reconciliation.runSha256}`
        ) {
          context.addIssue({
            code: 'custom',
            path: ['runSha256'],
            message: 'Factual-reconciliation-run digest must equal its content-address suffix.',
          });
        }
      }),
    spellMetricBatches: z.array(spellMetricBatchSchema).min(1).max(100_000),
    candidate: candidateSchema,
    factualRelease: factualReleaseSchema,
    preparedAt: utcInstantSchema,
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(AFL_TRADE_PRIVATE_VALUATION_FACTUAL_OUTPUT_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    const batchIds = content.spellMetricBatches.map(({ batchId }) => batchId);
    if (new Set(batchIds).size !== batchIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['spellMetricBatches'],
        message: 'Spell-metric batch references must be unique.',
      });
    }
    if (batchIds.some((batchId, index) => index > 0 && batchIds[index - 1]! > batchId)) {
      context.addIssue({
        code: 'custom',
        path: ['spellMetricBatches'],
        message: 'Spell-metric batch references must use canonical order.',
      });
    }
    if (Date.parse(content.preparedAt) < Date.parse(content.reconciliation.finalizedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['preparedAt'],
        message: 'Factual output cannot predate reconciliation finalization.',
      });
    }
  });

export const aflTradePrivateValuationFactualOutputSchema = z
  .object({
    outputId: aflTradeContentAddressedIdSchema('private-valuation-factual-output'),
    content: aflTradePrivateValuationFactualOutputContentSchema,
  })
  .strict()
  .superRefine((output, context) => {
    addAflTradeContentAddressIssue(
      'private-valuation-factual-output',
      output.outputId,
      output.content,
      context,
      ['outputId']
    );
  });

export type AflTradePrivateValuationFactualOutput = z.infer<
  typeof aflTradePrivateValuationFactualOutputSchema
>;

export type CreateAflTradePrivateValuationFactualOutputInput = Omit<
  z.input<typeof aflTradePrivateValuationFactualOutputContentSchema>,
  'schemaVersion' | 'environment' | 'publicationEligible' | 'publicationProhibited' | 'limitation'
>;

export function createAflTradePrivateValuationFactualOutput(
  input: CreateAflTradePrivateValuationFactualOutputInput
): AflTradePrivateValuationFactualOutput {
  const spellMetricBatches = [...input.spellMetricBatches].sort((left, right) =>
    left.batchId.localeCompare(right.batchId)
  );
  if (new Set(spellMetricBatches.map(({ batchId }) => batchId)).size !== spellMetricBatches.length) {
    throw new TypeError('Spell-metric batch references must be unique.');
  }
  const content = aflTradePrivateValuationFactualOutputContentSchema.parse({
    ...input,
    schemaVersion: AFL_TRADE_PRIVATE_VALUATION_FACTUAL_OUTPUT_SCHEMA_VERSION,
    spellMetricBatches,
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    limitation: AFL_TRADE_PRIVATE_VALUATION_FACTUAL_OUTPUT_LIMITATION,
  });
  return aflTradePrivateValuationFactualOutputSchema.parse({
    outputId: createAflTradeContentAddress('private-valuation-factual-output', content),
    content,
  });
}

export function parseAflTradePrivateValuationFactualOutput(
  value: unknown
): AflTradePrivateValuationFactualOutput {
  return aflTradePrivateValuationFactualOutputSchema.parse(value);
}
