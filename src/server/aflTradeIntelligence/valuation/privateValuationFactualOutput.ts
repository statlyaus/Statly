import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const AFL_TRADE_PRIVATE_VALUATION_FACTUAL_OUTPUT_SCHEMA_VERSION =
  'afl-trade-private-valuation-factual-output/v1' as const;
export const AFL_TRADE_ADMITTED_PLAYER_FACTUAL_OUTPUT_SCHEMA_VERSION =
  'afl-trade-private-valuation-factual-output/v2' as const;
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
const admittedPlayerSourceCaptureSchema = z
  .object({
    captureId: aflTradeContentAddressedIdSchema('source-capture'),
    sourceSnapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
    consumedFieldSetId: aflTradeContentAddressedIdSchema('consumed-field-set'),
    consumedFieldSetSha256: aflTradeSha256Schema,
  })
  .strict();

export const aflTradePrivateValuationFactualOutputContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_VALUATION_FACTUAL_OUTPUT_SCHEMA_VERSION),
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    valuationScopeKey: boundedPublicIdSchema,
    captureBindingId: aflTradeContentAddressedIdSchema('private-valuation-capture-binding'),
    sourceAdmissionId: aflTradeContentAddressedIdSchema('private-valuation-source-admission'),
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
          reconciliation.factualRunId !== `factual-reconciliation-run:${reconciliation.runSha256}`
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
  if (
    new Set(spellMetricBatches.map(({ batchId }) => batchId)).size !== spellMetricBatches.length
  ) {
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

export const aflTradeAdmittedPlayerFactualOutputContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_ADMITTED_PLAYER_FACTUAL_OUTPUT_SCHEMA_VERSION),
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    valuationScopeKey: boundedPublicIdSchema,
    admittedPlayerDataset: z
      .object({
        datasetId: aflTradeContentAddressedIdSchema('dataset'),
        admissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
      })
      .strict(),
    sourceCaptures: z.array(admittedPlayerSourceCaptureSchema).min(1).max(100_000),
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
    const captureIds = content.sourceCaptures.map(({ captureId }) => captureId);
    if (
      new Set(captureIds).size !== captureIds.length ||
      captureIds.some((captureId, index) => index > 0 && captureIds[index - 1]! >= captureId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceCaptures'],
        message: 'Admitted-player source captures must be unique and canonically ordered.',
      });
    }
    const fieldSetIds = content.sourceCaptures.map(({ consumedFieldSetId }) => consumedFieldSetId);
    if (new Set(fieldSetIds).size !== fieldSetIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceCaptures'],
        message: 'Admitted-player consumed field sets must be unique.',
      });
    }
    const batchIds = content.spellMetricBatches.map(({ batchId }) => batchId);
    if (
      new Set(batchIds).size !== batchIds.length ||
      batchIds.some((batchId, index) => index > 0 && batchIds[index - 1]! >= batchId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['spellMetricBatches'],
        message: 'Spell-metric batch references must be unique and canonically ordered.',
      });
    }
  });

export const aflTradeAdmittedPlayerFactualOutputSchema = z
  .object({
    outputId: aflTradeContentAddressedIdSchema('private-valuation-factual-output'),
    content: aflTradeAdmittedPlayerFactualOutputContentSchema,
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

export type AflTradeAdmittedPlayerFactualOutput = z.infer<
  typeof aflTradeAdmittedPlayerFactualOutputSchema
>;

export type CreateAflTradeAdmittedPlayerFactualOutputInput = Omit<
  z.input<typeof aflTradeAdmittedPlayerFactualOutputContentSchema>,
  'schemaVersion' | 'environment' | 'publicationEligible' | 'publicationProhibited' | 'limitation'
>;

export function createAflTradeAdmittedPlayerFactualOutput(
  input: CreateAflTradeAdmittedPlayerFactualOutputInput
): AflTradeAdmittedPlayerFactualOutput {
  const content = aflTradeAdmittedPlayerFactualOutputContentSchema.parse({
    ...input,
    schemaVersion: AFL_TRADE_ADMITTED_PLAYER_FACTUAL_OUTPUT_SCHEMA_VERSION,
    sourceCaptures: [...input.sourceCaptures].sort((left, right) =>
      left.captureId.localeCompare(right.captureId)
    ),
    spellMetricBatches: [...input.spellMetricBatches].sort((left, right) =>
      left.batchId.localeCompare(right.batchId)
    ),
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    limitation: AFL_TRADE_PRIVATE_VALUATION_FACTUAL_OUTPUT_LIMITATION,
  });
  return aflTradeAdmittedPlayerFactualOutputSchema.parse({
    outputId: createAflTradeContentAddress('private-valuation-factual-output', content),
    content,
  });
}

export function parseAflTradeAdmittedPlayerFactualOutput(
  value: unknown
): AflTradeAdmittedPlayerFactualOutput {
  return aflTradeAdmittedPlayerFactualOutputSchema.parse(value);
}

export function parseAflTradePrivateValuationFactualOutput(
  value: unknown
): AflTradePrivateValuationFactualOutput {
  return aflTradePrivateValuationFactualOutputSchema.parse(value);
}

export type AflTradePlayerModelFactualOutput =
  | AflTradeAdmittedPlayerFactualOutput
  | AflTradePrivateValuationFactualOutput;

export function parseAflTradePlayerModelFactualOutput(
  value: unknown
): AflTradePlayerModelFactualOutput {
  return z
    .union([
      aflTradeAdmittedPlayerFactualOutputSchema,
      aflTradePrivateValuationFactualOutputSchema,
    ])
    .parse(value);
}

type FactualParent = Readonly<{
  factualReleaseId: string;
  factualCandidateId: string;
  sourceMemberSetSha256: string;
}>;

export function doesAflTradePlayerModelFactualAuthorityMatch(input: {
  readonly factual: AflTradePlayerModelFactualOutput;
  readonly requestId: string;
  readonly outputId: string;
  readonly valuationScopeKey: string;
  readonly factualValuesSha256: string;
  readonly target: Readonly<{ datasetId: string; admissionId: string }>;
  readonly dataset: FactualParent & Readonly<{ datasetId: string }>;
  readonly admission: FactualParent & Readonly<{ admissionId: string }>;
  readonly admittedSources: readonly z.infer<typeof admittedPlayerSourceCaptureSchema>[];
  readonly legacySourceCapture?: Readonly<{
    captureId: string;
    sourceSnapshotId: string;
  }>;
}): boolean {
  const content = input.factual.content;
  const parentMatches = (parent: FactualParent) =>
    parent.factualReleaseId === content.factualRelease.releaseId &&
    parent.factualCandidateId === content.candidate.candidateId &&
    parent.sourceMemberSetSha256 === content.candidate.memberSetSha256;
  if (
    content.requestId !== input.requestId ||
    input.factual.outputId !== input.outputId ||
    content.valuationScopeKey !== input.valuationScopeKey ||
    content.candidate.memberSetSha256 !== input.factualValuesSha256 ||
    input.dataset.datasetId !== input.target.datasetId ||
    input.admission.admissionId !== input.target.admissionId ||
    !parentMatches(input.dataset) ||
    !parentMatches(input.admission)
  ) {
    return false;
  }
  if (content.schemaVersion === AFL_TRADE_PRIVATE_VALUATION_FACTUAL_OUTPUT_SCHEMA_VERSION) {
    return (
      input.legacySourceCapture !== undefined &&
      input.admittedSources.some(
        (source) =>
          source.captureId === input.legacySourceCapture?.captureId &&
          source.sourceSnapshotId === input.legacySourceCapture.sourceSnapshotId
      )
    );
  }
  return (
    content.admittedPlayerDataset.datasetId === input.dataset.datasetId &&
    content.admittedPlayerDataset.admissionId === input.admission.admissionId &&
    canonicalizeAflTradeJson(content.sourceCaptures) ===
      canonicalizeAflTradeJson(input.admittedSources)
  );
}
