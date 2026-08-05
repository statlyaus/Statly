import { z } from 'zod';

import {
  AFL_TRADE_CONFIDENCE_DIMENSIONS,
  AFL_TRADE_CONFIDENCE_LEVELS,
  AFL_TRADE_PUBLIC_ASSET_KINDS,
  AFL_TRADE_VALUATION_VIEWS,
  aflTradeIsoDateTimeSchema,
  aflTradePublicIdSchema,
  aflTradePublicMessageSchema,
  aflTradeTemporalContextSchema,
  aflTradeValueFactorSchema,
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
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION =
  'afl-trade-projection-public-evidence/v1' as const;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY =
  'source_native_afl_assets_no_user_or_fantasy_ownership' as const;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_MAX_ARTIFACT_BYTES = 1024 * 1024;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PREDECESSOR_COMPATIBILITY =
  'no_predecessor_no_latest_alias_no_implicit_conversion_v1' as const;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_RUNTIME_FALLBACK = 'prohibited' as const;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_LIMITATION =
  'Immutable public semantic evidence and source-claim binding contract only; artifact references authenticate bytes, while claimed field digests and source times remain semantic assertions. This contract does not prove upstream derivation, source rights, claim truth, model validity, publication approval, serving authority, fantasy authorization, or user ownership.' as const;

export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SOURCE_ROLES = [
  'confidence',
  'coverage',
  'asset_identity',
  'lineage_frontier',
  'factor',
] as const;

const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Projection public evidence requires canonical JSON evidence references.'
);
const confidenceLevelSchema = z.enum(AFL_TRADE_CONFIDENCE_LEVELS);
const confidenceDimensionSchema = z.enum(AFL_TRADE_CONFIDENCE_DIMENSIONS);
const semanticArtifactIdSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);
const sourceSchemaVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z][a-z0-9-]*\/v[1-9][0-9]*$/);
const recordLocatorSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[^\s\\]+$/);
const jsonPointerFieldPathSchema = z
  .string()
  .max(500)
  .regex(/^(?:\/(?:[^~/]|~[01])*)+$/);

const sourceBindingShape = {
  sourceSchemaVersion: sourceSchemaVersionSchema,
  semanticArtifactId: semanticArtifactIdSchema,
  artifactRef: canonicalJsonArtifactRefSchema,
  recordLocator: recordLocatorSchema,
  fieldPath: jsonPointerFieldPathSchema,
  claimedValueSha256: aflTradeSha256Schema,
  sourceEffectiveAt: aflTradeIsoDateTimeSchema,
  sourceKnownAt: aflTradeIsoDateTimeSchema,
} as const;

function sourceBindingSchemaFor<
  const Role extends (typeof AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SOURCE_ROLES)[number],
>(role: Role) {
  return z.object({ sourceRole: z.literal(role), ...sourceBindingShape }).strict();
}

export const aflTradeProjectionPublicEvidenceConfidenceSourceBindingSchema =
  sourceBindingSchemaFor('confidence');
export const aflTradeProjectionPublicEvidenceCoverageSourceBindingSchema =
  sourceBindingSchemaFor('coverage');
export const aflTradeProjectionPublicEvidenceAssetIdentitySourceBindingSchema =
  sourceBindingSchemaFor('asset_identity');
export const aflTradeProjectionPublicEvidenceLineageFrontierSourceBindingSchema =
  sourceBindingSchemaFor('lineage_frontier');
export const aflTradeProjectionPublicEvidenceFactorSourceBindingSchema =
  sourceBindingSchemaFor('factor');

type SourceBinding = z.infer<
  | typeof aflTradeProjectionPublicEvidenceConfidenceSourceBindingSchema
  | typeof aflTradeProjectionPublicEvidenceCoverageSourceBindingSchema
  | typeof aflTradeProjectionPublicEvidenceAssetIdentitySourceBindingSchema
  | typeof aflTradeProjectionPublicEvidenceLineageFrontierSourceBindingSchema
  | typeof aflTradeProjectionPublicEvidenceFactorSourceBindingSchema
>;

function canonicalSourceBindings<T extends z.ZodTypeAny>(bindingSchema: T) {
  return z
    .array(bindingSchema)
    .min(1)
    .max(8)
    .superRefine((bindings, context) => {
      if (!sourceBindingsUseCanonicalOrder(bindings as SourceBinding[])) {
        context.addIssue({
          code: 'custom',
          message: 'Source bindings must be unique and use canonical order.',
        });
      }
    });
}

const commonShape = {
  schemaVersion: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION),
  publicAssetBoundary: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY),
  publicationId: aflTradeContentAddressedIdSchema('publication'),
  valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
  valuationOutputInventoryIndexId: aflTradeContentAddressedIdSchema(
    'valuation-output-inventory-index'
  ),
  valuationOutputInventoryId: aflTradeContentAddressedIdSchema('valuation-output-inventory'),
  valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
  valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
  tradeId: aflTradePublicIdSchema,
  scopeKey: aflTradePublicIdSchema,
  valueUnitId: aflTradePublicIdSchema,
  materializedAt: aflTradeIsoDateTimeSchema,
} as const;

export const aflTradeProjectionPublicEvidenceViewContextSchema = z
  .object({
    view: aflTradeValuationViewSchema,
    temporalContext: aflTradeTemporalContextSchema,
  })
  .strict();

export const aflTradeProjectionPublicEvidenceConfidenceDimensionSchema = z
  .object({
    dimension: confidenceDimensionSchema,
    level: confidenceLevelSchema,
    reasonCode: aflTradePublicIdSchema,
    explanation: z.string().trim().min(1).max(400),
    sourceBindings: canonicalSourceBindings(
      aflTradeProjectionPublicEvidenceConfidenceSourceBindingSchema
    ),
  })
  .strict();

export const aflTradeProjectionPublicEvidenceConfidenceViewSchema = z
  .object({
    view: aflTradeValuationViewSchema,
    temporalContext: aflTradeTemporalContextSchema,
    overallLevel: confidenceLevelSchema,
    dimensions: z
      .array(aflTradeProjectionPublicEvidenceConfidenceDimensionSchema)
      .length(AFL_TRADE_CONFIDENCE_DIMENSIONS.length),
  })
  .strict()
  .superRefine((confidence, context) => {
    if (
      confidence.dimensions.some(
        (dimension, index) => dimension.dimension !== AFL_TRADE_CONFIDENCE_DIMENSIONS[index]
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['dimensions'],
        message: 'Confidence dimensions must use the complete canonical order.',
      });
    }
    const rank: Record<(typeof AFL_TRADE_CONFIDENCE_LEVELS)[number], number> = {
      low: 0,
      moderate: 1,
      high: 2,
    };
    const weakest = confidence.dimensions.reduce(
      (level, dimension) => (rank[dimension.level] < rank[level] ? dimension.level : level),
      confidence.dimensions[0].level
    );
    if (confidence.overallLevel !== weakest) {
      context.addIssue({
        code: 'custom',
        path: ['overallLevel'],
        message: 'Overall confidence must equal the weakest evidence dimension.',
      });
    }
  });

export const aflTradeProjectionPublicEvidenceExcludedRootSchema = z
  .object({
    rootAssetId: aflTradePublicIdSchema,
    reasonCode: aflTradePublicIdSchema,
    message: aflTradePublicMessageSchema,
    sourceBindings: canonicalSourceBindings(
      aflTradeProjectionPublicEvidenceCoverageSourceBindingSchema
    ),
  })
  .strict();

const coverageCommonShape = {
  view: aflTradeValuationViewSchema,
  temporalContext: aflTradeTemporalContextSchema,
  totalAssetCount: z.number().int().positive().max(100),
  valuedAssetCount: z.number().int().nonnegative().max(100),
  excludedAssetCount: z.number().int().nonnegative().max(100),
  excludedRoots: z.array(aflTradeProjectionPublicEvidenceExcludedRootSchema).max(100),
  sourceBindings: canonicalSourceBindings(
    aflTradeProjectionPublicEvidenceCoverageSourceBindingSchema
  ),
} as const;

const completeCoverageSchema = z
  .object({
    ...coverageCommonShape,
    status: z.literal('complete'),
    excludedAssetCount: z.literal(0),
    excludedRoots: z.array(aflTradeProjectionPublicEvidenceExcludedRootSchema).length(0),
  })
  .strict();

const partialCoverageSchema = z
  .object({
    ...coverageCommonShape,
    status: z.literal('partial'),
    valuedAssetCount: z.number().int().positive().max(99),
    excludedAssetCount: z.number().int().positive().max(99),
    excludedRoots: z.array(aflTradeProjectionPublicEvidenceExcludedRootSchema).min(1).max(99),
  })
  .strict();

const unavailableCoverageSchema = z
  .object({
    ...coverageCommonShape,
    status: z.literal('unavailable'),
    valuedAssetCount: z.literal(0),
    excludedAssetCount: z.number().int().positive().max(100),
    excludedRoots: z.array(aflTradeProjectionPublicEvidenceExcludedRootSchema).min(1).max(100),
  })
  .strict();

export const aflTradeProjectionPublicEvidenceCoverageViewSchema = z.union([
  completeCoverageSchema,
  partialCoverageSchema,
  unavailableCoverageSchema,
]);

export const aflTradeProjectionPublicEvidenceAssetSchema = z
  .object({
    assetId: aflTradePublicIdSchema,
    assetKind: z.enum(AFL_TRADE_PUBLIC_ASSET_KINDS),
    label: z.string().trim().min(1).max(200),
    receivedByAflClubId: aflTradePublicIdSchema,
    identitySourceBindings: canonicalSourceBindings(
      aflTradeProjectionPublicEvidenceAssetIdentitySourceBindingSchema
    ),
    lineage: z
      .object({
        status: z.enum(['resolved', 'partial']),
        rootAssetId: aflTradePublicIdSchema,
        creditedAssetIds: z.array(aflTradePublicIdSchema).min(1).max(100),
        summary: z.string().trim().min(1).max(1_000),
        edgeCount: z.number().int().nonnegative().max(10_000),
        maximumDepth: z.number().int().nonnegative().max(100),
        sourceBindings: canonicalSourceBindings(
          aflTradeProjectionPublicEvidenceLineageFrontierSourceBindingSchema
        ),
      })
      .strict(),
  })
  .strict()
  .superRefine((asset, context) => {
    if (asset.lineage.rootAssetId !== asset.assetId) {
      context.addIssue({
        code: 'custom',
        path: ['lineage', 'rootAssetId'],
        message: 'Public evidence lineage must use the traded asset as its root.',
      });
    }
    if (!usesStrictCodeUnitOrder(asset.lineage.creditedAssetIds)) {
      context.addIssue({
        code: 'custom',
        path: ['lineage', 'creditedAssetIds'],
        message: 'Credited lineage identifiers must be unique and canonically ordered.',
      });
    }
    if (
      (asset.lineage.edgeCount === 0 && asset.lineage.maximumDepth !== 0) ||
      (asset.lineage.edgeCount > 0 && asset.lineage.maximumDepth === 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lineage'],
        message: 'Lineage edge count and maximum depth must describe the same topology.',
      });
    }
  });

export const aflTradeProjectionPublicEvidenceFactorSchema = aflTradeValueFactorSchema
  .extend({
    sourceBindings: canonicalSourceBindings(
      aflTradeProjectionPublicEvidenceFactorSourceBindingSchema
    ),
  })
  .strict();

export const aflTradeProjectionPublicEvidenceFactorViewSchema = z
  .object({
    view: aflTradeValuationViewSchema,
    temporalContext: aflTradeTemporalContextSchema,
    factors: z.array(aflTradeProjectionPublicEvidenceFactorSchema).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (!factorsUseUniqueKeysAndCanonicalOrder(value.factors)) {
      context.addIssue({
        code: 'custom',
        path: ['factors'],
        message:
          'Public evidence factors must be unique by kind and code, then canonically ordered.',
      });
    }
  });

const predecessorPolicySchema = z
  .object({
    predecessorSchemaVersion: z.null(),
    compatibility: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PREDECESSOR_COMPATIBILITY),
    latestAlias: z.literal('prohibited'),
    runtimeFallback: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_RUNTIME_FALLBACK),
  })
  .strict();

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function usesStrictCodeUnitOrder(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || compareCodeUnits(values[index - 1], value) < 0
  );
}

function usesCompleteViewOrder(values: readonly { view: string }[]): boolean {
  return (
    values.length === AFL_TRADE_VALUATION_VIEWS.length &&
    values.every((value, index) => value.view === AFL_TRADE_VALUATION_VIEWS[index])
  );
}

function compareSourceBindings(left: SourceBinding, right: SourceBinding): number {
  const roleDifference = compareCodeUnits(left.sourceRole, right.sourceRole);
  if (roleDifference !== 0) return roleDifference;
  const schemaDifference = compareCodeUnits(left.sourceSchemaVersion, right.sourceSchemaVersion);
  if (schemaDifference !== 0) return schemaDifference;
  const semanticArtifactDifference = compareCodeUnits(
    left.semanticArtifactId,
    right.semanticArtifactId
  );
  if (semanticArtifactDifference !== 0) return semanticArtifactDifference;
  const locatorDifference = compareCodeUnits(left.recordLocator, right.recordLocator);
  if (locatorDifference !== 0) return locatorDifference;
  const pathDifference = compareCodeUnits(left.fieldPath, right.fieldPath);
  if (pathDifference !== 0) return pathDifference;
  const claimDifference = compareCodeUnits(left.claimedValueSha256, right.claimedValueSha256);
  if (claimDifference !== 0) return claimDifference;
  const effectiveDifference = compareCodeUnits(left.sourceEffectiveAt, right.sourceEffectiveAt);
  if (effectiveDifference !== 0) return effectiveDifference;
  const knownDifference = compareCodeUnits(left.sourceKnownAt, right.sourceKnownAt);
  if (knownDifference !== 0) return knownDifference;
  return compareCodeUnits(left.artifactRef.artifactId, right.artifactRef.artifactId);
}

function sourceBindingsUseCanonicalOrder(bindings: readonly SourceBinding[]): boolean {
  return bindings.every(
    (binding, index) => index === 0 || compareSourceBindings(bindings[index - 1], binding) < 0
  );
}

type EvidenceFactor = z.infer<typeof aflTradeProjectionPublicEvidenceFactorSchema>;

const FACTOR_KIND_RANK: Readonly<Record<EvidenceFactor['kind'], number>> = Object.freeze({
  positive: 0,
  negative: 1,
  uncertainty: 2,
});

function compareFactors(left: EvidenceFactor, right: EvidenceFactor): number {
  const kindDifference = FACTOR_KIND_RANK[left.kind] - FACTOR_KIND_RANK[right.kind];
  if (kindDifference !== 0) return kindDifference;
  const codeDifference = compareCodeUnits(left.code, right.code);
  if (codeDifference !== 0) return codeDifference;
  const labelDifference = compareCodeUnits(left.label, right.label);
  if (labelDifference !== 0) return labelDifference;
  const explanationDifference = compareCodeUnits(left.explanation, right.explanation);
  if (explanationDifference !== 0) return explanationDifference;
  return compareCodeUnits(
    canonicalizeAflTradeJson(left.sourceBindings),
    canonicalizeAflTradeJson(right.sourceBindings)
  );
}

function factorsUseUniqueKeysAndCanonicalOrder(factors: readonly EvidenceFactor[]): boolean {
  const keys = factors.map((factor) => `${factor.kind}\u0000${factor.code}`);
  return (
    new Set(keys).size === keys.length &&
    factors.every((factor, index) => index === 0 || compareFactors(factors[index - 1], factor) < 0)
  );
}

type CoverageView = z.infer<typeof aflTradeProjectionPublicEvidenceCoverageViewSchema>;

function addCoverageIssues(
  coverage: CoverageView,
  assetIds: readonly string[],
  context: z.RefinementCtx,
  coverageIndex: number
): void {
  const path = ['coverageByView', coverageIndex] as const;
  if (coverage.totalAssetCount !== assetIds.length) {
    context.addIssue({
      code: 'custom',
      path: [...path, 'totalAssetCount'],
      message: 'Coverage total must equal the traded-root evidence count.',
    });
  }
  if (coverage.valuedAssetCount + coverage.excludedAssetCount !== coverage.totalAssetCount) {
    context.addIssue({
      code: 'custom',
      path: [...path],
      message: 'Valued and excluded coverage counts must reconcile to the total.',
    });
  }
  if (coverage.excludedRoots.length !== coverage.excludedAssetCount) {
    context.addIssue({
      code: 'custom',
      path: [...path, 'excludedRoots'],
      message: 'Every excluded traded root requires exactly one evidence reason.',
    });
  }
  const excludedIds = coverage.excludedRoots.map((root) => root.rootAssetId);
  if (!usesStrictCodeUnitOrder(excludedIds) || excludedIds.some((id) => !assetIds.includes(id))) {
    context.addIssue({
      code: 'custom',
      path: [...path, 'excludedRoots'],
      message: 'Excluded roots must be unique, canonical members of the traded-root set.',
    });
  }
  if (
    coverage.status === 'complete' &&
    (coverage.valuedAssetCount !== coverage.totalAssetCount || coverage.excludedRoots.length !== 0)
  ) {
    context.addIssue({
      code: 'custom',
      path: [...path],
      message: 'Complete coverage must value every traded root without exclusions.',
    });
  }
  if (
    coverage.status === 'partial' &&
    (coverage.valuedAssetCount < 1 || coverage.valuedAssetCount >= coverage.totalAssetCount)
  ) {
    context.addIssue({
      code: 'custom',
      path: [...path],
      message: 'Partial coverage must value some, but not all, traded roots.',
    });
  }
  if (
    coverage.status === 'unavailable' &&
    (coverage.valuedAssetCount !== 0 ||
      excludedIds.length !== assetIds.length ||
      excludedIds.some((id, index) => id !== assetIds[index]))
  ) {
    context.addIssue({
      code: 'custom',
      path: [...path],
      message: 'Unavailable coverage must explicitly exclude every canonical traded root.',
    });
  }
}

function sourceBindings(
  content: z.infer<typeof aflTradeProjectionPublicEvidenceContentSchema>
): SourceBinding[] {
  return [
    ...content.confidenceByView.flatMap((view) =>
      view.dimensions.flatMap((dimension) => dimension.sourceBindings)
    ),
    ...content.coverageByView.flatMap((view) => [
      ...view.sourceBindings,
      ...view.excludedRoots.flatMap((root) => root.sourceBindings),
    ]),
    ...content.assets.flatMap((asset) => [
      ...asset.identitySourceBindings,
      ...asset.lineage.sourceBindings,
    ]),
    ...content.factorsByView.flatMap((view) =>
      view.factors.flatMap((factor) => factor.sourceBindings)
    ),
  ];
}

function temporalContextsMatch(
  left: z.infer<typeof aflTradeTemporalContextSchema>,
  right: z.infer<typeof aflTradeTemporalContextSchema>
): boolean {
  return (
    left.effectiveAt === right.effectiveAt &&
    left.knowledgeCutoffAt === right.knowledgeCutoffAt &&
    left.valuationAsOf === right.valuationAsOf
  );
}

function addSourceBindingTemporalIssues(
  bindings: readonly SourceBinding[],
  temporalContext: z.infer<typeof aflTradeTemporalContextSchema>,
  context: z.RefinementCtx,
  path: (string | number)[]
): void {
  const valuationAsOf = Date.parse(temporalContext.valuationAsOf);
  const knowledgeCutoffAt = Date.parse(temporalContext.knowledgeCutoffAt);
  for (const [bindingIndex, binding] of bindings.entries()) {
    if (Date.parse(binding.sourceEffectiveAt) > valuationAsOf) {
      context.addIssue({
        code: 'custom',
        path: [...path, bindingIndex, 'sourceEffectiveAt'],
        message: 'A source claim cannot take effect after the relevant valuation as-of time.',
      });
    }
    if (Date.parse(binding.sourceKnownAt) > knowledgeCutoffAt) {
      context.addIssue({
        code: 'custom',
        path: [...path, bindingIndex, 'sourceKnownAt'],
        message: 'A source claim cannot become known after the relevant knowledge cutoff.',
      });
    }
  }
}

export const aflTradeProjectionPublicEvidenceContentSchema = z
  .object({
    ...commonShape,
    viewContexts: z
      .array(aflTradeProjectionPublicEvidenceViewContextSchema)
      .length(AFL_TRADE_VALUATION_VIEWS.length),
    confidenceByView: z
      .array(aflTradeProjectionPublicEvidenceConfidenceViewSchema)
      .length(AFL_TRADE_VALUATION_VIEWS.length),
    coverageByView: z
      .array(aflTradeProjectionPublicEvidenceCoverageViewSchema)
      .length(AFL_TRADE_VALUATION_VIEWS.length),
    assets: z.array(aflTradeProjectionPublicEvidenceAssetSchema).min(1).max(100),
    factorsByView: z
      .array(aflTradeProjectionPublicEvidenceFactorViewSchema)
      .length(AFL_TRADE_VALUATION_VIEWS.length),
    predecessorPolicy: predecessorPolicySchema,
    limitation: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (!usesCompleteViewOrder(content.viewContexts)) {
      context.addIssue({
        code: 'custom',
        path: ['viewContexts'],
        message: 'viewContexts must contain every valuation view in canonical order.',
      });
    }
    for (const [viewIndex, viewContext] of content.viewContexts.entries()) {
      if (
        Date.parse(viewContext.temporalContext.valuationAsOf) > Date.parse(content.materializedAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['viewContexts', viewIndex, 'temporalContext', 'valuationAsOf'],
          message: 'A valuation view cannot postdate evidence materialization.',
        });
      }
    }
    for (const [path, views] of [
      ['confidenceByView', content.confidenceByView],
      ['coverageByView', content.coverageByView],
      ['factorsByView', content.factorsByView],
    ] as const) {
      if (!usesCompleteViewOrder(views)) {
        context.addIssue({
          code: 'custom',
          path: [path],
          message: `${path} must contain every valuation view in canonical order.`,
        });
      }
      for (const [viewIndex, view] of views.entries()) {
        const canonicalContext = content.viewContexts[viewIndex];
        if (
          canonicalContext === undefined ||
          view.view !== canonicalContext.view ||
          !temporalContextsMatch(view.temporalContext, canonicalContext.temporalContext)
        ) {
          context.addIssue({
            code: 'custom',
            path: [path, viewIndex, 'temporalContext'],
            message: `${path} must use the exact canonical temporal context for its view.`,
          });
        }
      }
    }
    const assetIds = content.assets.map((asset) => asset.assetId);
    if (!usesStrictCodeUnitOrder(assetIds)) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Traded-root evidence must use unique canonical asset order.',
      });
    }
    const creditedAssetIds = content.assets.flatMap((asset) => asset.lineage.creditedAssetIds);
    if (new Set(creditedAssetIds).size !== creditedAssetIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'A credited lineage asset can belong to only one traded root.',
      });
    }
    for (const [index, coverage] of content.coverageByView.entries()) {
      addCoverageIssues(coverage, assetIds, context, index);
    }
    const materializedAt = Date.parse(content.materializedAt);
    if (
      sourceBindings(content).some(
        (binding) =>
          binding.artifactRef.byteLength < 1 ||
          Date.parse(binding.artifactRef.createdAt) > materializedAt
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materializedAt'],
        message:
          'Source artifact references must be nonempty and cannot postdate evidence materialization.',
      });
    }
    for (const [viewIndex, viewContext] of content.viewContexts.entries()) {
      const temporalContext = viewContext.temporalContext;
      const confidence = content.confidenceByView[viewIndex];
      const coverage = content.coverageByView[viewIndex];
      const factors = content.factorsByView[viewIndex];
      if (confidence !== undefined) {
        for (const [dimensionIndex, dimension] of confidence.dimensions.entries()) {
          addSourceBindingTemporalIssues(dimension.sourceBindings, temporalContext, context, [
            'confidenceByView',
            viewIndex,
            'dimensions',
            dimensionIndex,
            'sourceBindings',
          ]);
        }
      }
      if (coverage !== undefined) {
        addSourceBindingTemporalIssues(coverage.sourceBindings, temporalContext, context, [
          'coverageByView',
          viewIndex,
          'sourceBindings',
        ]);
        for (const [rootIndex, root] of coverage.excludedRoots.entries()) {
          addSourceBindingTemporalIssues(root.sourceBindings, temporalContext, context, [
            'coverageByView',
            viewIndex,
            'excludedRoots',
            rootIndex,
            'sourceBindings',
          ]);
        }
      }
      if (factors !== undefined) {
        for (const [factorIndex, factor] of factors.factors.entries()) {
          addSourceBindingTemporalIssues(factor.sourceBindings, temporalContext, context, [
            'factorsByView',
            viewIndex,
            'factors',
            factorIndex,
            'sourceBindings',
          ]);
        }
      }
      for (const [assetIndex, asset] of content.assets.entries()) {
        addSourceBindingTemporalIssues(asset.identitySourceBindings, temporalContext, context, [
          'assets',
          assetIndex,
          'identitySourceBindings',
        ]);
        addSourceBindingTemporalIssues(asset.lineage.sourceBindings, temporalContext, context, [
          'assets',
          assetIndex,
          'lineage',
          'sourceBindings',
        ]);
      }
    }
  });

export const aflTradeProjectionPublicEvidenceSchema = z
  .object({
    projectionPublicEvidenceId: aflTradeContentAddressedIdSchema('projection-public-evidence'),
    content: aflTradeProjectionPublicEvidenceContentSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    addAflTradeContentAddressIssue(
      'projection-public-evidence',
      evidence.projectionPublicEvidenceId,
      evidence.content,
      context,
      ['projectionPublicEvidenceId']
    );
  });

export const aflTradeProjectionPublicEvidenceResultSchema = z
  .object({
    projectionPublicEvidence: aflTradeProjectionPublicEvidenceSchema,
    projectionPublicEvidenceArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const evidence = result.projectionPublicEvidence;
    const reference = result.projectionPublicEvidenceArtifactRef;
    if (!doesAflTradeArtifactRefMatchCanonicalJson(reference, evidence)) {
      context.addIssue({
        code: 'custom',
        path: ['projectionPublicEvidenceArtifactRef'],
        message: 'Public-evidence artifact reference must authenticate the complete artifact.',
      });
    }
    if (reference.createdAt !== evidence.content.materializedAt) {
      context.addIssue({
        code: 'custom',
        path: ['projectionPublicEvidenceArtifactRef', 'createdAt'],
        message: 'Public-evidence artifact time must equal content materialization time.',
      });
    }
    if (
      reference.byteLength < 1 ||
      reference.byteLength > AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_MAX_ARTIFACT_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionPublicEvidenceArtifactRef', 'byteLength'],
        message: 'Projection public evidence exceeds its one MiB artifact limit.',
      });
    }
  });

export type AflTradeProjectionPublicEvidenceConfidenceDimension = z.infer<
  typeof aflTradeProjectionPublicEvidenceConfidenceDimensionSchema
>;
export type AflTradeProjectionPublicEvidenceViewContext = z.infer<
  typeof aflTradeProjectionPublicEvidenceViewContextSchema
>;
export type AflTradeProjectionPublicEvidenceSourceBinding = SourceBinding;
export type AflTradeProjectionPublicEvidenceConfidenceView = z.infer<
  typeof aflTradeProjectionPublicEvidenceConfidenceViewSchema
>;
export type AflTradeProjectionPublicEvidenceCoverageView = z.infer<
  typeof aflTradeProjectionPublicEvidenceCoverageViewSchema
>;
export type AflTradeProjectionPublicEvidenceAsset = z.infer<
  typeof aflTradeProjectionPublicEvidenceAssetSchema
>;
export type AflTradeProjectionPublicEvidenceFactor = z.infer<
  typeof aflTradeProjectionPublicEvidenceFactorSchema
>;
export type AflTradeProjectionPublicEvidenceContent = z.infer<
  typeof aflTradeProjectionPublicEvidenceContentSchema
>;
export type AflTradeProjectionPublicEvidence = z.infer<
  typeof aflTradeProjectionPublicEvidenceSchema
>;
export type AflTradeProjectionPublicEvidenceResult = z.infer<
  typeof aflTradeProjectionPublicEvidenceResultSchema
>;

export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_CONSTRUCTION_ERROR_CODES = Object.freeze([
  'INVALID_INPUT_ENVELOPE',
  'INVALID_MATERIALIZED_AT',
  'INVALID_CONTENT',
  'MATERIALIZED_AT_MISMATCH',
  'ARTIFACT_SIZE_LIMIT_EXCEEDED',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const);

export type AflTradeProjectionPublicEvidenceConstructionErrorCode =
  (typeof AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_CONSTRUCTION_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<
  Record<AflTradeProjectionPublicEvidenceConstructionErrorCode, string>
> = Object.freeze({
  INVALID_INPUT_ENVELOPE: 'The projection-public-evidence input envelope is invalid.',
  INVALID_MATERIALIZED_AT: 'The projection-public-evidence materialization time is invalid.',
  INVALID_CONTENT: 'The projection-public-evidence semantic content is invalid.',
  MATERIALIZED_AT_MISMATCH:
    'Projection-public-evidence content and constructor materialization times do not match.',
  ARTIFACT_SIZE_LIMIT_EXCEEDED: 'Projection public evidence exceeds one MiB.',
  INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
    'Projection public evidence failed its internal artifact contract.',
});

const TRUSTED_ERRORS = new WeakSet<object>();

export class AflTradeProjectionPublicEvidenceConstructionError extends Error {
  readonly code: AflTradeProjectionPublicEvidenceConstructionErrorCode;

  constructor(code: AflTradeProjectionPublicEvidenceConstructionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AflTradeProjectionPublicEvidenceConstructionError';
    this.code = code;
    TRUSTED_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeProjectionPublicEvidenceConstructionError';
    code: AflTradeProjectionPublicEvidenceConstructionErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeProjectionPublicEvidenceConstructionError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeProjectionPublicEvidenceConstructionError(
  value: unknown
): value is AflTradeProjectionPublicEvidenceConstructionError {
  return value !== null && typeof value === 'object' && TRUSTED_ERRORS.has(value);
}

function constructionError(
  code: AflTradeProjectionPublicEvidenceConstructionErrorCode
): AflTradeProjectionPublicEvidenceConstructionError {
  return new AflTradeProjectionPublicEvidenceConstructionError(code);
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeProjectionPublicEvidenceConstructionErrorCode
): T {
  try {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    // Hostile values are replaced with the stable contract error below.
  }
  throw constructionError(code);
}

function snapshotExactEnvelope<const Key extends string>(
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

const CREATE_INPUT_KEYS = ['content', 'materializedAt'] as const;

export function createAflTradeProjectionPublicEvidence(
  unparsedInput: unknown
): AflTradeProjectionPublicEvidenceResult {
  try {
    const snapshot = snapshotExactEnvelope(unparsedInput, CREATE_INPUT_KEYS);
    if (snapshot === null) throw constructionError('INVALID_INPUT_ENVELOPE');
    const materializedAt = parseOrThrow(
      aflTradeIsoDateTimeSchema,
      snapshot.materializedAt,
      'INVALID_MATERIALIZED_AT'
    );
    const content = parseOrThrow(
      aflTradeProjectionPublicEvidenceContentSchema,
      snapshot.content,
      'INVALID_CONTENT'
    );
    if (content.materializedAt !== materializedAt) {
      throw constructionError('MATERIALIZED_AT_MISMATCH');
    }

    const projectionPublicEvidence = aflTradeProjectionPublicEvidenceSchema.safeParse({
      projectionPublicEvidenceId: createAflTradeContentAddress(
        'projection-public-evidence',
        content
      ),
      content,
    });
    if (!projectionPublicEvidence.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    const projectionPublicEvidenceArtifactRef = createAflTradeCanonicalJsonArtifactRef(
      projectionPublicEvidence.data,
      materializedAt
    );
    if (
      projectionPublicEvidenceArtifactRef.byteLength < 1 ||
      projectionPublicEvidenceArtifactRef.byteLength >
        AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_MAX_ARTIFACT_BYTES
    ) {
      throw constructionError('ARTIFACT_SIZE_LIMIT_EXCEEDED');
    }
    const result = aflTradeProjectionPublicEvidenceResultSchema.safeParse({
      projectionPublicEvidence: projectionPublicEvidence.data,
      projectionPublicEvidenceArtifactRef,
    });
    if (!result.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    return deepFreeze(result.data);
  } catch (error) {
    if (isAflTradeProjectionPublicEvidenceConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

const VERIFY_INPUT_KEYS = [...CREATE_INPUT_KEYS, 'output'] as const;

export function verifyAflTradeProjectionPublicEvidenceDerivation(input: unknown): boolean {
  try {
    const snapshot = snapshotExactEnvelope(input, VERIFY_INPUT_KEYS);
    if (snapshot === null) return false;
    const output = aflTradeProjectionPublicEvidenceResultSchema.safeParse(snapshot.output);
    if (!output.success) return false;
    const replayed = createAflTradeProjectionPublicEvidence({
      content: snapshot.content,
      materializedAt: snapshot.materializedAt,
    });
    return canonicalizeAflTradeJson(replayed) === canonicalizeAflTradeJson(output.data);
  } catch {
    return false;
  }
}
