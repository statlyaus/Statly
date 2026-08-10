import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';
import {
  aflTradeIsoDateTimeSchema,
  aflTradePublicIdSchema,
} from '@/types/aflTradeIntelligence/shared';

import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_BINDING_DIRECTION,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DISTRIBUTION_PARTITIONING,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_GRANULARITY,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_REQUIREMENT,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SEMANTIC_BINDING,
  aflTradeValuationBundleManifestV2Schema,
  aflTradeValuationOutputInventoryContractSchema,
  type AflTradeValuationBundleManifestV2,
} from '../artifacts/valuationBundleManifest';
import { compareAflTradeCodeUnits } from './deterministicProbabilityMeasure';
import {
  aflTradeValuationComparisonMeasureSchema,
  aflTradeValuationComparisonSchema,
  verifyAflTradeValuationComparisonCaseCalculationDerivation,
  type AflTradeValuationComparison,
  type AflTradeValuationComparisonMeasure,
} from './jointOutcomeComparisonArtifact';
import {
  aflTradeStructuredExplanationV2Schema,
  verifyAflTradeStructuredExplanationV2Derivation,
  type AflTradeStructuredExplanationV2,
} from './structuredExplanationsV2';
import {
  aflTradeValuationCalculationSchema,
  type AflTradeValuationCalculation,
} from './tradeValuationCalculation';
import { aflTradeValuationCaseSchema, type AflTradeValuationCase } from './valuationCaseContracts';
import {
  aflTradeValuationDistributionMeasureSchema,
  aflTradeValuationDistributionSchema,
  aflTradeValuationDistributionSubjectSchema,
  verifyAflTradeValuationDistributionCaseCalculationDerivation,
  type AflTradeValuationDistribution,
  type AflTradeValuationDistributionMeasure,
  type AflTradeValuationDistributionSubject,
} from './valuationDistributionArtifact';

export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SHARD_SCHEMA_VERSION =
  'afl-trade-valuation-output-inventory-shard/v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY =
  'source_native_afl_assets_no_user_or_fantasy_ownership' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_REQUIRED_DISTRIBUTION_COVERAGE =
  'complete_universal_view_layer_subject_lattice_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_OPTIONAL_CLUB_UTILITY_COVERAGE =
  'complete_all_view_subject_lattice_or_absent_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_ORDERING_DEFINITION =
  'view_then_measure_then_case_party_package_then_root_code_unit_order_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SHARD_VERIFICATION_SCOPE =
  'distribution_membership_and_case_calculation_scoped_replay_only_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_VERIFICATION_SCOPE =
  'inventory_membership_byte_binding_lattice_and_descendant_scoped_replay_only_storage_existence_and_upstream_provenance_require_separate_validation_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_POLICY_DEFINITION =
  'detached_successor_inventory_no_implicit_predecessor_conversion_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_COMPATIBILITY =
  'parallel_predecessors_audit_only_no_lossless_upcast_or_downcast_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_UPCAST_TREATMENT =
  'prohibited_recompute_from_v2_bundle_case_calculation_and_successor_outputs' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DOWNCAST_TREATMENT = 'prohibited' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_RUNTIME_FALLBACK = 'prohibited' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_AUTHORITY =
  'complete_verified_v2_bundle_successor_inventory_only' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_LEGACY_TREATMENT =
  'optional_audit_evidence_never_satisfies_inventory_output_roles' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SHARD_LIMITATION =
  'Immutable detached distribution membership shard only; it does not prove artifact-repository persistence, source approval, upstream calculation provenance, model calibration, Gate approval, or publication readiness.' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_LIMITATION =
  'Immutable detached output membership inventory only; it does not prove artifact-repository persistence, source approval, upstream calculation provenance, model calibration, Gate approval, or publication readiness.' as const;

export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_REQUIRED_SHARD_COUNT = 12;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_OPTIONAL_SHARD_COUNT = 4;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_COUNT = 16;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SUBJECTS_PER_SHARD = 1_818;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_DISTRIBUTION_COUNT = 29_088;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT = 12;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_BYTES = 4 * 1024 * 1024;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_ROOT_BYTES = 256 * 1024;

const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Inventory bindings require canonical JSON artifact references.'
);

const universalMeasures = [
  { kind: 'universal_football_value', layer: 'gross' },
  { kind: 'universal_football_value', layer: 'list_spot_adjusted' },
  { kind: 'universal_football_value', layer: 'scarcity_adjusted' },
] as const satisfies readonly AflTradeValuationDistributionMeasure[];
const clubUtilityMeasure = { kind: 'single_afl_club_utility' } as const;
const allMeasures = [...universalMeasures, clubUtilityMeasure] as const;

type ValuationView = (typeof AFL_TRADE_VALUATION_VIEWS)[number];

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function coordinateKey(coordinate: {
  view: ValuationView;
  measure: AflTradeValuationDistributionMeasure | AflTradeValuationComparisonMeasure;
  subject?: AflTradeValuationDistributionSubject;
}): string {
  return canonicalizeAflTradeJson({
    view: coordinate.view,
    measure: coordinate.measure,
    ...(coordinate.subject === undefined ? {} : { subject: coordinate.subject }),
  });
}

export const aflTradeValuationOutputInventoryBundleInputSchema = z
  .object({
    valuationBundleManifest: aflTradeValuationBundleManifestV2Schema,
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();
export const aflTradeValuationOutputInventoryCaseInputSchema = z
  .object({
    valuationCase: aflTradeValuationCaseSchema,
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();
export const aflTradeValuationOutputInventoryCalculationInputSchema = z
  .object({
    valuationCalculation: aflTradeValuationCalculationSchema,
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();
export const aflTradeValuationOutputInventoryDistributionInputSchema = z
  .object({
    valuationDistribution: aflTradeValuationDistributionSchema,
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();
export const aflTradeValuationOutputInventoryComparisonInputSchema = z
  .object({
    valuationComparison: aflTradeValuationComparisonSchema,
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();
export const aflTradeValuationOutputInventoryExplanationInputSchema = z
  .object({
    structuredExplanation: aflTradeStructuredExplanationV2Schema,
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();

export const aflTradeValuationOutputInventoryCreateInputSchema = z
  .object({
    valuationBundle: aflTradeValuationOutputInventoryBundleInputSchema,
    valuationCase: aflTradeValuationOutputInventoryCaseInputSchema,
    valuationCalculation: aflTradeValuationOutputInventoryCalculationInputSchema,
    valuationDistributions: z
      .array(aflTradeValuationOutputInventoryDistributionInputSchema)
      .min(1)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_DISTRIBUTION_COUNT),
    valuationComparisons: z
      .array(aflTradeValuationOutputInventoryComparisonInputSchema)
      .length(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT),
    structuredExplanation: aflTradeValuationOutputInventoryExplanationInputSchema,
    materializedAt: aflTradeIsoDateTimeSchema,
  })
  .strict();

export type AflTradeValuationOutputInventoryCreateInput = z.infer<
  typeof aflTradeValuationOutputInventoryCreateInputSchema
>;

const shardDistributionBindingSchema = z
  .object({
    subject: aflTradeValuationDistributionSubjectSchema,
    valuationDistributionId: aflTradeContentAddressedIdSchema('valuation-distribution'),
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();

const shardCoordinateSchema = z
  .object({
    view: z.enum(AFL_TRADE_VALUATION_VIEWS),
    measure: aflTradeValuationDistributionMeasureSchema,
  })
  .strict();

function subjectsUseCanonicalOrder(
  subjects: readonly AflTradeValuationDistributionSubject[]
): boolean {
  const byClub = new Map<string, AflTradeValuationDistributionSubject[]>();
  for (const subject of subjects) {
    const values = byClub.get(subject.aflClubId) ?? [];
    values.push(subject);
    byClub.set(subject.aflClubId, values);
  }
  const clubIds = [...byClub.keys()].sort(compareAflTradeCodeUnits);
  const canonicalSubjects: AflTradeValuationDistributionSubject[] = [];
  for (const clubId of clubIds) {
    const values = byClub.get(clubId)!;
    const packages = values.filter((subject) => subject.kind === 'afl_club_received_package');
    const roots = values.filter((subject) => subject.kind === 'source_native_afl_trade_root');
    if (packages.length !== 1 || packages.length + roots.length !== values.length) return false;
    const rootIds = roots.map((subject) => subject.rootAssetId);
    const canonicalRootIds = [...new Set(rootIds)].sort(compareAflTradeCodeUnits);
    if (canonicalRootIds.length !== rootIds.length) return false;
    canonicalSubjects.push(packages[0]);
    canonicalSubjects.push(
      ...canonicalRootIds.map((rootAssetId) => ({
        kind: 'source_native_afl_trade_root' as const,
        aflClubId: clubId,
        rootAssetId,
      }))
    );
  }
  return sameCanonicalJson(subjects, canonicalSubjects);
}

export const aflTradeValuationOutputInventoryShardContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SHARD_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY),
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    lineageGraphId: aflTradeContentAddressedIdSchema('lineage-graph'),
    componentDrawSetId: aflTradeContentAddressedIdSchema('component-draw-set'),
    realizedContributionLedgerId: aflTradeContentAddressedIdSchema('realized-contribution-ledger'),
    packagePolicyId: aflTradeContentAddressedIdSchema('package-policy'),
    tradeId: aflTradePublicIdSchema,
    valueUnitId: aflTradePublicIdSchema,
    coordinate: shardCoordinateSchema,
    semanticBinding: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SEMANTIC_BINDING),
    orderingDefinition: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_ORDERING_DEFINITION),
    verificationScope: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SHARD_VERIFICATION_SCOPE),
    distributionCount: z
      .number()
      .int()
      .min(1)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SUBJECTS_PER_SHARD),
    distributionSetSha256: aflTradeSha256Schema,
    distributions: z
      .array(shardDistributionBindingSchema)
      .min(1)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SUBJECTS_PER_SHARD),
    materializedAt: aflTradeIsoDateTimeSchema,
    limitation: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SHARD_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.distributionCount !== content.distributions.length) {
      context.addIssue({
        code: 'custom',
        path: ['distributionCount'],
        message: 'Shard distribution count must match its bindings.',
      });
    }
    if (sha256AflTradeCanonicalJson(content.distributions) !== content.distributionSetSha256) {
      context.addIssue({
        code: 'custom',
        path: ['distributionSetSha256'],
        message: 'Shard distribution digest must authenticate its canonical bindings.',
      });
    }
    const ids = content.distributions.map((binding) => binding.valuationDistributionId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['distributions'],
        message: 'Shard distribution identities must be unique.',
      });
    }
    if (!subjectsUseCanonicalOrder(content.distributions.map((binding) => binding.subject))) {
      context.addIssue({
        code: 'custom',
        path: ['distributions'],
        message: 'Shard subjects must use canonical case-party, package, and root order.',
      });
    }
    if (
      content.distributions.some(
        (binding) => Date.parse(binding.artifactRef.createdAt) > Date.parse(content.materializedAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['distributions'],
        message: 'Shard source artifacts must exist no later than shard materialization.',
      });
    }
  });

export const aflTradeValuationOutputInventoryShardSchema = z
  .object({
    valuationOutputInventoryShardId: aflTradeContentAddressedIdSchema(
      'valuation-output-inventory-shard'
    ),
    content: aflTradeValuationOutputInventoryShardContentSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    addAflTradeContentAddressIssue(
      'valuation-output-inventory-shard',
      artifact.valuationOutputInventoryShardId,
      artifact.content,
      context,
      ['valuationOutputInventoryShardId']
    );
  });

export type AflTradeValuationOutputInventoryShardContent = z.infer<
  typeof aflTradeValuationOutputInventoryShardContentSchema
>;
export type AflTradeValuationOutputInventoryShard = z.infer<
  typeof aflTradeValuationOutputInventoryShardSchema
>;

const parentBundleBindingSchema = z
  .object({
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();
const parentCaseBindingSchema = z
  .object({
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();
const parentCalculationBindingSchema = z
  .object({
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();
const rootShardBindingSchema = z
  .object({
    valuationOutputInventoryShardId: aflTradeContentAddressedIdSchema(
      'valuation-output-inventory-shard'
    ),
    artifactRef: canonicalJsonArtifactRefSchema,
    coordinate: shardCoordinateSchema,
    distributionCount: z
      .number()
      .int()
      .min(1)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SUBJECTS_PER_SHARD),
    distributionSetSha256: aflTradeSha256Schema,
  })
  .strict();
const rootComparisonBindingSchema = z
  .object({
    view: z.enum(AFL_TRADE_VALUATION_VIEWS),
    measure: aflTradeValuationComparisonMeasureSchema,
    valuationComparisonId: aflTradeContentAddressedIdSchema('valuation-comparison'),
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();
const rootExplanationBindingSchema = z
  .object({
    structuredExplanationId: aflTradeContentAddressedIdSchema('structured-explanation'),
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();

export const aflTradeValuationOutputInventoryPredecessorPolicySchema = z
  .object({
    definitionVersion: z.literal(
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_POLICY_DEFINITION
    ),
    valuationBundlePredecessorSchemaVersion: z.literal('afl-trade-valuation-bundle/v1'),
    valuationSnapshotSetSchemaVersion: z.literal('afl-trade-valuation-snapshot-set/v1'),
    structuredExplanationSchemaVersion: z.literal('afl-trade-structured-explanation/v1'),
    compatibility: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_COMPATIBILITY),
    upcastTreatment: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_UPCAST_TREATMENT),
    downcastTreatment: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DOWNCAST_TREATMENT),
    runtimeFallback: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_RUNTIME_FALLBACK),
    publicationAuthority: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_AUTHORITY),
    legacyTreatment: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_LEGACY_TREATMENT),
  })
  .strict();

function expectedShardCoordinates(includeClubUtility: boolean): Array<{
  view: ValuationView;
  measure: AflTradeValuationDistributionMeasure;
}> {
  const measures: readonly AflTradeValuationDistributionMeasure[] = includeClubUtility
    ? allMeasures
    : universalMeasures;
  return AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    measures.map((measure) => ({ view, measure }))
  );
}

function expectedComparisonCoordinates(): Array<{
  view: ValuationView;
  measure: AflTradeValuationComparisonMeasure;
}> {
  return AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    universalMeasures.map((measure) => ({
      view,
      measure: measure as AflTradeValuationComparisonMeasure,
    }))
  );
}

function outputSetPayload(content: {
  valuationCalculation: z.infer<typeof parentCalculationBindingSchema>;
  distributionShards: readonly z.infer<typeof rootShardBindingSchema>[];
  valuationComparisons: readonly z.infer<typeof rootComparisonBindingSchema>[];
  structuredExplanation: z.infer<typeof rootExplanationBindingSchema>;
}) {
  return {
    valuationCalculation: content.valuationCalculation,
    distributionShards: content.distributionShards,
    valuationComparisons: content.valuationComparisons,
    structuredExplanation: content.structuredExplanation,
  };
}

export const aflTradeValuationOutputInventoryContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY),
    inventoryContract: aflTradeValuationOutputInventoryContractSchema,
    bindingDirection: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_BINDING_DIRECTION),
    granularity: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_GRANULARITY),
    distributionPartitioning: z.literal(
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DISTRIBUTION_PARTITIONING
    ),
    semanticBinding: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SEMANTIC_BINDING),
    publicationRequirement: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_REQUIREMENT),
    valuationBundle: parentBundleBindingSchema,
    valuationCase: parentCaseBindingSchema,
    valuationCalculation: parentCalculationBindingSchema,
    lineageGraphId: aflTradeContentAddressedIdSchema('lineage-graph'),
    componentDrawSetId: aflTradeContentAddressedIdSchema('component-draw-set'),
    realizedContributionLedgerId: aflTradeContentAddressedIdSchema('realized-contribution-ledger'),
    packagePolicyId: aflTradeContentAddressedIdSchema('package-policy'),
    tradeId: aflTradePublicIdSchema,
    valueUnitId: aflTradePublicIdSchema,
    distributionCoverage: z
      .object({
        required: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_REQUIRED_DISTRIBUTION_COVERAGE),
        optionalClubUtility: z.literal(
          AFL_TRADE_VALUATION_OUTPUT_INVENTORY_OPTIONAL_CLUB_UTILITY_COVERAGE
        ),
      })
      .strict(),
    distributionCount: z
      .number()
      .int()
      .min(1)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_DISTRIBUTION_COUNT),
    distributionShardCount: z
      .number()
      .int()
      .min(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_REQUIRED_SHARD_COUNT)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_COUNT),
    distributionShardSetSha256: aflTradeSha256Schema,
    distributionShards: z
      .array(rootShardBindingSchema)
      .min(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_REQUIRED_SHARD_COUNT)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_COUNT),
    valuationComparisonCount: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT),
    valuationComparisonSetSha256: aflTradeSha256Schema,
    valuationComparisons: z
      .array(rootComparisonBindingSchema)
      .length(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT),
    structuredExplanation: rootExplanationBindingSchema,
    outputSetSha256: aflTradeSha256Schema,
    verificationScope: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_VERIFICATION_SCOPE),
    predecessorPolicy: aflTradeValuationOutputInventoryPredecessorPolicySchema,
    materializedAt: aflTradeIsoDateTimeSchema,
    limitation: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    const includeClubUtility = content.distributionShards.length === 16;
    if (content.distributionShards.length !== 12 && content.distributionShards.length !== 16) {
      context.addIssue({
        code: 'custom',
        path: ['distributionShards'],
        message: 'Inventory requires 12 universal shards and either zero or four utility shards.',
      });
    }
    const expectedShards = expectedShardCoordinates(includeClubUtility);
    if (
      expectedShards.length !== content.distributionShards.length ||
      content.distributionShards.some(
        (binding, index) =>
          coordinateKey(binding.coordinate) !== coordinateKey(expectedShards[index])
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['distributionShards'],
        message: 'Distribution shard bindings must use canonical view and measure order.',
      });
    }
    if (content.distributionShardCount !== content.distributionShards.length) {
      context.addIssue({
        code: 'custom',
        path: ['distributionShardCount'],
        message: 'Distribution shard count must match shard bindings.',
      });
    }
    const shardIds = content.distributionShards.map(
      (binding) => binding.valuationOutputInventoryShardId
    );
    const shardArtifactIds = content.distributionShards.map(
      (binding) => binding.artifactRef.artifactId
    );
    if (
      new Set(shardIds).size !== shardIds.length ||
      new Set(shardArtifactIds).size !== shardArtifactIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['distributionShards'],
        message: 'Distribution shard semantic and byte identities must be unique.',
      });
    }
    const distributionCount = content.distributionShards.reduce(
      (sum, binding) => sum + binding.distributionCount,
      0
    );
    if (content.distributionCount !== distributionCount) {
      context.addIssue({
        code: 'custom',
        path: ['distributionCount'],
        message: 'Distribution count must reconcile to all shard bindings.',
      });
    }
    if (
      sha256AflTradeCanonicalJson(content.distributionShards) !== content.distributionShardSetSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['distributionShardSetSha256'],
        message: 'Distribution shard digest must authenticate canonical shard bindings.',
      });
    }
    const expectedComparisons = expectedComparisonCoordinates();
    if (
      content.valuationComparisons.some(
        (binding, index) => coordinateKey(binding) !== coordinateKey(expectedComparisons[index])
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['valuationComparisons'],
        message: 'Comparison bindings must use canonical universal view and layer order.',
      });
    }
    if (
      sha256AflTradeCanonicalJson(content.valuationComparisons) !==
      content.valuationComparisonSetSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['valuationComparisonSetSha256'],
        message: 'Comparison digest must authenticate canonical comparison bindings.',
      });
    }
    const comparisonIds = content.valuationComparisons.map(
      (binding) => binding.valuationComparisonId
    );
    const comparisonArtifactIds = content.valuationComparisons.map(
      (binding) => binding.artifactRef.artifactId
    );
    if (
      new Set(comparisonIds).size !== comparisonIds.length ||
      new Set(comparisonArtifactIds).size !== comparisonArtifactIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['valuationComparisons'],
        message: 'Comparison semantic and byte identities must be unique.',
      });
    }
    if (sha256AflTradeCanonicalJson(outputSetPayload(content)) !== content.outputSetSha256) {
      context.addIssue({
        code: 'custom',
        path: ['outputSetSha256'],
        message: 'Output-set digest must authenticate all publication output roles.',
      });
    }
    const references = [
      content.inventoryContract.contractArtifact,
      content.valuationBundle.artifactRef,
      content.valuationCase.artifactRef,
      content.valuationCalculation.artifactRef,
      ...content.distributionShards.map((binding) => binding.artifactRef),
      ...content.valuationComparisons.map((binding) => binding.artifactRef),
      content.structuredExplanation.artifactRef,
    ];
    if (
      references.some(
        (reference) => Date.parse(reference.createdAt) > Date.parse(content.materializedAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materializedAt'],
        message: 'Inventory cannot predate any referenced immutable artifact.',
      });
    }
  });

export const aflTradeValuationOutputInventorySchema = z
  .object({
    valuationOutputInventoryId: aflTradeContentAddressedIdSchema('valuation-output-inventory'),
    content: aflTradeValuationOutputInventoryContentSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    addAflTradeContentAddressIssue(
      'valuation-output-inventory',
      artifact.valuationOutputInventoryId,
      artifact.content,
      context,
      ['valuationOutputInventoryId']
    );
  });

export type AflTradeValuationOutputInventoryContent = z.infer<
  typeof aflTradeValuationOutputInventoryContentSchema
>;
export type AflTradeValuationOutputInventory = z.infer<
  typeof aflTradeValuationOutputInventorySchema
>;

const outputShardSchema = z
  .object({
    shard: aflTradeValuationOutputInventoryShardSchema,
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!doesAflTradeArtifactRefMatchCanonicalJson(value.artifactRef, value.shard)) {
      context.addIssue({
        code: 'custom',
        path: ['artifactRef'],
        message: 'Shard artifact reference must authenticate the complete shard artifact.',
      });
    }
    if (
      value.artifactRef.createdAt !== value.shard.content.materializedAt ||
      value.artifactRef.byteLength > AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['artifactRef'],
        message: 'Shard byte metadata must match its materialization contract.',
      });
    }
  });

export const aflTradeValuationOutputInventoryResultSchema = z
  .object({
    distributionShards: z
      .array(outputShardSchema)
      .min(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_REQUIRED_SHARD_COUNT)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_COUNT),
    valuationOutputInventory: aflTradeValuationOutputInventorySchema,
    valuationOutputInventoryArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      !doesAflTradeArtifactRefMatchCanonicalJson(
        result.valuationOutputInventoryArtifactRef,
        result.valuationOutputInventory
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['valuationOutputInventoryArtifactRef'],
        message: 'Root artifact reference must authenticate the complete inventory artifact.',
      });
    }
    if (
      result.valuationOutputInventoryArtifactRef.createdAt !==
        result.valuationOutputInventory.content.materializedAt ||
      result.valuationOutputInventoryArtifactRef.byteLength >
        AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_ROOT_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['valuationOutputInventoryArtifactRef'],
        message: 'Root byte metadata must match its materialization contract.',
      });
    }
    const rootBindings = result.valuationOutputInventory.content.distributionShards;
    const root = result.valuationOutputInventory.content;
    const canonicalSubjects = result.distributionShards[0]?.shard.content.distributions.map(
      (binding) => binding.subject
    );
    if (
      canonicalSubjects === undefined ||
      canonicalSubjects.length < 4 ||
      result.distributionShards.some(
        (output) =>
          !sameCanonicalJson(
            output.shard.content.distributions.map((binding) => binding.subject),
            canonicalSubjects
          )
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['distributionShards'],
        message: 'Every shard must contain the same complete ordered subject lattice.',
      });
    }
    if (
      rootBindings.length !== result.distributionShards.length ||
      result.distributionShards.some((output, index) => {
        const binding = rootBindings[index];
        return (
          output.shard.valuationOutputInventoryShardId !==
            binding.valuationOutputInventoryShardId ||
          !sameCanonicalJson(output.artifactRef, binding.artifactRef) ||
          !sameCanonicalJson(output.shard.content.coordinate, binding.coordinate) ||
          output.shard.content.distributionCount !== binding.distributionCount ||
          output.shard.content.distributionSetSha256 !== binding.distributionSetSha256 ||
          output.shard.content.valuationBundleId !== root.valuationBundle.valuationBundleId ||
          output.shard.content.valuationCaseId !== root.valuationCase.valuationCaseId ||
          output.shard.content.valuationCalculationId !==
            root.valuationCalculation.valuationCalculationId ||
          output.shard.content.lineageGraphId !== root.lineageGraphId ||
          output.shard.content.componentDrawSetId !== root.componentDrawSetId ||
          output.shard.content.realizedContributionLedgerId !== root.realizedContributionLedgerId ||
          output.shard.content.packagePolicyId !== root.packagePolicyId ||
          output.shard.content.tradeId !== root.tradeId ||
          output.shard.content.valueUnitId !== root.valueUnitId ||
          output.shard.content.materializedAt !== root.materializedAt
        );
      })
    ) {
      context.addIssue({
        code: 'custom',
        path: ['distributionShards'],
        message: 'Returned shard artifacts must exactly match canonical root bindings.',
      });
    }
  });

export type AflTradeValuationOutputInventoryResult = z.infer<
  typeof aflTradeValuationOutputInventoryResultSchema
>;

export const aflTradeValuationOutputInventoryVerifyInputSchema = z
  .object({
    valuationBundle: aflTradeValuationOutputInventoryBundleInputSchema,
    valuationCase: aflTradeValuationOutputInventoryCaseInputSchema,
    valuationCalculation: aflTradeValuationOutputInventoryCalculationInputSchema,
    valuationDistributions: z
      .array(aflTradeValuationOutputInventoryDistributionInputSchema)
      .min(1)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_DISTRIBUTION_COUNT),
    valuationComparisons: z
      .array(aflTradeValuationOutputInventoryComparisonInputSchema)
      .length(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT),
    structuredExplanation: aflTradeValuationOutputInventoryExplanationInputSchema,
    materializedAt: aflTradeIsoDateTimeSchema,
    output: aflTradeValuationOutputInventoryResultSchema,
  })
  .strict();

export type AflTradeValuationOutputInventoryVerifyInput = z.infer<
  typeof aflTradeValuationOutputInventoryVerifyInputSchema
>;

export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_CONSTRUCTION_ERROR_CODES = [
  'INVALID_INPUT_ENVELOPE',
  'INVALID_MATERIALIZED_AT',
  'INVALID_VALUATION_BUNDLE_BINDING',
  'INVALID_VALUATION_CASE_BINDING',
  'INVALID_VALUATION_CALCULATION_BINDING',
  'INVALID_VALUATION_DISTRIBUTION_BINDINGS',
  'INVALID_VALUATION_COMPARISON_BINDINGS',
  'INVALID_STRUCTURED_EXPLANATION_BINDING',
  'ARTIFACT_REFERENCE_MISMATCH',
  'INVENTORY_CONTRACT_MISMATCH',
  'PUBLIC_ASSET_BOUNDARY_MISMATCH',
  'PARENT_LINEAGE_MISMATCH',
  'INCOMPLETE_UNIVERSAL_DISTRIBUTION_LATTICE',
  'INCOMPLETE_OPTIONAL_CLUB_UTILITY_LATTICE',
  'INCOMPLETE_COMPARISON_LATTICE',
  'DISTRIBUTION_REPLAY_FAILURE',
  'COMPARISON_REPLAY_FAILURE',
  'STRUCTURED_EXPLANATION_REPLAY_FAILURE',
  'SHARD_SIZE_LIMIT_EXCEEDED',
  'ROOT_INVENTORY_SIZE_LIMIT_EXCEEDED',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const;

export type AflTradeValuationOutputInventoryConstructionErrorCode =
  (typeof AFL_TRADE_VALUATION_OUTPUT_INVENTORY_CONSTRUCTION_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<
  Record<AflTradeValuationOutputInventoryConstructionErrorCode, string>
> = Object.freeze({
  INVALID_INPUT_ENVELOPE: 'The valuation-output-inventory input envelope is invalid.',
  INVALID_MATERIALIZED_AT: 'The inventory materialization time is invalid.',
  INVALID_VALUATION_BUNDLE_BINDING: 'The valuation-bundle binding is invalid.',
  INVALID_VALUATION_CASE_BINDING: 'The valuation-case binding is invalid.',
  INVALID_VALUATION_CALCULATION_BINDING: 'The valuation-calculation binding is invalid.',
  INVALID_VALUATION_DISTRIBUTION_BINDINGS: 'The valuation-distribution bindings are invalid.',
  INVALID_VALUATION_COMPARISON_BINDINGS: 'The valuation-comparison bindings are invalid.',
  INVALID_STRUCTURED_EXPLANATION_BINDING: 'The structured-explanation binding is invalid.',
  ARTIFACT_REFERENCE_MISMATCH:
    'An immutable artifact reference does not authenticate its bound artifact or chronology.',
  INVENTORY_CONTRACT_MISMATCH: 'The bundle does not govern the required detached inventory.',
  PUBLIC_ASSET_BOUNDARY_MISMATCH: 'The inventory inputs cross the public AFL asset boundary.',
  PARENT_LINEAGE_MISMATCH: 'The inventory inputs do not share one complete parent lineage.',
  INCOMPLETE_UNIVERSAL_DISTRIBUTION_LATTICE:
    'The required universal distribution lattice is incomplete or contains extra coordinates.',
  INCOMPLETE_OPTIONAL_CLUB_UTILITY_LATTICE:
    'Optional club-utility distributions must be absent or form one complete four-view lattice.',
  INCOMPLETE_COMPARISON_LATTICE:
    'The universal comparison lattice is incomplete or contains extra coordinates.',
  DISTRIBUTION_REPLAY_FAILURE: 'A distribution failed scoped case-and-calculation replay.',
  COMPARISON_REPLAY_FAILURE: 'A comparison failed scoped case-and-calculation replay.',
  STRUCTURED_EXPLANATION_REPLAY_FAILURE:
    'The structured explanation failed scoped successor-artifact replay.',
  SHARD_SIZE_LIMIT_EXCEEDED: 'A canonical distribution inventory shard exceeds its byte limit.',
  ROOT_INVENTORY_SIZE_LIMIT_EXCEEDED: 'The canonical root inventory exceeds its byte limit.',
  INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
    'The valuation output inventory failed its internal artifact contract.',
});

const TRUSTED_ERRORS = new WeakSet<object>();

export class AflTradeValuationOutputInventoryConstructionError extends Error {
  readonly code: AflTradeValuationOutputInventoryConstructionErrorCode;

  constructor(code: AflTradeValuationOutputInventoryConstructionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AflTradeValuationOutputInventoryConstructionError';
    this.code = code;
    TRUSTED_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeValuationOutputInventoryConstructionError';
    code: AflTradeValuationOutputInventoryConstructionErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeValuationOutputInventoryConstructionError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeValuationOutputInventoryConstructionError(
  value: unknown
): value is AflTradeValuationOutputInventoryConstructionError {
  return value !== null && typeof value === 'object' && TRUSTED_ERRORS.has(value);
}

function constructionError(
  code: AflTradeValuationOutputInventoryConstructionErrorCode
): AflTradeValuationOutputInventoryConstructionError {
  return new AflTradeValuationOutputInventoryConstructionError(code);
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeValuationOutputInventoryConstructionErrorCode
): T {
  try {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    // Hostile inputs are replaced with stable public construction errors.
  }
  throw constructionError(code);
}

const CREATE_INPUT_KEYS = [
  'valuationBundle',
  'valuationCase',
  'valuationCalculation',
  'valuationDistributions',
  'valuationComparisons',
  'structuredExplanation',
  'materializedAt',
] as const;
type CreateInputKey = (typeof CREATE_INPUT_KEYS)[number];
type CreateInputSnapshot = Record<CreateInputKey, unknown>;
const CREATE_INPUT_KEY_SET = new Set<string>(CREATE_INPUT_KEYS);

function snapshotExactEnvelope(value: unknown): CreateInputSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== CREATE_INPUT_KEYS.length ||
      keys.some((key) => typeof key !== 'string' || !CREATE_INPUT_KEY_SET.has(key))
    ) {
      return null;
    }
    const snapshot = {} as CreateInputSnapshot;
    for (const key of CREATE_INPUT_KEYS) snapshot[key] = Reflect.get(value, key, value);
    return snapshot;
  } catch {
    return null;
  }
}

function expectedSubjects(
  valuationCase: AflTradeValuationCase
): AflTradeValuationDistributionSubject[] {
  return valuationCase.content.parties.flatMap((party) => [
    { kind: 'afl_club_received_package' as const, aflClubId: party.aflClubId },
    ...party.receivedRootAssetIds.map((rootAssetId) => ({
      kind: 'source_native_afl_trade_root' as const,
      aflClubId: party.aflClubId,
      rootAssetId,
    })),
  ]);
}

function canonicalizeDistributions(
  valuationCase: AflTradeValuationCase,
  distributions: readonly AflTradeValuationDistribution[]
): { canonical: AflTradeValuationDistribution[]; includeClubUtility: boolean } {
  const subjects = expectedSubjects(valuationCase);
  const hasClubUtility = distributions.some(
    (artifact) => artifact.content.measure.kind === 'single_afl_club_utility'
  );
  const expectedUniversal = AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    universalMeasures.flatMap((measure) => subjects.map((subject) => ({ view, measure, subject })))
  );
  const expectedUtility = AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    subjects.map((subject) => ({ view, measure: clubUtilityMeasure, subject }))
  );
  const expected = hasClubUtility ? [...expectedUniversal, ...expectedUtility] : expectedUniversal;
  const expectedCanonical = expectedShardCoordinates(hasClubUtility).flatMap((coordinate) =>
    subjects.map((subject) => ({ ...coordinate, subject }))
  );

  if (distributions.length !== expected.length) {
    throw constructionError(
      hasClubUtility
        ? 'INCOMPLETE_OPTIONAL_CLUB_UTILITY_LATTICE'
        : 'INCOMPLETE_UNIVERSAL_DISTRIBUTION_LATTICE'
    );
  }
  const byCoordinate = new Map<string, AflTradeValuationDistribution>();
  for (const artifact of distributions) {
    const key = coordinateKey({
      view: artifact.content.viewContext.view,
      measure: artifact.content.measure,
      subject: artifact.content.subject,
    });
    if (byCoordinate.has(key)) {
      throw constructionError(
        artifact.content.measure.kind === 'single_afl_club_utility'
          ? 'INCOMPLETE_OPTIONAL_CLUB_UTILITY_LATTICE'
          : 'INCOMPLETE_UNIVERSAL_DISTRIBUTION_LATTICE'
      );
    }
    byCoordinate.set(key, artifact);
  }
  const canonical = expectedCanonical.map((coordinate) => {
    const artifact = byCoordinate.get(coordinateKey(coordinate));
    if (!artifact) {
      throw constructionError(
        coordinate.measure.kind === 'single_afl_club_utility'
          ? 'INCOMPLETE_OPTIONAL_CLUB_UTILITY_LATTICE'
          : 'INCOMPLETE_UNIVERSAL_DISTRIBUTION_LATTICE'
      );
    }
    return artifact;
  });
  return { canonical, includeClubUtility: hasClubUtility };
}

function canonicalizeComparisons(
  comparisons: readonly AflTradeValuationComparison[]
): AflTradeValuationComparison[] {
  const expected = expectedComparisonCoordinates();
  if (comparisons.length !== expected.length) {
    throw constructionError('INCOMPLETE_COMPARISON_LATTICE');
  }
  const byCoordinate = new Map<string, AflTradeValuationComparison>();
  for (const artifact of comparisons) {
    const key = coordinateKey({
      view: artifact.content.viewContext.view,
      measure: artifact.content.measure,
    });
    if (byCoordinate.has(key)) throw constructionError('INCOMPLETE_COMPARISON_LATTICE');
    byCoordinate.set(key, artifact);
  }
  return expected.map((coordinate) => {
    const artifact = byCoordinate.get(coordinateKey(coordinate));
    if (!artifact) throw constructionError('INCOMPLETE_COMPARISON_LATTICE');
    return artifact;
  });
}

function assertArtifactReference(
  reference: AflTradeArtifactRef,
  artifact: unknown,
  materializedAt: string
): void {
  if (
    !doesAflTradeArtifactRefMatchCanonicalJson(reference, artifact) ||
    Date.parse(reference.createdAt) > Date.parse(materializedAt)
  ) {
    throw constructionError('ARTIFACT_REFERENCE_MISMATCH');
  }
}

function assertContract(bundle: AflTradeValuationBundleManifestV2): void {
  const contract = bundle.content.outputInventoryContract;
  if (
    contract.inventorySchemaVersion !== AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION ||
    contract.bindingDirection !== AFL_TRADE_VALUATION_OUTPUT_INVENTORY_BINDING_DIRECTION ||
    contract.granularity !== AFL_TRADE_VALUATION_OUTPUT_INVENTORY_GRANULARITY ||
    contract.distributionPartitioning !==
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DISTRIBUTION_PARTITIONING ||
    contract.semanticBinding !== AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SEMANTIC_BINDING ||
    contract.publicationRequirement !== AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_REQUIREMENT
  ) {
    throw constructionError('INVENTORY_CONTRACT_MISMATCH');
  }
}

function assertLineage(
  bundle: AflTradeValuationBundleManifestV2,
  valuationCase: AflTradeValuationCase,
  calculation: AflTradeValuationCalculation,
  distributions: readonly AflTradeValuationDistribution[],
  comparisons: readonly AflTradeValuationComparison[],
  explanation: AflTradeStructuredExplanationV2
): void {
  if (
    bundle.content.publicAssetBoundary !==
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY ||
    valuationCase.content.publicAssetBoundary !==
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY ||
    calculation.content.publicAssetBoundary !==
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY ||
    explanation.content.publicAssetBoundary !==
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY ||
    distributions.some(
      (artifact) =>
        artifact.content.publicAssetBoundary !==
        AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY
    ) ||
    comparisons.some(
      (artifact) =>
        artifact.content.publicAssetBoundary !==
        AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY
    )
  ) {
    throw constructionError('PUBLIC_ASSET_BOUNDARY_MISMATCH');
  }

  const common = {
    valuationBundleId: bundle.valuationBundleId,
    valuationCaseId: valuationCase.valuationCaseId,
    valuationCalculationId: calculation.valuationCalculationId,
    lineageGraphId: valuationCase.content.lineageGraphId,
    componentDrawSetId: valuationCase.content.componentDrawSetId,
    realizedContributionLedgerId: valuationCase.content.realizedContributionLedgerId,
    packagePolicyId: valuationCase.content.packagePolicyId,
    tradeId: valuationCase.content.tradeId,
    valueUnitId: valuationCase.content.valueUnitId,
  };
  const matchesCommon = (content: typeof common): boolean =>
    Object.entries(common).every(([key, value]) => content[key as keyof typeof common] === value);

  if (
    valuationCase.content.valuationBundleId !== common.valuationBundleId ||
    calculation.content.valuationBundleId !== common.valuationBundleId ||
    calculation.content.valuationCaseId !== common.valuationCaseId ||
    calculation.content.componentDrawSetId !== common.componentDrawSetId ||
    calculation.content.realizedContributionLedgerId !== common.realizedContributionLedgerId ||
    calculation.content.packagePolicyId !== common.packagePolicyId ||
    calculation.content.valueUnitId !== common.valueUnitId ||
    bundle.content.valueUnitId !== common.valueUnitId ||
    !sameCanonicalJson(bundle.content.viewContexts, valuationCase.content.viewContexts) ||
    distributions.some((artifact) => !matchesCommon(artifact.content)) ||
    comparisons.some((artifact) => !matchesCommon(artifact.content)) ||
    !matchesCommon(explanation.content)
  ) {
    throw constructionError('PARENT_LINEAGE_MISMATCH');
  }
}

function assertReplay(
  valuationCase: AflTradeValuationCase,
  calculation: AflTradeValuationCalculation,
  distributions: readonly AflTradeValuationDistribution[],
  comparisons: readonly AflTradeValuationComparison[],
  bundle: AflTradeValuationBundleManifestV2,
  explanation: AflTradeStructuredExplanationV2
): void {
  for (const distribution of distributions) {
    if (
      !verifyAflTradeValuationDistributionCaseCalculationDerivation({
        valuationDistribution: distribution,
        valuationCase,
        valuationCalculation: calculation,
      })
    ) {
      throw constructionError('DISTRIBUTION_REPLAY_FAILURE');
    }
  }
  for (const comparison of comparisons) {
    if (
      !verifyAflTradeValuationComparisonCaseCalculationDerivation({
        valuationComparison: comparison,
        valuationCase,
        valuationCalculation: calculation,
      })
    ) {
      throw constructionError('COMPARISON_REPLAY_FAILURE');
    }
  }
  const universalDistributions = distributions.filter(
    (artifact) => artifact.content.measure.kind === 'universal_football_value'
  );
  if (
    !verifyAflTradeStructuredExplanationV2Derivation({
      structuredExplanation: explanation,
      valuationBundleManifest: bundle,
      valuationCase,
      valuationCalculation: calculation,
      valuationDistributions: universalDistributions,
      valuationComparisons: comparisons,
    })
  ) {
    throw constructionError('STRUCTURED_EXPLANATION_REPLAY_FAILURE');
  }
}

function makeShard(
  common: {
    bundle: AflTradeValuationBundleManifestV2;
    valuationCase: AflTradeValuationCase;
    calculation: AflTradeValuationCalculation;
    materializedAt: string;
  },
  coordinate: { view: ValuationView; measure: AflTradeValuationDistributionMeasure },
  distributions: readonly AflTradeValuationDistribution[],
  referencesById: ReadonlyMap<string, AflTradeArtifactRef>
): z.infer<typeof outputShardSchema> {
  const bindings = distributions.map((artifact) => ({
    subject: artifact.content.subject,
    valuationDistributionId: artifact.valuationDistributionId,
    artifactRef: referencesById.get(artifact.valuationDistributionId)!,
  }));
  const content = {
    schemaVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SHARD_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY,
    valuationBundleId: common.bundle.valuationBundleId,
    valuationCaseId: common.valuationCase.valuationCaseId,
    valuationCalculationId: common.calculation.valuationCalculationId,
    lineageGraphId: common.valuationCase.content.lineageGraphId,
    componentDrawSetId: common.valuationCase.content.componentDrawSetId,
    realizedContributionLedgerId: common.valuationCase.content.realizedContributionLedgerId,
    packagePolicyId: common.valuationCase.content.packagePolicyId,
    tradeId: common.valuationCase.content.tradeId,
    valueUnitId: common.valuationCase.content.valueUnitId,
    coordinate,
    semanticBinding: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SEMANTIC_BINDING,
    orderingDefinition: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_ORDERING_DEFINITION,
    verificationScope: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SHARD_VERIFICATION_SCOPE,
    distributionCount: bindings.length,
    distributionSetSha256: sha256AflTradeCanonicalJson(bindings),
    distributions: bindings,
    materializedAt: common.materializedAt,
    limitation: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SHARD_LIMITATION,
  };
  const parsedShard = aflTradeValuationOutputInventoryShardSchema.safeParse({
    valuationOutputInventoryShardId: createAflTradeContentAddress(
      'valuation-output-inventory-shard',
      content
    ),
    content,
  });
  if (!parsedShard.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  const artifactRef = createAflTradeCanonicalJsonArtifactRef(
    parsedShard.data,
    common.materializedAt
  );
  if (artifactRef.byteLength > AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_BYTES) {
    throw constructionError('SHARD_SIZE_LIMIT_EXCEEDED');
  }
  return { shard: parsedShard.data, artifactRef };
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

export function createAflTradeValuationOutputInventory(
  unparsedInput: unknown
): AflTradeValuationOutputInventoryResult {
  try {
    const snapshot = snapshotExactEnvelope(unparsedInput);
    if (snapshot === null) throw constructionError('INVALID_INPUT_ENVELOPE');
    const materializedAt = parseOrThrow(
      aflTradeIsoDateTimeSchema,
      snapshot.materializedAt,
      'INVALID_MATERIALIZED_AT'
    );
    const bundleBinding = parseOrThrow(
      aflTradeValuationOutputInventoryBundleInputSchema,
      snapshot.valuationBundle,
      'INVALID_VALUATION_BUNDLE_BINDING'
    );
    const caseBinding = parseOrThrow(
      aflTradeValuationOutputInventoryCaseInputSchema,
      snapshot.valuationCase,
      'INVALID_VALUATION_CASE_BINDING'
    );
    const calculationBinding = parseOrThrow(
      aflTradeValuationOutputInventoryCalculationInputSchema,
      snapshot.valuationCalculation,
      'INVALID_VALUATION_CALCULATION_BINDING'
    );
    const distributionBindings = parseOrThrow(
      z
        .array(aflTradeValuationOutputInventoryDistributionInputSchema)
        .min(1)
        .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_DISTRIBUTION_COUNT),
      snapshot.valuationDistributions,
      'INVALID_VALUATION_DISTRIBUTION_BINDINGS'
    );
    const comparisonBindings = parseOrThrow(
      z
        .array(aflTradeValuationOutputInventoryComparisonInputSchema)
        .length(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT),
      snapshot.valuationComparisons,
      'INVALID_VALUATION_COMPARISON_BINDINGS'
    );
    const explanationBinding = parseOrThrow(
      aflTradeValuationOutputInventoryExplanationInputSchema,
      snapshot.structuredExplanation,
      'INVALID_STRUCTURED_EXPLANATION_BINDING'
    );

    assertArtifactReference(
      bundleBinding.artifactRef,
      bundleBinding.valuationBundleManifest,
      materializedAt
    );
    assertArtifactReference(caseBinding.artifactRef, caseBinding.valuationCase, materializedAt);
    assertArtifactReference(
      calculationBinding.artifactRef,
      calculationBinding.valuationCalculation,
      materializedAt
    );
    distributionBindings.forEach((binding) =>
      assertArtifactReference(binding.artifactRef, binding.valuationDistribution, materializedAt)
    );
    comparisonBindings.forEach((binding) =>
      assertArtifactReference(binding.artifactRef, binding.valuationComparison, materializedAt)
    );
    assertArtifactReference(
      explanationBinding.artifactRef,
      explanationBinding.structuredExplanation,
      materializedAt
    );
    if (
      Date.parse(
        bundleBinding.valuationBundleManifest.content.outputInventoryContract.contractArtifact
          .createdAt
      ) > Date.parse(materializedAt)
    ) {
      throw constructionError('ARTIFACT_REFERENCE_MISMATCH');
    }

    const bundle = bundleBinding.valuationBundleManifest;
    const valuationCase = caseBinding.valuationCase;
    const calculation = calculationBinding.valuationCalculation;
    const distributions = distributionBindings.map((binding) => binding.valuationDistribution);
    const comparisons = comparisonBindings.map((binding) => binding.valuationComparison);
    const explanation = explanationBinding.structuredExplanation;
    if (
      Date.parse(bundleBinding.artifactRef.createdAt) < Date.parse(bundle.content.createdAt) ||
      Date.parse(materializedAt) < Date.parse(bundle.content.createdAt)
    ) {
      throw constructionError('ARTIFACT_REFERENCE_MISMATCH');
    }
    assertContract(bundle);
    const canonicalDistributionResult = canonicalizeDistributions(valuationCase, distributions);
    const canonicalComparisons = canonicalizeComparisons(comparisons);
    assertLineage(
      bundle,
      valuationCase,
      calculation,
      canonicalDistributionResult.canonical,
      canonicalComparisons,
      explanation
    );
    assertReplay(
      valuationCase,
      calculation,
      canonicalDistributionResult.canonical,
      canonicalComparisons,
      bundle,
      explanation
    );

    const distributionReferences = new Map(
      distributionBindings.map((binding) => [
        binding.valuationDistribution.valuationDistributionId,
        binding.artifactRef,
      ])
    );
    const comparisonReferences = new Map(
      comparisonBindings.map((binding) => [
        binding.valuationComparison.valuationComparisonId,
        binding.artifactRef,
      ])
    );
    const distributionShards = expectedShardCoordinates(
      canonicalDistributionResult.includeClubUtility
    ).map((coordinate) =>
      makeShard(
        { bundle, valuationCase, calculation, materializedAt },
        coordinate,
        canonicalDistributionResult.canonical.filter(
          (artifact) =>
            artifact.content.viewContext.view === coordinate.view &&
            sameCanonicalJson(artifact.content.measure, coordinate.measure)
        ),
        distributionReferences
      )
    );
    const rootShardBindings = distributionShards.map(({ shard, artifactRef }) => ({
      valuationOutputInventoryShardId: shard.valuationOutputInventoryShardId,
      artifactRef,
      coordinate: shard.content.coordinate,
      distributionCount: shard.content.distributionCount,
      distributionSetSha256: shard.content.distributionSetSha256,
    }));
    const rootComparisonBindings = canonicalComparisons.map((artifact) => ({
      view: artifact.content.viewContext.view,
      measure: artifact.content.measure,
      valuationComparisonId: artifact.valuationComparisonId,
      artifactRef: comparisonReferences.get(artifact.valuationComparisonId)!,
    }));
    const rootExplanationBinding = {
      structuredExplanationId: explanation.structuredExplanationId,
      artifactRef: explanationBinding.artifactRef,
    };
    const rootCalculationBinding = {
      valuationCalculationId: calculation.valuationCalculationId,
      artifactRef: calculationBinding.artifactRef,
    };
    const content = {
      schemaVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY,
      inventoryContract: bundle.content.outputInventoryContract,
      bindingDirection: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_BINDING_DIRECTION,
      granularity: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_GRANULARITY,
      distributionPartitioning: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DISTRIBUTION_PARTITIONING,
      semanticBinding: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SEMANTIC_BINDING,
      publicationRequirement: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_REQUIREMENT,
      valuationBundle: {
        valuationBundleId: bundle.valuationBundleId,
        artifactRef: bundleBinding.artifactRef,
      },
      valuationCase: {
        valuationCaseId: valuationCase.valuationCaseId,
        artifactRef: caseBinding.artifactRef,
      },
      valuationCalculation: rootCalculationBinding,
      lineageGraphId: valuationCase.content.lineageGraphId,
      componentDrawSetId: valuationCase.content.componentDrawSetId,
      realizedContributionLedgerId: valuationCase.content.realizedContributionLedgerId,
      packagePolicyId: valuationCase.content.packagePolicyId,
      tradeId: valuationCase.content.tradeId,
      valueUnitId: valuationCase.content.valueUnitId,
      distributionCoverage: {
        required: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_REQUIRED_DISTRIBUTION_COVERAGE,
        optionalClubUtility: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_OPTIONAL_CLUB_UTILITY_COVERAGE,
      },
      distributionCount: canonicalDistributionResult.canonical.length,
      distributionShardCount: rootShardBindings.length,
      distributionShardSetSha256: sha256AflTradeCanonicalJson(rootShardBindings),
      distributionShards: rootShardBindings,
      valuationComparisonCount: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT,
      valuationComparisonSetSha256: sha256AflTradeCanonicalJson(rootComparisonBindings),
      valuationComparisons: rootComparisonBindings,
      structuredExplanation: rootExplanationBinding,
      outputSetSha256: sha256AflTradeCanonicalJson(
        outputSetPayload({
          valuationCalculation: rootCalculationBinding,
          distributionShards: rootShardBindings,
          valuationComparisons: rootComparisonBindings,
          structuredExplanation: rootExplanationBinding,
        })
      ),
      verificationScope: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_VERIFICATION_SCOPE,
      predecessorPolicy: {
        definitionVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_POLICY_DEFINITION,
        valuationBundlePredecessorSchemaVersion: 'afl-trade-valuation-bundle/v1',
        valuationSnapshotSetSchemaVersion: 'afl-trade-valuation-snapshot-set/v1',
        structuredExplanationSchemaVersion: 'afl-trade-structured-explanation/v1',
        compatibility: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_COMPATIBILITY,
        upcastTreatment: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_UPCAST_TREATMENT,
        downcastTreatment: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DOWNCAST_TREATMENT,
        runtimeFallback: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_RUNTIME_FALLBACK,
        publicationAuthority: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_AUTHORITY,
        legacyTreatment: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_LEGACY_TREATMENT,
      },
      materializedAt,
      limitation: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_LIMITATION,
    };
    const parsedInventory = aflTradeValuationOutputInventorySchema.safeParse({
      valuationOutputInventoryId: createAflTradeContentAddress(
        'valuation-output-inventory',
        content
      ),
      content,
    });
    if (!parsedInventory.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    const valuationOutputInventoryArtifactRef = createAflTradeCanonicalJsonArtifactRef(
      parsedInventory.data,
      materializedAt
    );
    if (
      valuationOutputInventoryArtifactRef.byteLength >
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_ROOT_BYTES
    ) {
      throw constructionError('ROOT_INVENTORY_SIZE_LIMIT_EXCEEDED');
    }
    const parsedResult = aflTradeValuationOutputInventoryResultSchema.safeParse({
      distributionShards,
      valuationOutputInventory: parsedInventory.data,
      valuationOutputInventoryArtifactRef,
    });
    if (!parsedResult.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    return deepFreeze(parsedResult.data);
  } catch (error) {
    if (isAflTradeValuationOutputInventoryConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

const VERIFY_INPUT_KEYS = [...CREATE_INPUT_KEYS, 'output'] as const;
type VerifyInputKey = (typeof VERIFY_INPUT_KEYS)[number];
type VerifyInputSnapshot = Record<VerifyInputKey, unknown>;
const VERIFY_INPUT_KEY_SET = new Set<string>(VERIFY_INPUT_KEYS);

function snapshotVerifyEnvelope(value: unknown): VerifyInputSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== VERIFY_INPUT_KEYS.length ||
      keys.some((key) => typeof key !== 'string' || !VERIFY_INPUT_KEY_SET.has(key))
    ) {
      return null;
    }
    const snapshot = {} as VerifyInputSnapshot;
    for (const key of VERIFY_INPUT_KEYS) snapshot[key] = Reflect.get(value, key, value);
    return snapshot;
  } catch {
    return null;
  }
}

export function verifyAflTradeValuationOutputInventoryDerivation(input: unknown): boolean {
  try {
    const snapshot = snapshotVerifyEnvelope(input);
    if (snapshot === null) return false;
    const output = aflTradeValuationOutputInventoryResultSchema.safeParse(snapshot.output);
    if (!output.success) return false;
    const replayed = createAflTradeValuationOutputInventory({
      valuationBundle: snapshot.valuationBundle,
      valuationCase: snapshot.valuationCase,
      valuationCalculation: snapshot.valuationCalculation,
      valuationDistributions: snapshot.valuationDistributions,
      valuationComparisons: snapshot.valuationComparisons,
      structuredExplanation: snapshot.structuredExplanation,
      materializedAt: snapshot.materializedAt,
    });
    return canonicalizeAflTradeJson(replayed) === canonicalizeAflTradeJson(output.data);
  } catch {
    return false;
  }
}
