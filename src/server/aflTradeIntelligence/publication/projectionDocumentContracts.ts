import { z } from 'zod';

import {
  AFL_TRADE_METHODOLOGY_COMPONENT_ROLES,
  AFL_TRADE_VALUATION_VIEWS,
  aflTradeAssetBreakdownSchema,
  aflTradeClubValueSummarySchema,
  aflTradeIsoDateTimeSchema,
  aflTradeLineageSummarySchema,
  aflTradeOutcomeDistributionSummarySchema,
  aflTradePublicIdSchema,
  aflTradePublishedMethodologySchema,
  aflTradeValueDetailResponseSchema,
  aflTradeValueFactorSchema,
  aflTradeValueResultSchema,
  aflTradeValueSummarySchema,
  aflTradeValuationViewSchema,
} from '@/types/aflTradeIntelligence';

import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeProjectionMaterializationBindingSchema } from '../artifacts/publicationProjectionManifests';

export {
  aflTradeProjectionMaterializationBindingSchema,
  type AflTradeProjectionMaterializationBinding,
} from '../artifacts/publicationProjectionManifests';

export const AFL_TRADE_PROJECTION_DOCUMENT_SCHEMA_VERSION =
  'afl-trade-projection-document/v1' as const;
export const AFL_TRADE_PROJECTION_EXPORT_ROW_SCHEMA_VERSION =
  'afl-trade-valuation-export-row/v1' as const;
export const AFL_TRADE_PROJECTION_DOCUMENT_KINDS = Object.freeze([
  'trade_summary',
  'trade_detail',
  'methodology',
  'valuation_export_row',
] as const);
export const AFL_TRADE_PROJECTION_DOCUMENT_MAX_BYTES = 1_048_576;
export const AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY =
  'source_native_afl_assets_no_user_or_fantasy_ownership' as const;
export const AFL_TRADE_PROJECTION_MATERIALIZATION_BINDING_SCHEMA_VERSION =
  'afl-trade-projection-materialization/v1' as const;

const projectionDocumentKindSchema = z.enum(AFL_TRADE_PROJECTION_DOCUMENT_KINDS);
const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Projection documents require canonical JSON artifact references.'
);

const projectionDocumentCommonShape = {
  schemaVersion: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SCHEMA_VERSION),
  kind: projectionDocumentKindSchema,
  publicAssetBoundary: z.literal(AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY),
  publicationId: aflTradeContentAddressedIdSchema('publication'),
  valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
  valuationOutputInventoryIndexId: aflTradeContentAddressedIdSchema(
    'valuation-output-inventory-index'
  ),
  scopeKey: aflTradePublicIdSchema,
  valueUnitId: aflTradePublicIdSchema,
  calculationAsOf: aflTradeIsoDateTimeSchema,
  knowledgeCutoffAt: aflTradeIsoDateTimeSchema,
} as const;

interface ProjectionDocumentCommonForValidation {
  calculationAsOf: string;
  knowledgeCutoffAt: string;
}

function addProjectionDocumentCommonIssues(
  document: ProjectionDocumentCommonForValidation,
  context: z.RefinementCtx
): void {
  if (Date.parse(document.knowledgeCutoffAt) > Date.parse(document.calculationAsOf)) {
    context.addIssue({
      code: 'custom',
      path: ['knowledgeCutoffAt'],
      message: 'Projection knowledge cutoff cannot follow its calculation time.',
    });
  }
}

export const aflTradeProjectionDocumentCommonSchema = z
  .object(projectionDocumentCommonShape)
  .strict()
  .superRefine(addProjectionDocumentCommonIssues);

function isCanonicalStringOrder(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

function viewsUseCompleteCanonicalOrder(views: readonly string[]): boolean {
  return (
    views.length === AFL_TRADE_VALUATION_VIEWS.length &&
    views.every((view, index) => view === AFL_TRADE_VALUATION_VIEWS[index])
  );
}

function viewsUseCanonicalOrder(views: readonly string[]): boolean {
  let previousIndex = -1;
  for (const view of views) {
    const viewIndex = AFL_TRADE_VALUATION_VIEWS.indexOf(
      view as (typeof AFL_TRADE_VALUATION_VIEWS)[number]
    );
    if (viewIndex <= previousIndex) return false;
    previousIndex = viewIndex;
  }
  return true;
}

type ProjectionFactor = z.infer<typeof aflTradeValueFactorSchema>;

const FACTOR_KIND_RANK: Readonly<Record<ProjectionFactor['kind'], number>> = Object.freeze({
  positive: 0,
  negative: 1,
  uncertainty: 2,
});

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareProjectionFactors(left: ProjectionFactor, right: ProjectionFactor): number {
  const kindDifference = FACTOR_KIND_RANK[left.kind] - FACTOR_KIND_RANK[right.kind];
  if (kindDifference !== 0) return kindDifference;
  for (const field of ['code', 'label', 'explanation'] as const) {
    const difference = compareCodeUnits(left[field], right[field]);
    if (difference !== 0) return difference;
  }
  return 0;
}

export const aflTradeProjectionViewGlobalFactorsSchema = z
  .object({
    view: aflTradeValuationViewSchema,
    factors: z.array(aflTradeValueFactorSchema).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.factors.map((factor) => `${factor.kind}\u0000${factor.code}`);
    if (
      new Set(keys).size !== keys.length ||
      value.factors.some(
        (factor, index) =>
          index > 0 && compareProjectionFactors(value.factors[index - 1], factor) >= 0
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['factors'],
        message:
          'View-global factors must be unique by kind and code and use canonical policy order.',
      });
    }
  });

const detailViewGlobalFactorsSchema = z
  .array(aflTradeProjectionViewGlobalFactorsSchema)
  .length(AFL_TRADE_VALUATION_VIEWS.length)
  .superRefine((values, context) => {
    if (!viewsUseCompleteCanonicalOrder(values.map(({ view }) => view))) {
      context.addIssue({
        code: 'custom',
        message: 'Detail view-global factors must cover every view in canonical order.',
      });
    }
  });

export const aflTradeProjectionExportSelectedClubOutcomeSchema = z
  .object({
    aflClubId: aflTradePublicIdSchema,
    distribution: aflTradeOutcomeDistributionSummarySchema,
  })
  .strict();

function isProjectionFactAvailability(availability: string): boolean {
  return !['calculating', 'stale', 'failed_previous_available', 'withdrawn'].includes(availability);
}

function addProjectionValuationIssues(
  valuation: z.infer<typeof aflTradeValueSummarySchema> | z.infer<typeof aflTradeValueResultSchema>,
  valueUnitId: string,
  context: z.RefinementCtx,
  path: (string | number)[]
): void {
  if (!isProjectionFactAvailability(valuation.availability)) {
    context.addIssue({
      code: 'custom',
      path: [...path, 'availability'],
      message: 'Projection documents cannot persist request-time or derived freshness states.',
    });
  }
  if ('unit' in valuation && valuation.unit.id !== valueUnitId) {
    context.addIssue({
      code: 'custom',
      path: [...path, 'unit', 'id'],
      message: 'Projection valuation unit must match the document identity.',
    });
  }
  if (
    'clubValues' in valuation &&
    !isCanonicalStringOrder(valuation.clubValues.map((club) => club.aflClubId))
  ) {
    context.addIssue({
      code: 'custom',
      path: [...path, 'clubValues'],
      message: 'Projection AFL club values must use ascending AFL club identifier order.',
    });
  }
  if ('comparison' in valuation) {
    const comparisonClubIds = valuation.comparison.aflClubIds;
    const probabilityClubIds = valuation.comparison.probabilities.map(
      (probability) => probability.aflClubId
    );
    if (
      !isCanonicalStringOrder(comparisonClubIds) ||
      probabilityClubIds.some((aflClubId, index) => aflClubId !== comparisonClubIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: [...path, 'comparison'],
        message: 'Projection comparison clubs and probabilities must share canonical club order.',
      });
    }
    if (
      'excludedAssetIds' in valuation.comparison &&
      !isCanonicalStringOrder(valuation.comparison.excludedAssetIds)
    ) {
      context.addIssue({
        code: 'custom',
        path: [...path, 'comparison', 'excludedAssetIds'],
        message: 'Projection comparison exclusions must use ascending asset identifier order.',
      });
    }
    if (!isCanonicalStringOrder(valuation.coverage.excludedAssets.map((asset) => asset.assetId))) {
      context.addIssue({
        code: 'custom',
        path: [...path, 'coverage', 'excludedAssets'],
        message: 'Projection coverage exclusions must use ascending asset identifier order.',
      });
    }
  }
}

export const aflTradeProjectionSummaryDocumentContentSchema = z
  .object({
    ...projectionDocumentCommonShape,
    kind: z.literal('trade_summary'),
    tradeId: aflTradePublicIdSchema,
    view: aflTradeValuationViewSchema,
    valuation: aflTradeValueSummarySchema,
    viewGlobalFactors: aflTradeProjectionViewGlobalFactorsSchema,
  })
  .strict()
  .superRefine((document, context) => {
    addProjectionDocumentCommonIssues(document, context);
    if (document.valuation.view !== document.view) {
      context.addIssue({
        code: 'custom',
        path: ['valuation', 'view'],
        message: 'Summary valuation view must match the document view.',
      });
    }
    if (document.viewGlobalFactors.view !== document.view) {
      context.addIssue({
        code: 'custom',
        path: ['viewGlobalFactors', 'view'],
        message: 'Summary view-global factors must match the document view.',
      });
    }
    addProjectionValuationIssues(document.valuation, document.valueUnitId, context, ['valuation']);
  });

const detailValuationsSchema = z
  .array(aflTradeValueResultSchema)
  .length(AFL_TRADE_VALUATION_VIEWS.length);

function addDetailResponseIssues(
  document: z.infer<typeof aflTradeProjectionDetailDocumentContentSchema>,
  context: z.RefinementCtx
): void {
  const validation = aflTradeValueDetailResponseSchema.safeParse({
    consistency: {
      contractVersion: 'afl-trade-value/v2',
      selection: 'active',
      publication: {
        publicationId: document.publicationId,
        state: 'published',
        valuationBundleId: document.valuationBundleId,
        valueUnitId: document.valueUnitId,
        publishedAt: document.calculationAsOf,
      },
      registryRevision: 0,
      projectionBuildId: `projection:${'0'.repeat(64)}`,
      servedAt: document.calculationAsOf,
      calculationAsOf: document.calculationAsOf,
      knowledgeCutoffAt: document.knowledgeCutoffAt,
      freshness: 'current',
      supportedScope: [],
      excludedScope: [],
      warnings: [],
    },
    tradeId: document.tradeId,
    valuations: document.valuations,
    assets: document.assets,
    lineageSummary: document.lineageSummary,
  });
  if (validation.success) return;
  for (const issue of validation.error.issues) {
    if (issue.path[0] === 'consistency') continue;
    context.addIssue({
      code: 'custom',
      path: issue.path,
      message: issue.message,
    });
  }
}

export const aflTradeProjectionDetailDocumentContentSchema = z
  .object({
    ...projectionDocumentCommonShape,
    kind: z.literal('trade_detail'),
    tradeId: aflTradePublicIdSchema,
    valuations: detailValuationsSchema,
    viewGlobalFactors: detailViewGlobalFactorsSchema,
    assets: z.array(aflTradeAssetBreakdownSchema).max(100),
    lineageSummary: aflTradeLineageSummarySchema,
  })
  .strict()
  .superRefine((document, context) => {
    addProjectionDocumentCommonIssues(document, context);
    if (!viewsUseCompleteCanonicalOrder(document.valuations.map((valuation) => valuation.view))) {
      context.addIssue({
        code: 'custom',
        path: ['valuations'],
        message: 'Complete detail must contain every valuation view in canonical order.',
      });
    }
    if (!isCanonicalStringOrder(document.assets.map((asset) => asset.assetId))) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Detail assets must use ascending asset identifier order.',
      });
    }
    for (const [valuationIndex, valuation] of document.valuations.entries()) {
      addProjectionValuationIssues(valuation, document.valueUnitId, context, [
        'valuations',
        valuationIndex,
      ]);
      if (
        'clubValues' in valuation &&
        valuation.clubValues.some(({ factors }) => factors.length !== 0)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['valuations', valuationIndex, 'clubValues'],
          message: 'View-global factors must not be repeated into AFL-club factor arrays.',
        });
      }
    }
    for (const [assetIndex, asset] of document.assets.entries()) {
      if (!viewsUseCanonicalOrder(asset.values.map((value) => value.view))) {
        context.addIssue({
          code: 'custom',
          path: ['assets', assetIndex, 'values'],
          message: 'Asset values must use canonical valuation-view order.',
        });
      }
      if (!isCanonicalStringOrder(asset.lineage.creditedAssetIds)) {
        context.addIssue({
          code: 'custom',
          path: ['assets', assetIndex, 'lineage', 'creditedAssetIds'],
          message: 'Credited lineage assets must use ascending asset identifier order.',
        });
      }
      for (const [valueIndex, value] of asset.values.entries()) {
        if (value.status === 'valued' && value.factors.length !== 0) {
          context.addIssue({
            code: 'custom',
            path: ['assets', assetIndex, 'values', valueIndex, 'factors'],
            message: 'View-global factors must not be repeated into asset factor arrays.',
          });
        }
      }
    }
    addDetailResponseIssues(document, context);
  });

export const aflTradeProjectionMethodologyDocumentContentSchema = z
  .object({
    ...projectionDocumentCommonShape,
    kind: z.literal('methodology'),
    methodology: aflTradePublishedMethodologySchema,
    projectionMaterialization: aflTradeProjectionMaterializationBindingSchema,
  })
  .strict()
  .superRefine((document, context) => {
    addProjectionDocumentCommonIssues(document, context);
    if (document.methodology.valuationBundleId !== document.valuationBundleId) {
      context.addIssue({
        code: 'custom',
        path: ['methodology', 'valuationBundleId'],
        message: 'Methodology must describe the document valuation bundle.',
      });
    }
    if (document.methodology.valueUnit.id !== document.valueUnitId) {
      context.addIssue({
        code: 'custom',
        path: ['methodology', 'valueUnit', 'id'],
        message: 'Methodology must describe the document value unit.',
      });
    }
    if (document.methodology.calculationAsOf !== document.calculationAsOf) {
      context.addIssue({
        code: 'custom',
        path: ['methodology', 'calculationAsOf'],
        message: 'Methodology calculation time must match the projection document.',
      });
    }
    const materialization = document.projectionMaterialization;
    if (
      materialization.publicationId !== document.publicationId ||
      materialization.valuationOutputInventoryIndexId !==
        document.valuationOutputInventoryIndexId ||
      materialization.scopeKey !== document.scopeKey ||
      materialization.valueUnitId !== document.valueUnitId ||
      materialization.calculationAsOf !== document.calculationAsOf ||
      materialization.knowledgeCutoffAt !== document.knowledgeCutoffAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionMaterialization'],
        message:
          'Methodology materialization identity, scope, unit, and times must exactly match the document.',
      });
    }
    if (!viewsUseCompleteCanonicalOrder(document.methodology.supportedViews)) {
      context.addIssue({
        code: 'custom',
        path: ['methodology', 'supportedViews'],
        message: 'Methodology must cover every valuation view in canonical order.',
      });
    }
    if (
      document.methodology.components.some(
        (component, index) => component.role !== AFL_TRADE_METHODOLOGY_COMPONENT_ROLES[index]
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['methodology', 'components'],
        message: 'Methodology components must use canonical governed-role order.',
      });
    }
    for (const field of [
      'supportedDataCoverage',
      'knownLimitations',
      'materialChangesFromPrevious',
    ] as const) {
      if (!isCanonicalStringOrder(document.methodology[field])) {
        context.addIssue({
          code: 'custom',
          path: ['methodology', field],
          message: `Methodology ${field} must use ascending canonical order.`,
        });
      }
    }
  });

const projectionExportRowPayloadSchema = z
  .object({
    rowSchemaVersion: z.literal(AFL_TRADE_PROJECTION_EXPORT_ROW_SCHEMA_VERSION),
    rowOrdinal: z.number().int().nonnegative().max(17),
    tradeId: aflTradePublicIdSchema,
    view: aflTradeValuationViewSchema,
    valuation: aflTradeValueSummarySchema,
    clubValue: aflTradeClubValueSummarySchema.nullable(),
    selectedClubOutcome: aflTradeProjectionExportSelectedClubOutcomeSchema.nullable(),
  })
  .strict();

export const aflTradeProjectionExportRowDocumentContentSchema = z
  .object({
    ...projectionDocumentCommonShape,
    kind: z.literal('valuation_export_row'),
    viewGlobalFactors: aflTradeProjectionViewGlobalFactorsSchema.nullable(),
    exportRow: projectionExportRowPayloadSchema,
  })
  .strict()
  .superRefine((document, context) => {
    addProjectionDocumentCommonIssues(document, context);
    const row = document.exportRow;
    if (row.valuation.view !== row.view) {
      context.addIssue({
        code: 'custom',
        path: ['exportRow', 'valuation', 'view'],
        message: 'Export-row valuation view must match the row view.',
      });
    }
    if (
      (row.rowOrdinal === 0 &&
        (document.viewGlobalFactors === null || document.viewGlobalFactors.view !== row.view)) ||
      (row.rowOrdinal > 0 && document.viewGlobalFactors !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['viewGlobalFactors'],
        message:
          'Export view-global factors must appear once at row ordinal zero for the selected view.',
      });
    }
    addProjectionValuationIssues(row.valuation, document.valueUnitId, context, [
      'exportRow',
      'valuation',
    ]);
    if ('clubValues' in row.valuation) {
      const expectedClubValue = row.valuation.clubValues[row.rowOrdinal];
      if (
        expectedClubValue === undefined ||
        row.clubValue === null ||
        canonicalizeAflTradeJson(row.clubValue) !== canonicalizeAflTradeJson(expectedClubValue)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['exportRow', 'clubValue'],
          message: 'Export row must bind exactly one canonical club value at its ordinal.',
        });
      }
      if (
        expectedClubValue !== undefined &&
        row.clubValue !== null &&
        (row.selectedClubOutcome === null ||
          row.selectedClubOutcome.aflClubId !== row.clubValue.aflClubId ||
          row.selectedClubOutcome.distribution.downside.value !== row.clubValue.interval.lower ||
          row.selectedClubOutcome.distribution.upside.value !== row.clubValue.interval.upper ||
          row.selectedClubOutcome.distribution.downside.value > row.clubValue.medianValue ||
          row.clubValue.medianValue > row.selectedClubOutcome.distribution.upside.value)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['exportRow', 'selectedClubOutcome'],
          message:
            'Export outcome evidence must select the exact club and P10/P90 interval at the row ordinal.',
        });
      }
    } else if (row.rowOrdinal !== 0 || row.clubValue !== null || row.selectedClubOutcome !== null) {
      context.addIssue({
        code: 'custom',
        path: ['exportRow'],
        message:
          'Unavailable valuation exports require one null-club, null-outcome row at ordinal zero.',
      });
    }
  });

export const aflTradeProjectionDocumentContentSchema = z.discriminatedUnion('kind', [
  aflTradeProjectionSummaryDocumentContentSchema,
  aflTradeProjectionDetailDocumentContentSchema,
  aflTradeProjectionMethodologyDocumentContentSchema,
  aflTradeProjectionExportRowDocumentContentSchema,
]);

function addProjectionDocumentContentAddressIssue(
  document: { projectionDocumentId: string; content: unknown },
  context: z.RefinementCtx
): void {
  addAflTradeContentAddressIssue(
    'projection-document',
    document.projectionDocumentId,
    document.content,
    context,
    ['projectionDocumentId']
  );
}

export const aflTradeProjectionDocumentSchema = z
  .object({
    projectionDocumentId: aflTradeContentAddressedIdSchema('projection-document'),
    content: aflTradeProjectionDocumentContentSchema,
  })
  .strict()
  .superRefine(addProjectionDocumentContentAddressIssue);

export type AflTradeProjectionDocumentCommon = z.infer<
  typeof aflTradeProjectionDocumentCommonSchema
>;
export type AflTradeProjectionViewGlobalFactors = z.infer<
  typeof aflTradeProjectionViewGlobalFactorsSchema
>;
export type AflTradeProjectionExportSelectedClubOutcome = z.infer<
  typeof aflTradeProjectionExportSelectedClubOutcomeSchema
>;
export type AflTradeProjectionSummaryDocumentContent = z.infer<
  typeof aflTradeProjectionSummaryDocumentContentSchema
>;
export type AflTradeProjectionDetailDocumentContent = z.infer<
  typeof aflTradeProjectionDetailDocumentContentSchema
>;
export type AflTradeProjectionMethodologyDocumentContent = z.infer<
  typeof aflTradeProjectionMethodologyDocumentContentSchema
>;
export type AflTradeProjectionExportRowDocumentContent = z.infer<
  typeof aflTradeProjectionExportRowDocumentContentSchema
>;
export type AflTradeProjectionDocumentContent = z.infer<
  typeof aflTradeProjectionDocumentContentSchema
>;
export type AflTradeProjectionDocument = z.infer<typeof aflTradeProjectionDocumentSchema>;

export interface AflTradeProjectionDocumentArtifact {
  projectionDocument: AflTradeProjectionDocument;
  projectionDocumentArtifactRef: z.infer<typeof canonicalJsonArtifactRefSchema>;
}

const CREATE_INPUT_KEYS = ['content', 'materializedAt'] as const;
const VERIFY_INPUT_KEYS = ['projectionDocument', 'projectionDocumentArtifactRef'] as const;

function snapshotExactInput<const Key extends string>(
  value: unknown,
  keys: readonly Key[]
): Record<Key, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    const expected = new Set<string>(keys);
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !expected.has(key))
    ) {
      return null;
    }
    const snapshot = {} as Record<Key, unknown>;
    for (const key of keys) snapshot[key] = Reflect.get(value, key, value);
    return snapshot;
  } catch {
    return null;
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

export function createAflTradeProjectionDocumentArtifact(input: {
  content: unknown;
  materializedAt: unknown;
}): AflTradeProjectionDocumentArtifact {
  try {
    const snapshot = snapshotExactInput(input, CREATE_INPUT_KEYS);
    if (snapshot === null) throw new TypeError();
    const content = aflTradeProjectionDocumentContentSchema.parse(snapshot.content);
    const materializedAt = aflTradeIsoDateTimeSchema.parse(snapshot.materializedAt);
    if (Date.parse(materializedAt) < Date.parse(content.calculationAsOf)) throw new TypeError();
    if (
      content.kind === 'methodology' &&
      Date.parse(content.projectionMaterialization.artifactRef.createdAt) >
        Date.parse(materializedAt)
    ) {
      throw new TypeError();
    }

    const projectionDocument = aflTradeProjectionDocumentSchema.parse({
      projectionDocumentId: createAflTradeContentAddress('projection-document', content),
      content,
    });
    const projectionDocumentArtifactRef = canonicalJsonArtifactRefSchema.parse(
      createAflTradeCanonicalJsonArtifactRef(projectionDocument, materializedAt)
    );
    if (
      projectionDocumentArtifactRef.byteLength === 0 ||
      projectionDocumentArtifactRef.byteLength > AFL_TRADE_PROJECTION_DOCUMENT_MAX_BYTES
    ) {
      throw new TypeError();
    }
    return deepFreeze({ projectionDocument, projectionDocumentArtifactRef });
  } catch {
    throw new TypeError('Invalid AFL trade projection document artifact input.');
  }
}

export function verifyAflTradeProjectionDocumentArtifact(input: unknown): boolean {
  try {
    const snapshot = snapshotExactInput(input, VERIFY_INPUT_KEYS);
    if (snapshot === null) return false;
    const projectionDocument = aflTradeProjectionDocumentSchema.safeParse(
      snapshot.projectionDocument
    );
    const artifactRef = canonicalJsonArtifactRefSchema.safeParse(
      snapshot.projectionDocumentArtifactRef
    );
    if (!projectionDocument.success || !artifactRef.success) return false;
    if (
      artifactRef.data.byteLength === 0 ||
      artifactRef.data.byteLength > AFL_TRADE_PROJECTION_DOCUMENT_MAX_BYTES ||
      Date.parse(artifactRef.data.createdAt) <
        Date.parse(projectionDocument.data.content.calculationAsOf) ||
      (projectionDocument.data.content.kind === 'methodology' &&
        Date.parse(
          projectionDocument.data.content.projectionMaterialization.artifactRef.createdAt
        ) > Date.parse(artifactRef.data.createdAt))
    ) {
      return false;
    }
    return doesAflTradeArtifactRefMatchCanonicalJson(artifactRef.data, projectionDocument.data);
  } catch {
    return false;
  }
}
