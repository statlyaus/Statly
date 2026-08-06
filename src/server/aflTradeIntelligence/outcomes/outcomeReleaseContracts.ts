import { z } from 'zod';

import {
  AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
  aflDraftTradeOutcomeMetricDefinitionSchema,
  aflDraftTradeOutcomeSourceNativeIdSchema,
} from '@/types/aflDraftTradeOutcomes';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import { aflTradeGate0AReceiptSchema } from '../source/gate0aReceipt';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceRights';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const boundedScopeTextSchema = z.string().trim().min(1).max(500);

const exactUniqueSortedIdsSchema = <T extends z.ZodType<string>>(itemSchema: T, label: string) =>
  z
    .array(itemSchema)
    .min(1)
    .max(500)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: 'custom', message: `${label} must be unique.` });
      }
      if (values.some((value, index) => index > 0 && values[index - 1] > value)) {
        context.addIssue({ code: 'custom', message: `${label} must be sorted.` });
      }
    });

const metricDefinitionsSchema = z
  .array(aflDraftTradeOutcomeMetricDefinitionSchema)
  .min(1)
  .max(4)
  .superRefine((definitions, context) => {
    const metricCodes = definitions.map(({ metric }) => metric);
    const definitionIds = definitions.map(({ metricDefinitionId }) => metricDefinitionId);
    const registryVersions = definitions.map(({ metricRegistryVersion }) => metricRegistryVersion);
    if (new Set(metricCodes).size !== metricCodes.length) {
      context.addIssue({ code: 'custom', message: 'Metric codes must be unique.' });
    }
    if (new Set(definitionIds).size !== definitionIds.length) {
      context.addIssue({ code: 'custom', message: 'Metric definition IDs must be unique.' });
    }
    if (new Set(registryVersions).size !== 1) {
      context.addIssue({ code: 'custom', message: 'One release must use one metric registry.' });
    }
    if (metricCodes.some((metric, index) => index > 0 && metricCodes[index - 1] > metric)) {
      context.addIssue({ code: 'custom', message: 'Metric definitions must be sorted by code.' });
    }
  });

const sourceRightsBindingSchema = z
  .object({
    sourceSnapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
    sourceRightsArtifactId: aflTradeContentAddressedIdSchema('source-rights'),
    gateDecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    sourceRightsProposal: aflTradeSourceRightsProposalSchema,
    gate0aReceipt: aflTradeGate0AReceiptSchema,
    consumedSourceFields: z.array(z.string().trim().min(1).max(200)).min(1).max(1000),
  })
  .strict()
  .superRefine((binding, context) => {
    const { request, result } = binding.gate0aReceipt.content;
    const requiredOperations = [
      'raw_evidence_retention',
      'public_derived_output',
      'public_fact_display',
    ] as const;
    if (
      result.status !== 'mechanically_eligible' ||
      result.decisionId !== binding.gateDecisionId ||
      binding.sourceRightsProposal.rightsArtifactId !== binding.sourceRightsArtifactId ||
      request.rightsArtifactId !== binding.sourceRightsArtifactId ||
      result.rightsArtifactId !== binding.sourceRightsArtifactId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['gate0aReceipt'],
        message: 'The Gate 0A receipt must approve this exact source-rights binding.',
      });
    }
    const consumedFields = binding.consumedSourceFields;
    const evaluatedFields = [...new Set(request.fieldUses.map(({ sourceField }) => sourceField))];
    if (
      new Set(consumedFields).size !== consumedFields.length ||
      consumedFields.some((field, index) => index > 0 && consumedFields[index - 1] > field) ||
      consumedFields.length !== evaluatedFields.length ||
      consumedFields.some((field) => !evaluatedFields.includes(field))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['consumedSourceFields'],
        message: 'Consumed source fields must be unique, sorted, and exactly match the receipt.',
      });
    }
    if (requiredOperations.some((operation) => !request.operations.includes(operation))) {
      context.addIssue({
        code: 'custom',
        path: ['gate0aReceipt', 'content', 'request', 'operations'],
        message: 'Public releases require raw retention, derived output, and fact display rights.',
      });
    }
    if (
      request.fieldUses.length !== consumedFields.length ||
      request.fieldUses.some(({ use }) => use !== 'public_display')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['gate0aReceipt', 'content', 'request', 'fieldUses'],
        message: 'Every consumed field must have exactly one public-display use.',
      });
    }
  });

const sourceRightsBindingsSchema = z
  .array(sourceRightsBindingSchema)
  .min(1)
  .max(500)
  .superRefine((bindings, context) => {
    const snapshotIds = bindings.map(({ sourceSnapshotId }) => sourceSnapshotId);
    if (new Set(snapshotIds).size !== snapshotIds.length) {
      context.addIssue({ code: 'custom', message: 'Source snapshots must be bound exactly once.' });
    }
    if (
      snapshotIds.some(
        (sourceSnapshotId, index) => index > 0 && snapshotIds[index - 1] > sourceSnapshotId
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Source-rights bindings must be sorted.' });
    }
  });

export const AFL_DRAFT_TRADE_OUTCOME_RELEASE_SCHEMA_VERSION =
  'afl-draft-trade-outcome-release/v1' as const;
export const AFL_DRAFT_TRADE_OUTCOME_PROJECTION_SCHEMA_VERSION =
  'afl-draft-trade-outcome-projection/v1' as const;

export const aflDraftTradeOutcomeReleaseManifestContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_DRAFT_TRADE_OUTCOME_RELEASE_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: aflDraftTradeOutcomeSourceNativeIdSchema,
    createdAt: isoDateTimeSchema,
    effectiveThrough: isoDateTimeSchema,
    archiveDatasetId: aflTradeContentAddressedIdSchema('archive-dataset'),
    sourceSnapshotSetId: aflTradeContentAddressedIdSchema('source-snapshot-set'),
    outcomeEvaluationSetId: aflTradeContentAddressedIdSchema('outcome-evaluation'),
    acquisitionSpellRuleId: aflTradeContentAddressedIdSchema('acquisition-spell-rule'),
    metricRegistryVersion: aflDraftTradeOutcomeSourceNativeIdSchema,
    metricDefinitions: metricDefinitionsSchema,
    sourceRightsBindings: sourceRightsBindingsSchema,
    reconciliationReportArtifact: aflTradeArtifactRefSchema,
    exceptionReportArtifact: aflTradeArtifactRefSchema,
    supportedScope: z.array(boundedScopeTextSchema).max(100),
    excludedScope: z.array(boundedScopeTextSchema).max(100),
    outcomeRecordCount: z.number().int().nonnegative(),
    exceptionCount: z.number().int().nonnegative(),
    unresolvedIdentityCount: z.number().int().nonnegative(),
    unresolvedLineageCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((content, context) => {
    if (Date.parse(content.effectiveThrough) > Date.parse(content.createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'A release candidate cannot predate its evidence cutoff.',
      });
    }
    if (
      content.metricDefinitions.some(
        ({ metricRegistryVersion }) => metricRegistryVersion !== content.metricRegistryVersion
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metricDefinitions'],
        message: 'Every metric definition must belong to the declared registry.',
      });
    }
    if (
      Date.parse(content.reconciliationReportArtifact.createdAt) > Date.parse(content.createdAt) ||
      Date.parse(content.exceptionReportArtifact.createdAt) > Date.parse(content.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'A release candidate cannot predate its validation evidence.',
      });
    }
    if (
      content.sourceRightsBindings.some(
        ({ gate0aReceipt }) =>
          gate0aReceipt.content.request.environment !== content.environment ||
          Date.parse(gate0aReceipt.content.request.evaluatedAt) > Date.parse(content.createdAt) ||
          Date.parse(gate0aReceipt.content.recordedAt) > Date.parse(content.createdAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRightsBindings'],
        message: 'Every Gate 0A receipt must match the release environment and predate it.',
      });
    }
    if (new Set(content.supportedScope).size !== content.supportedScope.length) {
      context.addIssue({
        code: 'custom',
        path: ['supportedScope'],
        message: 'Scope must be unique.',
      });
    }
    if (new Set(content.excludedScope).size !== content.excludedScope.length) {
      context.addIssue({
        code: 'custom',
        path: ['excludedScope'],
        message: 'Scope must be unique.',
      });
    }
    const excludedScope = new Set(content.excludedScope);
    if (content.supportedScope.some((scope) => excludedScope.has(scope))) {
      context.addIssue({
        code: 'custom',
        path: ['excludedScope'],
        message: 'Supported and excluded scope must not overlap.',
      });
    }
  });

export const aflDraftTradeOutcomeReleaseManifestSchema = z
  .object({
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    content: aflDraftTradeOutcomeReleaseManifestContentSchema,
  })
  .strict()
  .superRefine((release, context) => {
    addAflTradeContentAddressIssue('outcome-release', release.releaseId, release.content, context, [
      'releaseId',
    ]);
  });

const projectionViewArtifactsSchema = z
  .object({
    list: aflTradeArtifactRefSchema,
    tradeDetail: aflTradeArtifactRefSchema,
    club: aflTradeArtifactRefSchema,
    player: aflTradeArtifactRefSchema,
    year: aflTradeArtifactRefSchema,
    dashboard: aflTradeArtifactRefSchema,
  })
  .strict();

const projectionExportArtifactsSchema = z
  .object({
    json: aflTradeArtifactRefSchema,
    csv: aflTradeArtifactRefSchema,
    xlsx: aflTradeArtifactRefSchema,
  })
  .strict();

export const aflDraftTradeOutcomeProjectionManifestContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_DRAFT_TRADE_OUTCOME_PROJECTION_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: aflDraftTradeOutcomeSourceNativeIdSchema,
    createdAt: isoDateTimeSchema,
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    archiveDatasetId: aflTradeContentAddressedIdSchema('archive-dataset'),
    metricRegistryVersion: aflDraftTradeOutcomeSourceNativeIdSchema,
    effectiveThrough: isoDateTimeSchema,
    metricDefinitionIds: exactUniqueSortedIdsSchema(
      aflTradeContentAddressedIdSchema('metric-definition'),
      'Metric definition IDs'
    ),
    viewArtifacts: projectionViewArtifactsSchema,
    exportArtifacts: projectionExportArtifactsSchema,
    parityReport: z
      .object({
        artifact: aflTradeArtifactRefSchema,
        status: z.literal('passed'),
        checkCount: z.number().int().positive(),
        failureCount: z.literal(0),
        checkedOutcomeRecordCount: z.number().int().nonnegative(),
        logicalDatasetSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    documentCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((content, context) => {
    const artifactDates = [
      ...Object.values(content.viewArtifacts),
      ...Object.values(content.exportArtifacts),
      content.parityReport.artifact,
    ].map(({ createdAt }) => Date.parse(createdAt));
    if (
      Date.parse(content.effectiveThrough) > Date.parse(content.createdAt) ||
      artifactDates.some((createdAt) => createdAt > Date.parse(content.createdAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'A projection cannot predate its release cutoff or generated artifacts.',
      });
    }
  });

export const aflDraftTradeOutcomeProjectionManifestSchema = z
  .object({
    projectionId: aflTradeContentAddressedIdSchema('outcome-projection'),
    content: aflDraftTradeOutcomeProjectionManifestContentSchema,
  })
  .strict()
  .superRefine((projection, context) => {
    addAflTradeContentAddressIssue(
      'outcome-projection',
      projection.projectionId,
      projection.content,
      context,
      ['projectionId']
    );
  });

export const aflDraftTradeOutcomeActivationAuthorizationContentSchema = z
  .object({
    schemaVersion: z.literal('afl-draft-trade-outcome-activation-authorization/v1'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: aflDraftTradeOutcomeSourceNativeIdSchema,
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    projectionId: aflTradeContentAddressedIdSchema('outcome-projection'),
    expectedRegistryRevision: z.number().int().nonnegative(),
    authorizedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    rollbackWindowEndsAt: isoDateTimeSchema,
    writeBarrier: z.literal('engaged'),
    parityReportArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    authorityKind: z.enum(['fixture', 'external_human_record']),
    authorizedBy: aflDraftTradeOutcomeSourceNativeIdSchema,
    authorityEvidenceIds: exactUniqueSortedIdsSchema(
      z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/),
      'Operational authority evidence IDs'
    ),
  })
  .strict()
  .superRefine((authorization, context) => {
    if (Date.parse(authorization.expiresAt) <= Date.parse(authorization.authorizedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Operational authorization must expire after it is issued.',
      });
    }
    if (Date.parse(authorization.rollbackWindowEndsAt) <= Date.parse(authorization.authorizedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['rollbackWindowEndsAt'],
        message: 'The rollback window must end after authorization.',
      });
    }
    if (authorization.authorityKind === 'fixture' && authorization.environment !== 'test_fixture') {
      context.addIssue({
        code: 'custom',
        path: ['authorityKind'],
        message: 'Fixture authority is restricted to the test-fixture environment.',
      });
    }
  });

export const aflDraftTradeOutcomeActivationAuthorizationSchema = z
  .object({
    authorizationId: aflTradeContentAddressedIdSchema('outcome-activation-authorization'),
    content: aflDraftTradeOutcomeActivationAuthorizationContentSchema,
  })
  .strict()
  .superRefine((authorization, context) => {
    addAflTradeContentAddressIssue(
      'outcome-activation-authorization',
      authorization.authorizationId,
      authorization.content,
      context,
      ['authorizationId']
    );
  });

export type AflDraftTradeOutcomeReleaseManifest = z.infer<
  typeof aflDraftTradeOutcomeReleaseManifestSchema
>;
export type AflDraftTradeOutcomeProjectionManifest = z.infer<
  typeof aflDraftTradeOutcomeProjectionManifestSchema
>;
export type AflDraftTradeOutcomeActivationAuthorization = z.infer<
  typeof aflDraftTradeOutcomeActivationAuthorizationSchema
>;

export function createAflDraftTradeOutcomeReleaseManifest(
  content: z.input<typeof aflDraftTradeOutcomeReleaseManifestContentSchema>
): AflDraftTradeOutcomeReleaseManifest {
  const parsedContent = aflDraftTradeOutcomeReleaseManifestContentSchema.parse(content);
  return aflDraftTradeOutcomeReleaseManifestSchema.parse({
    releaseId: createAflTradeContentAddress('outcome-release', parsedContent),
    content: parsedContent,
  });
}

export function createAflDraftTradeOutcomeProjectionManifest(
  content: z.input<typeof aflDraftTradeOutcomeProjectionManifestContentSchema>
): AflDraftTradeOutcomeProjectionManifest {
  const parsedContent = aflDraftTradeOutcomeProjectionManifestContentSchema.parse(content);
  return aflDraftTradeOutcomeProjectionManifestSchema.parse({
    projectionId: createAflTradeContentAddress('outcome-projection', parsedContent),
    content: parsedContent,
  });
}

export function createAflDraftTradeOutcomeActivationAuthorization(
  content: z.input<typeof aflDraftTradeOutcomeActivationAuthorizationContentSchema>
): AflDraftTradeOutcomeActivationAuthorization {
  const parsedContent = aflDraftTradeOutcomeActivationAuthorizationContentSchema.parse(content);
  return aflDraftTradeOutcomeActivationAuthorizationSchema.parse({
    authorizationId: createAflTradeContentAddress(
      'outcome-activation-authorization',
      parsedContent
    ),
    content: parsedContent,
  });
}

export function validateAflDraftTradeOutcomeReleaseProjectionPair(
  release: AflDraftTradeOutcomeReleaseManifest,
  projection: AflDraftTradeOutcomeProjectionManifest
): boolean {
  const parsedRelease = aflDraftTradeOutcomeReleaseManifestSchema.safeParse(release);
  const parsedProjection = aflDraftTradeOutcomeProjectionManifestSchema.safeParse(projection);
  if (!parsedRelease.success || !parsedProjection.success) return false;

  const releaseContent = parsedRelease.data.content;
  const projectionContent = parsedProjection.data.content;
  const metricDefinitionIds = releaseContent.metricDefinitions
    .map(({ metricDefinitionId }) => metricDefinitionId)
    .sort();
  return (
    projectionContent.releaseId === parsedRelease.data.releaseId &&
    projectionContent.scopeKey === releaseContent.scopeKey &&
    projectionContent.environment === releaseContent.environment &&
    projectionContent.archiveDatasetId === releaseContent.archiveDatasetId &&
    projectionContent.metricRegistryVersion === releaseContent.metricRegistryVersion &&
    projectionContent.effectiveThrough === releaseContent.effectiveThrough &&
    projectionContent.parityReport.checkedOutcomeRecordCount ===
      releaseContent.outcomeRecordCount &&
    Date.parse(projectionContent.createdAt) >= Date.parse(releaseContent.createdAt) &&
    metricDefinitionIds.length === projectionContent.metricDefinitionIds.length &&
    metricDefinitionIds.every(
      (metricDefinitionId, index) =>
        metricDefinitionId === projectionContent.metricDefinitionIds[index]
    )
  );
}
