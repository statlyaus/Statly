import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeQualifiedCurrentValuationModelEvidenceResultSchema } from './currentValuationModelEvidence';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const aflTradeValuationInputBlockerCodeSchema = z.enum([
  'source_blocked',
  'model_not_approved',
  'insufficient_data',
  'identity_unresolved',
  'lineage_unresolved',
  'unsupported_trade',
  'component_output_unavailable',
  'policy_unavailable',
  'temporal_evidence_unavailable',
]);

const blockerSubjectSchema = z
  .object({
    kind: z.enum([
      'trade',
      'player_asset',
      'pick_asset',
      'source',
      'model_component',
      'lineage',
      'policy',
    ]),
    id: publicIdSchema,
  })
  .strict();

export const aflTradeValuationInputBlockerSchema = z
  .object({
    code: aflTradeValuationInputBlockerCodeSchema,
    subject: blockerSubjectSchema,
    evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(20),
  })
  .strict();

const readyEntrySchema = z
  .object({
    tradeId: publicIdSchema,
    state: z.literal('ready'),
    calculationInputArtifact: aflTradeArtifactRefSchema,
    inputTraceArtifact: aflTradeArtifactRefSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.calculationInputArtifact.artifactId === entry.inputTraceArtifact.artifactId) {
      context.addIssue({
        code: 'custom',
        message: 'Calculation input and trace must be distinct immutable artifacts.',
      });
    }
  });

const readyEntryV2Schema = z
  .object({
    tradeId: publicIdSchema,
    state: z.literal('ready'),
    calculationInputPackageId: aflTradeContentAddressedIdSchema('valuation-calculation-input'),
    calculationInputArtifact: aflTradeArtifactRefSchema,
    inputTraceId: aflTradeContentAddressedIdSchema('private-evaluation-input-trace'),
    inputTraceArtifact: aflTradeArtifactRefSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.calculationInputArtifact.artifactId === entry.inputTraceArtifact.artifactId) {
      context.addIssue({
        code: 'custom',
        message: 'Calculation input and trace must be distinct immutable artifacts.',
      });
    }
  });

const readyEntryV3Schema = z
  .object({
    tradeId: publicIdSchema,
    state: z.literal('ready'),
    materializationManifestId: aflTradeContentAddressedIdSchema(
      'private-evaluation-materialization-manifest'
    ),
    materializationManifestArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const blockedEntrySchema = z
  .object({
    tradeId: publicIdSchema,
    state: z.literal('blocked'),
    blockers: z.array(aflTradeValuationInputBlockerSchema).min(1).max(100),
  })
  .strict()
  .superRefine((entry, context) => {
    const blockerKeys = entry.blockers.map(
      ({ code, subject }) => `${code}\u0000${subject.kind}\u0000${subject.id}`
    );
    if (new Set(blockerKeys).size !== blockerKeys.length) {
      context.addIssue({ code: 'custom', message: 'Prepared blockers must be unique.' });
    }
    if (blockerKeys.some((key, index) => index > 0 && blockerKeys[index - 1]! > key)) {
      context.addIssue({
        code: 'custom',
        message: 'Prepared blockers must use canonical code, subject-kind, and subject-id order.',
      });
    }
  });

const aflTradePreparedValuationInputEntryV1Schema = z.discriminatedUnion('state', [
  readyEntrySchema,
  blockedEntrySchema,
]);

const aflTradePreparedValuationInputEntryV2Schema = z.discriminatedUnion('state', [
  readyEntryV2Schema,
  blockedEntrySchema,
]);

export const aflTradePreparedValuationInputEntryV3Schema = z.discriminatedUnion('state', [
  readyEntryV3Schema,
  blockedEntrySchema,
]);

export const aflTradePreparedValuationInputEntrySchema = z.union([
  readyEntryV3Schema,
  readyEntryV2Schema,
  readyEntrySchema,
  blockedEntrySchema,
]);

export const AFL_TRADE_PREPARED_VALUATION_INPUT_SET_SCHEMA_VERSION =
  'afl-trade-prepared-valuation-input-set/v1' as const;
export const AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V2_SCHEMA_VERSION =
  'afl-trade-prepared-valuation-input-set/v2' as const;
export const AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION =
  'afl-trade-prepared-valuation-input-set/v3' as const;

const aflTradePreparedValuationInputSetContentV1Schema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PREPARED_VALUATION_INPUT_SET_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    scopeKey: publicIdSchema,
    factualReleaseScopeKey: publicIdSchema,
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualReleaseArtifact: aflTradeArtifactRefSchema,
    releaseMembershipArtifact: aflTradeArtifactRefSchema,
    preparationAuthority: z.literal('source_policy_preflight_only'),
    qualificationOperation: z.literal('valuation_model_training_and_derived_feature_creation'),
    qualificationReportId: aflTradeContentAddressedIdSchema('valuation-source-qualification'),
    qualificationReportArtifact: aflTradeArtifactRefSchema,
    sourceQualificationEvidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(1_000),
    releaseTradeIds: z.array(publicIdSchema).min(1).max(10_000),
    entries: z.array(aflTradePreparedValuationInputEntryV1Schema).min(1).max(10_000),
    tradeCount: z.number().int().positive().max(10_000),
    readyCount: z.number().int().nonnegative().max(10_000),
    blockedCount: z.number().int().nonnegative().max(10_000),
    preparedAt: isoDateTimeSchema,
    publicationEligible: z.literal(false),
    limitation: z.literal(
      'Private preparation evidence only; not a valuation result, publication approval, or activation authority.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const sourceEvidenceIds = content.sourceQualificationEvidenceRefs.map(
      ({ artifactId }) => artifactId
    );
    if (
      new Set(sourceEvidenceIds).size !== sourceEvidenceIds.length ||
      sourceEvidenceIds.some(
        (artifactId, index) => index > 0 && sourceEvidenceIds[index - 1]! > artifactId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceQualificationEvidenceRefs'],
        message: 'Source qualification evidence must be unique and canonically ordered.',
      });
    }
    if (new Set(content.releaseTradeIds).size !== content.releaseTradeIds.length) {
      context.addIssue({ code: 'custom', message: 'Factual-release trade IDs must be unique.' });
    }
    if (
      content.releaseTradeIds.some(
        (tradeId, index) => index > 0 && content.releaseTradeIds[index - 1]! > tradeId
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Factual-release trade IDs must use canonical order.',
      });
    }

    const entryTradeIds = content.entries.map(({ tradeId }) => tradeId);
    if (
      entryTradeIds.length !== content.releaseTradeIds.length ||
      entryTradeIds.some((tradeId, index) => tradeId !== content.releaseTradeIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Prepared entries must classify the exact factual-release trade set.',
      });
    }

    const readyCount = content.entries.filter(({ state }) => state === 'ready').length;
    const blockedCount = content.entries.length - readyCount;
    if (
      content.tradeCount !== content.entries.length ||
      content.readyCount !== readyCount ||
      content.blockedCount !== blockedCount
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Prepared input-set counts must match the exact entry classifications.',
      });
    }
    if (readyCount !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message:
          'Prepared-input-set v1 is a source-policy preflight and cannot assert model-ready trade inputs.',
      });
    }
    if (
      content.entries.some(
        (entry) =>
          entry.state !== 'blocked' ||
          entry.blockers.some(
            (blocker) => blocker.code !== 'source_blocked' || blocker.subject.kind !== 'source'
          )
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message:
          'Prepared-input-set v1 accepts only exact source-policy blockers; model and data readiness belong to the later governed construction contract.',
      });
    }

    const preparedAt = Date.parse(content.preparedAt);
    const parentArtifacts = [
      content.factualReleaseArtifact,
      content.releaseMembershipArtifact,
      content.qualificationReportArtifact,
    ];
    const entryArtifacts = content.entries.flatMap((entry) =>
      entry.state === 'ready'
        ? [entry.calculationInputArtifact, entry.inputTraceArtifact]
        : entry.blockers.flatMap(({ evidenceRefs }) => evidenceRefs)
    );
    if (
      [...parentArtifacts, ...content.sourceQualificationEvidenceRefs, ...entryArtifacts].some(
        (artifact) => Date.parse(artifact.createdAt) > preparedAt
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Every prepared input-set artifact must exist before preparation completes.',
      });
    }
  });

const aflTradePreparedValuationInputSetContentV2Schema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V2_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    scopeKey: publicIdSchema,
    factualReleaseScopeKey: publicIdSchema,
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualReleaseArtifact: aflTradeArtifactRefSchema,
    releaseMembershipArtifact: aflTradeArtifactRefSchema,
    preparationAuthority: z.literal('authenticated_calculation_evidence_snapshot'),
    qualificationOperation: z.literal('valuation_model_training_and_derived_feature_creation'),
    qualificationReportId: aflTradeContentAddressedIdSchema('valuation-source-qualification'),
    qualificationReportArtifact: aflTradeArtifactRefSchema,
    sourceQualificationEvidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(1_000),
    valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle'),
    valuationInputBundleArtifact: aflTradeArtifactRefSchema,
    releaseTradeIds: z.array(publicIdSchema).min(1).max(10_000),
    entries: z.array(aflTradePreparedValuationInputEntryV2Schema).min(1).max(10_000),
    tradeCount: z.number().int().positive().max(10_000),
    readyCount: z.number().int().nonnegative().max(10_000),
    blockedCount: z.number().int().nonnegative().max(10_000),
    preparedAt: isoDateTimeSchema,
    publicationEligible: z.literal(false),
    limitation: z.literal(
      'Private preparation evidence only; not a valuation result, publication approval, or activation authority.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const sourceEvidenceIds = content.sourceQualificationEvidenceRefs.map(
      ({ artifactId }) => artifactId
    );
    if (
      new Set(sourceEvidenceIds).size !== sourceEvidenceIds.length ||
      sourceEvidenceIds.some(
        (artifactId, index) => index > 0 && sourceEvidenceIds[index - 1]! > artifactId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceQualificationEvidenceRefs'],
        message: 'Source qualification evidence must be unique and canonically ordered.',
      });
    }

    if (
      new Set(content.releaseTradeIds).size !== content.releaseTradeIds.length ||
      content.releaseTradeIds.some(
        (tradeId, index) => index > 0 && content.releaseTradeIds[index - 1]! > tradeId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['releaseTradeIds'],
        message: 'Factual-release trade IDs must be unique and use canonical order.',
      });
    }
    const entryTradeIds = content.entries.map(({ tradeId }) => tradeId);
    if (
      entryTradeIds.length !== content.releaseTradeIds.length ||
      entryTradeIds.some((tradeId, index) => tradeId !== content.releaseTradeIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Prepared entries must classify the exact factual-release trade set.',
      });
    }

    const readyEntries = content.entries.filter(
      (entry): entry is z.infer<typeof readyEntryV2Schema> => entry.state === 'ready'
    );
    const blockedCount = content.entries.length - readyEntries.length;
    if (
      content.tradeCount !== content.entries.length ||
      content.readyCount !== readyEntries.length ||
      content.blockedCount !== blockedCount
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Prepared input-set counts must match the exact entry classifications.',
      });
    }

    for (const field of ['calculationInputPackageId', 'inputTraceId'] as const) {
      const ids = readyEntries.map((entry) => entry[field]);
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: 'custom',
          path: ['entries'],
          message: `Ready prepared entries require unique ${field} values.`,
        });
      }
    }
    const readyArtifactIds = readyEntries.flatMap((entry) => [
      entry.calculationInputArtifact.artifactId,
      entry.inputTraceArtifact.artifactId,
    ]);
    if (
      new Set([...readyArtifactIds, content.valuationInputBundleArtifact.artifactId]).size !==
      readyArtifactIds.length + 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Each ready input, trace, and valuation bundle must retain distinct bytes.',
      });
    }

    const preparedAt = Date.parse(content.preparedAt);
    const parentArtifacts = [
      content.factualReleaseArtifact,
      content.releaseMembershipArtifact,
      content.qualificationReportArtifact,
      content.valuationInputBundleArtifact,
    ];
    const entryArtifacts = content.entries.flatMap((entry) =>
      entry.state === 'ready'
        ? [entry.calculationInputArtifact, entry.inputTraceArtifact]
        : entry.blockers.flatMap(({ evidenceRefs }) => evidenceRefs)
    );
    if (
      [...parentArtifacts, ...content.sourceQualificationEvidenceRefs, ...entryArtifacts].some(
        (artifact) => Date.parse(artifact.createdAt) > preparedAt
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Every prepared input-set artifact must exist before preparation completes.',
      });
    }
  });

const preparedValuationInputSetV3CommonShape = {
  schemaVersion: z.literal(AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION),
  environment: z.literal('non_production'),
  scopeKey: publicIdSchema,
  factualReleaseScopeKey: publicIdSchema,
  factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
  factualReleaseArtifact: aflTradeArtifactRefSchema,
  releaseMembershipArtifact: aflTradeArtifactRefSchema,
  qualificationOperation: z.literal('valuation_model_training_and_derived_feature_creation'),
  valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle'),
  valuationInputBundleArtifact: aflTradeArtifactRefSchema,
  releaseTradeIds: z.array(publicIdSchema).min(1).max(10_000),
  entries: z.array(aflTradePreparedValuationInputEntryV3Schema).min(1).max(10_000),
  tradeCount: z.number().int().positive().max(10_000),
  readyCount: z.number().int().nonnegative().max(10_000),
  blockedCount: z.number().int().nonnegative().max(10_000),
  preparedAt: isoDateTimeSchema,
  publicationEligible: z.literal(false),
  limitation: z.literal(
    'Private preparation evidence only; not a valuation result, publication approval, or activation authority.'
  ),
} as const;

type PreparedValuationInputSetV3Common = z.infer<
  z.ZodObject<typeof preparedValuationInputSetV3CommonShape>
>;

function refinePreparedValuationInputSetV3(
  content: PreparedValuationInputSetV3Common,
  context: z.RefinementCtx,
  authorityArtifacts: readonly z.infer<typeof aflTradeArtifactRefSchema>[]
): void {
  if (
    new Set(content.releaseTradeIds).size !== content.releaseTradeIds.length ||
    content.releaseTradeIds.some(
      (tradeId, index) => index > 0 && content.releaseTradeIds[index - 1]! > tradeId
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['releaseTradeIds'],
      message: 'Factual-release trade IDs must be unique and use canonical order.',
    });
  }
  const entryTradeIds = content.entries.map(({ tradeId }) => tradeId);
  if (
    entryTradeIds.length !== content.releaseTradeIds.length ||
    entryTradeIds.some((tradeId, index) => tradeId !== content.releaseTradeIds[index])
  ) {
    context.addIssue({
      code: 'custom',
      path: ['entries'],
      message: 'Prepared entries must classify the exact factual-release trade set.',
    });
  }
  const readyEntries = content.entries.filter(
    (entry): entry is z.infer<typeof readyEntryV3Schema> => entry.state === 'ready'
  );
  if (
    content.tradeCount !== content.entries.length ||
    content.readyCount !== readyEntries.length ||
    content.blockedCount !== content.entries.length - readyEntries.length
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Prepared input-set counts must match the exact entry classifications.',
    });
  }
  const manifestIds = readyEntries.map(
    ({ materializationManifestId }) => materializationManifestId
  );
  if (new Set(manifestIds).size !== manifestIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['entries'],
      message: 'Ready prepared entries require unique materialization manifest identities.',
    });
  }
  const readyArtifacts = readyEntries.map(
    ({ materializationManifestArtifact }) => materializationManifestArtifact
  );
  const artifactIds = [
    content.valuationInputBundleArtifact.artifactId,
    ...readyArtifacts.map(({ artifactId }) => artifactId),
  ];
  if (new Set(artifactIds).size !== artifactIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['entries'],
      message: 'Each ready manifest and valuation bundle must retain distinct bytes.',
    });
  }
  const entryArtifacts = content.entries.flatMap((entry) =>
    entry.state === 'ready'
      ? [entry.materializationManifestArtifact]
      : entry.blockers.flatMap(({ evidenceRefs }) => evidenceRefs)
  );
  const parents = [
    content.factualReleaseArtifact,
    content.releaseMembershipArtifact,
    content.valuationInputBundleArtifact,
    ...authorityArtifacts,
    ...entryArtifacts,
  ];
  if (parents.some(({ createdAt }) => Date.parse(createdAt) > Date.parse(content.preparedAt))) {
    context.addIssue({
      code: 'custom',
      message: 'Every prepared input-set artifact must exist before preparation completes.',
    });
  }
}

const publicPreparedValuationInputSetContentV3Schema = z
  .object({
    ...preparedValuationInputSetV3CommonShape,
    preparationAuthority: z.literal('authenticated_calculation_evidence_snapshot'),
    qualificationReportId: aflTradeContentAddressedIdSchema('valuation-source-qualification'),
    qualificationReportArtifact: aflTradeArtifactRefSchema,
    sourceQualificationEvidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((content, context) => {
    const sourceEvidenceIds = content.sourceQualificationEvidenceRefs.map(
      ({ artifactId }) => artifactId
    );
    if (
      new Set(sourceEvidenceIds).size !== sourceEvidenceIds.length ||
      sourceEvidenceIds.some(
        (artifactId, index) => index > 0 && sourceEvidenceIds[index - 1]! > artifactId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceQualificationEvidenceRefs'],
        message: 'Source qualification evidence must be unique and canonically ordered.',
      });
    }
    refinePreparedValuationInputSetV3(content, context, [
      content.qualificationReportArtifact,
      ...content.sourceQualificationEvidenceRefs,
    ]);
  });

export const aflTradePrivatePreparedValuationDispatchAuthoritySchema = z
  .object({
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    factualOutputId: aflTradeContentAddressedIdSchema('private-valuation-factual-output'),
    hpnCalculationId: aflTradeContentAddressedIdSchema('hpn-pav-season'),
    modelOperationId: aflTradeContentAddressedIdSchema('private-valuation-model-operation'),
  })
  .strict();

const privatePreparedValuationInputSetContentV3Schema = z
  .object({
    ...preparedValuationInputSetV3CommonShape,
    preparationAuthority: z.literal('qualified_current_model_evidence'),
    preparationOperationId: aflTradeContentAddressedIdSchema(
      'valuation-cohort-preparation-operation'
    ),
    modelEvidence: aflTradeQualifiedCurrentValuationModelEvidenceResultSchema,
    dispatchAuthority: aflTradePrivatePreparedValuationDispatchAuthoritySchema,
  })
  .strict()
  .superRefine((content, context) => {
    if (content.scopeKey !== content.modelEvidence.scopeKey) {
      context.addIssue({
        code: 'custom',
        path: ['modelEvidence', 'scopeKey'],
        message: 'Private prepared model evidence must remain in the prepared valuation scope.',
      });
    }
    if (Date.parse(content.preparedAt) < Date.parse(content.modelEvidence.completedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['preparedAt'],
        message: 'Private prepared inputs cannot predate their qualified model evidence.',
      });
    }
    refinePreparedValuationInputSetV3(content, context, []);
  });

const aflTradePreparedValuationInputSetContentV3Schema = z.discriminatedUnion(
  'preparationAuthority',
  [publicPreparedValuationInputSetContentV3Schema, privatePreparedValuationInputSetContentV3Schema]
);

export const aflTradePreparedValuationInputSetContentSchema = z.union([
  aflTradePreparedValuationInputSetContentV1Schema,
  aflTradePreparedValuationInputSetContentV2Schema,
  aflTradePreparedValuationInputSetContentV3Schema,
]);

export const aflTradePreparedValuationInputSetSchema = z
  .object({
    preparedInputSetId: aflTradeContentAddressedIdSchema('prepared-valuation-input-set'),
    content: aflTradePreparedValuationInputSetContentSchema,
  })
  .strict()
  .superRefine((prepared, context) => {
    addAflTradeContentAddressIssue(
      'prepared-valuation-input-set',
      prepared.preparedInputSetId,
      prepared.content,
      context,
      ['preparedInputSetId']
    );
  });

export type AflTradeValuationInputBlocker = z.infer<typeof aflTradeValuationInputBlockerSchema>;
export type AflTradePreparedValuationInputEntry = z.infer<
  typeof aflTradePreparedValuationInputEntrySchema
>;
export type AflTradePreparedValuationInputSetContent = z.infer<
  typeof aflTradePreparedValuationInputSetContentSchema
>;
export type AflTradePreparedValuationInputSet = z.infer<
  typeof aflTradePreparedValuationInputSetSchema
>;

export function createAflTradePreparedValuationInputSet(
  input: z.input<typeof aflTradePreparedValuationInputSetContentSchema>
): AflTradePreparedValuationInputSet {
  const content = aflTradePreparedValuationInputSetContentSchema.parse(input);
  return aflTradePreparedValuationInputSetSchema.parse({
    preparedInputSetId: createAflTradeContentAddress('prepared-valuation-input-set', content),
    content,
  });
}
