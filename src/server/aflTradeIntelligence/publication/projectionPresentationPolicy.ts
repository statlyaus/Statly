import { z } from 'zod';

import {
  AFL_TRADE_CONFIDENCE_DIMENSIONS,
  AFL_TRADE_METHODOLOGY_HREF,
  AFL_TRADE_VALUATION_VIEWS,
  aflTradeAssessmentSchema,
  aflTradeIsoDateTimeSchema,
  aflTradePublicHrefSchema,
  aflTradeUncertaintyComponentSchema,
  aflTradeValueFactorSchema,
  aflTradeValueUnavailableSchema,
  aflTradeValuationViewSchema,
  aflTradeValueUnitSchema,
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
import {
  aflTradeJointOutcomeProbabilitiesSchema,
  type AflTradeJointOutcomeProbabilities,
} from '../valuation/jointOutcomeComparison';
import { compareAflTradeCodeUnits } from '../valuation/deterministicProbabilityMeasure';
import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION,
} from '../valuation/structuralWeightedDistributionContracts';
import {
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
  aflTradeProjectionPublicEvidenceFactorSchema,
  aflTradeProjectionPublicEvidenceResultSchema,
} from './projectionPublicEvidence';
import {
  aflTradeProjectionEvidenceSourceVerificationResultSchema,
  aflTradeProjectionEvidenceSourceVerificationVerifyInputSchema,
  verifyAflTradeProjectionEvidenceSourceVerification,
} from './projectionEvidenceSourceVerification';

export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_SCHEMA_VERSION =
  'afl-trade-projection-presentation-policy/v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PUBLIC_ASSET_BOUNDARY =
  'source_native_afl_assets_no_user_or_fantasy_ownership' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_ASSESSMENT_DEFINITION =
  'practical_equivalence_or_leader_margin_balanced_then_strong_margin_else_lean_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_NUMERICAL_PUBLICATION =
  'complete_governed_inputs_only_no_conditional_or_partial_point_estimates_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PARTIAL_TREATMENT =
  'fail_closed_to_non_value_bearing_result_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_UNAVAILABLE_TREATMENT =
  'fail_closed_to_non_value_bearing_result_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_COMPARISON_BASIS = 'complete_trade' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FIRST_FAILURE_PRECEDENCE =
  'first_false_required_predicate_in_canonical_required_predicate_order_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_EVIDENCE =
  'verified_projection_public_evidence_with_direct_semantic_polarity_only_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MISSING_FACTOR_EVIDENCE =
  'emit_empty_factor_array_without_inference_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_ORDERING =
  'kind_then_code_then_label_then_explanation_code_unit_order_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_DEDUPLICATION =
  'identical_canonical_factor_once_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_SCOPE = 'view_global_context' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_DTO_SEMANTICS =
  'per_subject_factor_arrays_without_view_global_context_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_REPETITION = 'prohibited' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PER_CLUB_FACTOR_TREATMENT =
  'emit_empty' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PER_ASSET_FACTOR_TREATMENT =
  'emit_empty' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_UNCERTAINTY_COMPONENT_DEFINITION =
  'complete_distribution_outcome_plus_canonical_confidence_dimensions_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_UNCERTAINTY_COMPONENT_ORDERING =
  'outcome_then_canonical_confidence_dimension_order_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_WARNING_REASON_MAPPING =
  'fixed_verified_input_codes_no_runtime_invention_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PREDECESSOR_COMPATIBILITY =
  'no_predecessor_no_implicit_conversion_v1' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_RUNTIME_FALLBACK = 'prohibited' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_LIMITATION =
  'Immutable source-independent presentation policy only; it does not establish empirical threshold validity, model calibration, source approval, Gate approval, publication approval, activation authority, or user or fantasy ownership.' as const;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_BYTES = 64 * 1024;
export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_FACTORS = 20;

export const AFL_TRADE_PROJECTION_PRESENTATION_UNIVERSAL_LAYERS = [
  'gross',
  'list_spot_adjusted',
  'scarcity_adjusted',
] as const;

export const AFL_TRADE_PROJECTION_PRESENTATION_DISTRIBUTION_SUBJECT_KINDS = [
  'afl_club_received_package',
  'source_native_afl_trade_root',
] as const;

export const AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES = Object.freeze([
  Object.freeze({
    predicate: 'asset_coverage_complete_every_view' as const,
    failureCause: 'asset_coverage_not_complete' as const,
  }),
  Object.freeze({
    predicate: 'confidence_evidence_approved_every_view' as const,
    failureCause: 'confidence_evidence_not_approved' as const,
  }),
  Object.freeze({
    predicate: 'identity_evidence_resolved_every_view' as const,
    failureCause: 'identity_evidence_unresolved' as const,
  }),
  Object.freeze({
    predicate: 'lineage_attribution_resolved_every_view' as const,
    failureCause: 'lineage_evidence_unresolved' as const,
  }),
  Object.freeze({
    predicate: 'package_distribution_complete_every_view' as const,
    failureCause: 'package_distribution_not_complete' as const,
  }),
  Object.freeze({
    predicate: 'root_distribution_complete_every_view' as const,
    failureCause: 'root_distribution_not_complete' as const,
  }),
  Object.freeze({
    predicate: 'selected_comparison_available_every_view' as const,
    failureCause: 'selected_comparison_not_available' as const,
  }),
] as const);

export const AFL_TRADE_PROJECTION_PRESENTATION_FAIL_CLOSED_CAUSES = [
  'asset_coverage_not_complete',
  'confidence_evidence_not_approved',
  'identity_evidence_unresolved',
  'lineage_evidence_unresolved',
  'package_distribution_not_complete',
  'root_distribution_not_complete',
  'selected_comparison_not_available',
] as const;

const FAIL_CLOSED_MAPPING = Object.freeze({
  asset_coverage_not_complete: Object.freeze({
    availability: 'insufficient_data' as const,
    reasonCode: 'asset-coverage-incomplete',
    message:
      'This valuation is unavailable because complete traded-asset coverage is not verified.',
    nextAction: 'collect_more_evidence' as const,
    nextActionLabel: 'Review methodology and coverage limits',
    warningCode: 'asset-coverage-incomplete',
  }),
  confidence_evidence_not_approved: Object.freeze({
    availability: 'model_not_approved' as const,
    reasonCode: 'confidence-evidence-not-approved',
    message: 'This valuation is unavailable because its confidence evidence is not approved.',
    nextAction: 'await_model_approval' as const,
    nextActionLabel: 'Review methodology and approval status',
    warningCode: 'confidence-evidence-not-approved',
  }),
  identity_evidence_unresolved: Object.freeze({
    availability: 'identity_unresolved' as const,
    reasonCode: 'trade-asset-identity-unresolved',
    message: 'This valuation is unavailable because a traded asset identity is unresolved.',
    nextAction: 'resolve_identity' as const,
    nextActionLabel: 'Review methodology and identity limits',
    warningCode: 'trade-asset-identity-unresolved',
  }),
  lineage_evidence_unresolved: Object.freeze({
    availability: 'lineage_unresolved' as const,
    reasonCode: 'trade-asset-lineage-unresolved',
    message: 'This valuation is unavailable because traded-asset lineage is unresolved.',
    nextAction: 'resolve_lineage' as const,
    nextActionLabel: 'Review methodology and lineage limits',
    warningCode: 'trade-asset-lineage-unresolved',
  }),
  package_distribution_not_complete: Object.freeze({
    availability: 'insufficient_data' as const,
    reasonCode: 'package-distribution-incomplete',
    message:
      'This valuation is unavailable because a complete received-package distribution is not available.',
    nextAction: 'collect_more_evidence' as const,
    nextActionLabel: 'Review methodology and data limits',
    warningCode: 'package-distribution-incomplete',
  }),
  root_distribution_not_complete: Object.freeze({
    availability: 'insufficient_data' as const,
    reasonCode: 'asset-distribution-incomplete',
    message:
      'This valuation is unavailable because a complete traded-asset distribution is not available.',
    nextAction: 'collect_more_evidence' as const,
    nextActionLabel: 'Review methodology and data limits',
    warningCode: 'asset-distribution-incomplete',
  }),
  selected_comparison_not_available: Object.freeze({
    availability: 'insufficient_data' as const,
    reasonCode: 'trade-comparison-incomplete',
    message:
      'This valuation is unavailable because a complete joint trade comparison is not available.',
    nextAction: 'collect_more_evidence' as const,
    nextActionLabel: 'Review methodology and comparison limits',
    warningCode: 'trade-comparison-incomplete',
  }),
});

function canonicalRequiredPredicates() {
  return AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES.map((predicate) => ({
    ...predicate,
    appliesToViews: [...AFL_TRADE_VALUATION_VIEWS],
  }));
}

function canonicalFailClosedMappings() {
  return AFL_TRADE_PROJECTION_PRESENTATION_FAIL_CLOSED_CAUSES.map((cause) => {
    const mapping = FAIL_CLOSED_MAPPING[cause];
    return {
      cause,
      availability: mapping.availability,
      reasonCode: mapping.reasonCode,
      message: mapping.message,
      nextAction: mapping.nextAction,
      nextActionLabel: mapping.nextActionLabel,
      warning: {
        code: mapping.warningCode,
        severity: 'warning' as const,
        message: mapping.message,
      },
    };
  });
}

function canonicalUncertaintyComponentMappings() {
  return [
    {
      source: 'outcome_distribution' as const,
      confidenceDimension: null,
      component: {
        kind: 'outcome' as const,
        label: 'Outcome variability',
        description: 'Variation across the governed complete outcome distribution.',
      },
    },
    {
      source: 'confidence_dimension' as const,
      confidenceDimension: 'model_calibration' as const,
      component: {
        kind: 'model' as const,
        label: 'Model calibration',
        description: 'Uncertainty represented by the model-calibration evidence.',
      },
    },
    {
      source: 'confidence_dimension' as const,
      confidenceDimension: 'data_coverage' as const,
      component: {
        kind: 'data_quality' as const,
        label: 'Data coverage',
        description: 'Uncertainty represented by the data-coverage evidence.',
      },
    },
    {
      source: 'confidence_dimension' as const,
      confidenceDimension: 'identity' as const,
      component: {
        kind: 'identity' as const,
        label: 'Asset identity',
        description: 'Uncertainty represented by the asset-identity evidence.',
      },
    },
    {
      source: 'confidence_dimension' as const,
      confidenceDimension: 'lineage' as const,
      component: {
        kind: 'lineage' as const,
        label: 'Asset lineage',
        description: 'Uncertainty represented by the lineage-attribution evidence.',
      },
    },
    {
      source: 'confidence_dimension' as const,
      confidenceDimension: 'source_freshness' as const,
      component: {
        kind: 'source_freshness' as const,
        label: 'Source freshness',
        description: 'Uncertainty represented by the source-freshness evidence.',
      },
    },
  ];
}

export const aflTradeProjectionPresentationUniversalLayerSchema = z.enum(
  AFL_TRADE_PROJECTION_PRESENTATION_UNIVERSAL_LAYERS
);

const probabilitySchema = z.number().finite().min(0).max(1);
const strictProbabilitySchema = z.number().finite().gt(0).lt(1);
const methodologyHrefSchema = aflTradePublicHrefSchema.refine(
  (href) => href === AFL_TRADE_METHODOLOGY_HREF,
  `Projection presentation methodology must use ${AFL_TRADE_METHODOLOGY_HREF}.`
);
const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Projection presentation policies require canonical JSON artifact references.'
);

const selectedMeasureSchema = z
  .object({
    kind: z.literal('universal_football_value'),
    layer: aflTradeProjectionPresentationUniversalLayerSchema,
  })
  .strict();

const completeStatisticsSourceSchema = z
  .object({
    structuralDistributionSchemaVersion: z.literal(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION
    ),
    requiredStatus: z.literal('complete'),
    quantileDefinitionVersion: z.literal(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION
    ),
    estimatePath: z.literal('content.distribution.statistics.mean'),
    medianPath: z.literal('content.distribution.statistics.median'),
    centralIntervalPath: z.literal('content.distribution.statistics.centralInterval'),
    downsidePath: z.literal('content.distribution.statistics.downside'),
    upsidePath: z.literal('content.distribution.statistics.upside'),
    lowReturnProbabilityPath: z.literal(
      'content.distribution.eventProbabilities.lowReturnProbability'
    ),
    eliteOutcomeProbabilityPath: z.literal(
      'content.distribution.eventProbabilities.eliteOutcomeProbability'
    ),
  })
  .strict();

const selectedCoordinatesSchema = z
  .object({
    distributions: z
      .object({
        views: z.tuple([
          z.literal('at_trade'),
          z.literal('realized'),
          z.literal('remaining'),
          z.literal('current'),
        ]),
        subjectKinds: z.tuple([
          z.literal('afl_club_received_package'),
          z.literal('source_native_afl_trade_root'),
        ]),
        measure: selectedMeasureSchema,
      })
      .strict(),
    comparisons: z
      .object({
        views: z.tuple([
          z.literal('at_trade'),
          z.literal('realized'),
          z.literal('remaining'),
          z.literal('current'),
        ]),
        measure: selectedMeasureSchema,
      })
      .strict(),
  })
  .strict();

const distributionSummaryPolicySchema = z
  .object({
    estimateStatistic: z.literal('mean'),
    downsideQuantile: z.literal(0.1),
    medianQuantile: z.literal(0.5),
    upsideQuantile: z.literal(0.9),
    centralIntervalLevel: z.literal(0.8),
    completeStatisticsSource: completeStatisticsSourceSchema,
  })
  .strict();

const failClosedCauseSchema = z.enum(AFL_TRADE_PROJECTION_PRESENTATION_FAIL_CLOSED_CAUSES);
const requiredPredicateSchema = z
  .object({
    predicate: z.enum(
      AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES.map(({ predicate }) => predicate) as [
        (typeof AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES)[number]['predicate'],
        ...(typeof AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES)[number]['predicate'][],
      ]
    ),
    failureCause: failClosedCauseSchema,
  })
  .strict();

const failClosedMappingSchema = z
  .object({
    cause: failClosedCauseSchema,
    availability: z.enum([
      'insufficient_data',
      'identity_unresolved',
      'lineage_unresolved',
      'model_not_approved',
    ]),
    reasonCode: z.string().trim().min(1).max(160),
    message: z.string().trim().min(1).max(500),
    nextAction: z.enum([
      'collect_more_evidence',
      'resolve_identity',
      'resolve_lineage',
      'await_model_approval',
    ]),
    nextActionLabel: z.string().trim().min(1).max(120),
    warning: z
      .object({
        code: z.string().trim().min(1).max(160),
        severity: z.literal('warning'),
        message: z.string().trim().min(1).max(500),
      })
      .strict(),
  })
  .strict();

const assessmentPolicySchema = z
  .object({
    definitionVersion: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_ASSESSMENT_DEFINITION),
    balanced: z
      .object({
        result: z.literal('balanced_within_uncertainty'),
        combination: z.literal('any'),
        practicalEquivalence: z
          .object({
            operator: z.literal('greater_than_or_equal'),
            minimumProbability: strictProbabilitySchema,
          })
          .strict(),
        leaderRunnerMargin: z
          .object({
            operator: z.literal('less_than_or_equal'),
            maximum: probabilitySchema,
          })
          .strict(),
      })
      .strict(),
    strongLean: z
      .object({
        result: z.literal('strongly_leans_to_club'),
        combination: z.literal('all'),
        practicalEquivalence: z
          .object({
            operator: z.literal('less_than'),
            maximumExclusiveSource: z.literal('balanced.practicalEquivalence.minimumProbability'),
          })
          .strict(),
        leaderRunnerMargin: z
          .object({
            operator: z.literal('greater_than_or_equal'),
            minimum: probabilitySchema,
          })
          .strict(),
      })
      .strict(),
    otherwise: z.literal('leans_to_club'),
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      policy.balanced.leaderRunnerMargin.maximum >= policy.strongLean.leaderRunnerMargin.minimum
    ) {
      context.addIssue({
        code: 'custom',
        path: ['strongLean', 'leaderRunnerMargin', 'minimum'],
        message: 'The strong-lead margin must exceed the balanced maximum margin.',
      });
    }
  });

const numericalPublicationPolicySchema = z
  .object({
    requirement: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_NUMERICAL_PUBLICATION),
    partialTreatment: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PARTIAL_TREATMENT),
    unavailableTreatment: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_UNAVAILABLE_TREATMENT),
    comparisonBasis: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_COMPARISON_BASIS),
    firstFailurePrecedence: z.literal(
      AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FIRST_FAILURE_PRECEDENCE
    ),
    requiredPredicates: z
      .array(
        requiredPredicateSchema.extend({
          appliesToViews: z.tuple([
            z.literal('at_trade'),
            z.literal('realized'),
            z.literal('remaining'),
            z.literal('current'),
          ]),
        })
      )
      .length(AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES.length),
    failClosedMappings: z
      .array(failClosedMappingSchema)
      .length(AFL_TRADE_PROJECTION_PRESENTATION_FAIL_CLOSED_CAUSES.length)
      .max(20),
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      canonicalizeAflTradeJson(policy.requiredPredicates) !==
      canonicalizeAflTradeJson(canonicalRequiredPredicates())
    ) {
      context.addIssue({
        code: 'custom',
        path: ['requiredPredicates'],
        message: 'Complete-only predicates must match the governed canonical declaration.',
      });
    }
    if (
      canonicalizeAflTradeJson(policy.failClosedMappings) !==
      canonicalizeAflTradeJson(canonicalFailClosedMappings())
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failClosedMappings'],
        message: 'Fail-closed mappings must cover every cause in canonical order.',
      });
    }
  });

const factorPolicySchema = z
  .object({
    polarityEvidenceRequirement: z.literal(
      AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_EVIDENCE
    ),
    missingEvidenceTreatment: z.literal(
      AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MISSING_FACTOR_EVIDENCE
    ),
    ordering: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_ORDERING),
    deduplication: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_DEDUPLICATION),
    scope: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_SCOPE),
    dtoSemantics: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_DTO_SEMANTICS),
    perSubjectRepetition: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_REPETITION),
    perClubTreatment: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PER_CLUB_FACTOR_TREATMENT),
    perAssetTreatment: z.literal(
      AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PER_ASSET_FACTOR_TREATMENT
    ),
    kindOrder: z.tuple([z.literal('positive'), z.literal('negative'), z.literal('uncertainty')]),
    maximumCount: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_FACTORS),
  })
  .strict();

const uncertaintyComponentMappingSchema = z
  .object({
    source: z.enum(['outcome_distribution', 'confidence_dimension']),
    confidenceDimension: z.enum(AFL_TRADE_CONFIDENCE_DIMENSIONS).nullable(),
    component: aflTradeUncertaintyComponentSchema,
  })
  .strict();

const uncertaintyComponentsPolicySchema = z
  .object({
    definitionVersion: z.literal(
      AFL_TRADE_PROJECTION_PRESENTATION_UNCERTAINTY_COMPONENT_DEFINITION
    ),
    ordering: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_UNCERTAINTY_COMPONENT_ORDERING),
    mappings: z
      .array(uncertaintyComponentMappingSchema)
      .length(AFL_TRADE_CONFIDENCE_DIMENSIONS.length + 1),
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      canonicalizeAflTradeJson(policy.mappings) !==
      canonicalizeAflTradeJson(canonicalUncertaintyComponentMappings())
    ) {
      context.addIssue({
        code: 'custom',
        path: ['mappings'],
        message: 'Uncertainty mappings must match the governed canonical declaration.',
      });
    }
  });

export const aflTradeProjectionPresentationPolicyContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PUBLIC_ASSET_BOUNDARY),
    valueUnit: aflTradeValueUnitSchema,
    universalLayer: aflTradeProjectionPresentationUniversalLayerSchema,
    selectedCoordinates: selectedCoordinatesSchema,
    distributionSummary: distributionSummaryPolicySchema,
    assessment: assessmentPolicySchema,
    numericalPublication: numericalPublicationPolicySchema,
    factors: factorPolicySchema,
    uncertaintyComponents: uncertaintyComponentsPolicySchema,
    supportedViews: z.tuple([
      z.literal('at_trade'),
      z.literal('realized'),
      z.literal('remaining'),
      z.literal('current'),
    ]),
    warningReasonMappingDefinition: z.literal(
      AFL_TRADE_PROJECTION_PRESENTATION_POLICY_WARNING_REASON_MAPPING
    ),
    methodologyHref: z.literal(AFL_TRADE_METHODOLOGY_HREF),
    predecessorPolicy: z
      .object({
        predecessorSchemaVersion: z.null(),
        compatibility: z.literal(
          AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PREDECESSOR_COMPATIBILITY
        ),
        runtimeFallback: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_RUNTIME_FALLBACK),
      })
      .strict(),
    createdAt: aflTradeIsoDateTimeSchema,
    limitation: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.supportedViews.some((view, index) => view !== AFL_TRADE_VALUATION_VIEWS[index])) {
      context.addIssue({
        code: 'custom',
        path: ['supportedViews'],
        message: 'Projection presentation views must use the complete canonical order.',
      });
    }
    if (
      content.selectedCoordinates.distributions.measure.layer !== content.universalLayer ||
      content.selectedCoordinates.comparisons.measure.layer !== content.universalLayer
    ) {
      context.addIssue({
        code: 'custom',
        path: ['selectedCoordinates'],
        message: 'Selected distribution and comparison measures must use the policy layer.',
      });
    }
  });

export const aflTradeProjectionPresentationPolicySchema = z
  .object({
    projectionPresentationPolicyId: aflTradeContentAddressedIdSchema(
      'projection-presentation-policy'
    ),
    content: aflTradeProjectionPresentationPolicyContentSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    addAflTradeContentAddressIssue(
      'projection-presentation-policy',
      policy.projectionPresentationPolicyId,
      policy.content,
      context,
      ['projectionPresentationPolicyId']
    );
  });

export type AflTradeProjectionPresentationUniversalLayer = z.infer<
  typeof aflTradeProjectionPresentationUniversalLayerSchema
>;
export type AflTradeProjectionPresentationPolicyContent = z.infer<
  typeof aflTradeProjectionPresentationPolicyContentSchema
>;
export type AflTradeProjectionPresentationPolicy = z.infer<
  typeof aflTradeProjectionPresentationPolicySchema
>;

export const aflTradeProjectionPresentationPolicyResultSchema = z
  .object({
    projectionPresentationPolicy: aflTradeProjectionPresentationPolicySchema,
    projectionPresentationPolicyArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const reference = result.projectionPresentationPolicyArtifactRef;
    if (
      !doesAflTradeArtifactRefMatchCanonicalJson(reference, result.projectionPresentationPolicy)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionPresentationPolicyArtifactRef'],
        message: 'The artifact reference must authenticate the projection presentation policy.',
      });
    }
    if (reference.createdAt !== result.projectionPresentationPolicy.content.createdAt) {
      context.addIssue({
        code: 'custom',
        path: ['projectionPresentationPolicyArtifactRef', 'createdAt'],
        message: 'Policy artifact materialization must equal policy creation time.',
      });
    }
    if (
      reference.byteLength < 1 ||
      reference.byteLength > AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionPresentationPolicyArtifactRef', 'byteLength'],
        message: 'Projection presentation policy canonical bytes exceed the 64 KiB limit.',
      });
    }
  });

export type AflTradeProjectionPresentationPolicyResult = z.infer<
  typeof aflTradeProjectionPresentationPolicyResultSchema
>;

export const aflTradeProjectionPresentationPolicyCreateInputSchema = z
  .object({
    valueUnit: aflTradeValueUnitSchema,
    universalLayer: aflTradeProjectionPresentationUniversalLayerSchema,
    balancedMaximumLeaderMargin: probabilitySchema,
    balancedMinimumPracticalEquivalenceProbability: strictProbabilitySchema,
    strongMinimumLeaderMargin: probabilitySchema,
    methodologyHref: methodologyHrefSchema,
    createdAt: aflTradeIsoDateTimeSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.balancedMaximumLeaderMargin >= input.strongMinimumLeaderMargin) {
      context.addIssue({
        code: 'custom',
        path: ['strongMinimumLeaderMargin'],
        message: 'The strong-lead margin must exceed the balanced maximum margin.',
      });
    }
  });

export type AflTradeProjectionPresentationPolicyCreateInput = z.infer<
  typeof aflTradeProjectionPresentationPolicyCreateInputSchema
>;

export const aflTradeProjectionPresentationPolicyVerifyInputSchema =
  aflTradeProjectionPresentationPolicyCreateInputSchema.safeExtend({
    output: aflTradeProjectionPresentationPolicyResultSchema,
  });

export type AflTradeProjectionPresentationPolicyVerifyInput = z.infer<
  typeof aflTradeProjectionPresentationPolicyVerifyInputSchema
>;

export const aflTradeProjectionAssessmentEvaluationInputSchema = z
  .object({
    policy: aflTradeProjectionPresentationPolicySchema,
    comparisonProbabilities: aflTradeJointOutcomeProbabilitiesSchema,
  })
  .strict();

export type AflTradeProjectionAssessmentEvaluationInput = z.infer<
  typeof aflTradeProjectionAssessmentEvaluationInputSchema
>;

export const aflTradeProjectionFailClosedInputSchema = z
  .object({
    policy: aflTradeProjectionPresentationPolicySchema,
    cause: failClosedCauseSchema,
    view: aflTradeValuationViewSchema,
  })
  .strict();

export type AflTradeProjectionFailClosedInput = z.infer<
  typeof aflTradeProjectionFailClosedInputSchema
>;

const evidenceSourceVerificationReplaySchema = z
  .object({
    sourceArtifacts:
      aflTradeProjectionEvidenceSourceVerificationVerifyInputSchema.shape.sourceArtifacts,
    verifiedAt: aflTradeProjectionEvidenceSourceVerificationVerifyInputSchema.shape.verifiedAt,
    output: aflTradeProjectionEvidenceSourceVerificationVerifyInputSchema.shape.output,
  })
  .strict();

export const aflTradeProjectionFactorEvidenceInputSchema = z
  .object({
    view: aflTradeValuationViewSchema,
    projectionPublicEvidence: aflTradeProjectionPublicEvidenceResultSchema,
    evidenceSourceVerification: evidenceSourceVerificationReplaySchema,
  })
  .strict();

export type AflTradeProjectionFactorEvidenceInput = z.infer<
  typeof aflTradeProjectionFactorEvidenceInputSchema
>;

export const aflTradeProjectionPublicationPredicateFactsSchema = z
  .object({
    assetCoverageComplete: z.boolean(),
    identityEvidenceResolved: z.boolean(),
    lineageAttributionResolved: z.boolean(),
    packageDistributionComplete: z.boolean(),
    rootDistributionComplete: z.boolean(),
    selectedComparisonAvailable: z.boolean(),
  })
  .strict();

export const aflTradeProjectionPublicationEligibilityInputSchema = z
  .object({
    policy: aflTradeProjectionPresentationPolicySchema,
    view: aflTradeValuationViewSchema,
    projectionPublicEvidence: aflTradeProjectionPublicEvidenceResultSchema,
    evidenceSourceVerification: evidenceSourceVerificationReplaySchema,
    predicateFacts: aflTradeProjectionPublicationPredicateFactsSchema,
  })
  .strict();

export const aflTradeProjectionPublicationEligibilityResultSchema = z
  .discriminatedUnion('status', [
    z
      .object({
        view: aflTradeValuationViewSchema,
        status: z.literal('eligible'),
        failedPredicate: z.null(),
        failureCause: z.null(),
      })
      .strict(),
    z
      .object({
        view: aflTradeValuationViewSchema,
        status: z.literal('ineligible'),
        failedPredicate: requiredPredicateSchema.shape.predicate,
        failureCause: failClosedCauseSchema,
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    if (result.status === 'eligible') return;
    const declaration = AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES.find(
      ({ predicate }) => predicate === result.failedPredicate
    );
    if (declaration?.failureCause !== result.failureCause) {
      context.addIssue({
        code: 'custom',
        path: ['failureCause'],
        message: 'The failure cause must match the governed predicate declaration.',
      });
    }
  });

export const aflTradeProjectionUncertaintyComponentSelectionInputSchema = z
  .object({ policy: aflTradeProjectionPresentationPolicySchema })
  .strict();

export const aflTradeProjectionUncertaintyComponentSelectionResultSchema = z
  .array(aflTradeUncertaintyComponentSchema)
  .length(AFL_TRADE_CONFIDENCE_DIMENSIONS.length + 1);

export const aflTradeProjectionPublicFactorSelectionResultSchema = z
  .object({
    scope: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_SCOPE),
    viewGlobalFactors: z
      .array(aflTradeValueFactorSchema)
      .max(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_FACTORS),
    canRepeatIntoPerSubjectFactors: z.literal(false),
    perSubjectRepetition: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_REPETITION),
    perClubFactors: z.array(aflTradeValueFactorSchema).length(0),
    perAssetFactors: z.array(aflTradeValueFactorSchema).length(0),
  })
  .strict();

export type AflTradeProjectionPublicationEligibilityInput = z.infer<
  typeof aflTradeProjectionPublicationEligibilityInputSchema
>;
export type AflTradeProjectionPublicationPredicateFacts = z.infer<
  typeof aflTradeProjectionPublicationPredicateFactsSchema
>;
export type AflTradeProjectionPublicationEligibilityResult = z.infer<
  typeof aflTradeProjectionPublicationEligibilityResultSchema
>;
export type AflTradeProjectionUncertaintyComponentSelectionInput = z.infer<
  typeof aflTradeProjectionUncertaintyComponentSelectionInputSchema
>;
export type AflTradeProjectionUncertaintyComponentSelectionResult = z.infer<
  typeof aflTradeProjectionUncertaintyComponentSelectionResultSchema
>;
export type AflTradeProjectionPublicFactorSelectionResult = z.infer<
  typeof aflTradeProjectionPublicFactorSelectionResultSchema
>;

export const AFL_TRADE_PROJECTION_PRESENTATION_POLICY_CONSTRUCTION_ERROR_CODES = [
  'INVALID_INPUT_ENVELOPE',
  'INVALID_VALUE_UNIT',
  'INVALID_UNIVERSAL_LAYER',
  'INVALID_BALANCED_MAXIMUM_LEADER_MARGIN',
  'INVALID_BALANCED_MINIMUM_PRACTICAL_EQUIVALENCE_PROBABILITY',
  'INVALID_STRONG_MINIMUM_LEADER_MARGIN',
  'INVALID_ASSESSMENT_THRESHOLDS',
  'INVALID_METHODOLOGY_HREF',
  'INVALID_CREATED_AT',
  'INVALID_ASSESSMENT_INPUT_ENVELOPE',
  'INVALID_ASSESSMENT_POLICY',
  'INVALID_COMPARISON_PROBABILITIES',
  'NON_UNIQUE_CLEAR_LEADER',
  'INVALID_FAIL_CLOSED_INPUT_ENVELOPE',
  'INVALID_FAIL_CLOSED_POLICY',
  'INVALID_FAIL_CLOSED_VIEW',
  'INVALID_ELIGIBILITY_INPUT_ENVELOPE',
  'INVALID_ELIGIBILITY_POLICY',
  'INVALID_ELIGIBILITY_VIEW',
  'INVALID_ELIGIBILITY_EVIDENCE',
  'INVALID_ELIGIBILITY_SOURCE_VERIFICATION',
  'ELIGIBILITY_SOURCE_VERIFICATION_REPLAY_FAILED',
  'INVALID_ELIGIBILITY_PREDICATE_FACTS',
  'EVIDENCE_SOURCE_VERIFICATION_MISMATCH',
  'INVALID_UNCERTAINTY_INPUT_ENVELOPE',
  'INVALID_UNCERTAINTY_POLICY',
  'INVALID_FACTOR_INPUT_ENVELOPE',
  'INVALID_FACTOR_VIEW',
  'INVALID_FACTOR_PUBLIC_EVIDENCE',
  'INVALID_FACTOR_SOURCE_VERIFICATION',
  'FACTOR_SOURCE_VERIFICATION_REPLAY_FAILED',
  'FACTOR_EVIDENCE_SOURCE_VERIFICATION_MISMATCH',
  'FACTOR_SOURCE_VERIFICATION_NOT_PASSED',
  'INVALID_FACTOR_EVIDENCE',
  'ARTIFACT_SIZE_LIMIT_EXCEEDED',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const;

export type AflTradeProjectionPresentationPolicyConstructionErrorCode =
  (typeof AFL_TRADE_PROJECTION_PRESENTATION_POLICY_CONSTRUCTION_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<
  Record<AflTradeProjectionPresentationPolicyConstructionErrorCode, string>
> = Object.freeze({
  INVALID_INPUT_ENVELOPE: 'The projection presentation-policy input envelope is invalid.',
  INVALID_VALUE_UNIT: 'The projection presentation-policy value unit is invalid.',
  INVALID_UNIVERSAL_LAYER: 'The projection presentation-policy universal layer is invalid.',
  INVALID_BALANCED_MAXIMUM_LEADER_MARGIN:
    'The balanced maximum leader margin must be a probability.',
  INVALID_BALANCED_MINIMUM_PRACTICAL_EQUIVALENCE_PROBABILITY:
    'The balanced practical-equivalence threshold must be strictly between zero and one.',
  INVALID_STRONG_MINIMUM_LEADER_MARGIN: 'The strong minimum leader margin must be a probability.',
  INVALID_ASSESSMENT_THRESHOLDS:
    'The balanced maximum leader margin must be less than the strong minimum leader margin.',
  INVALID_METHODOLOGY_HREF: 'The projection presentation-policy methodology link is invalid.',
  INVALID_CREATED_AT: 'The projection presentation-policy creation time is invalid.',
  INVALID_ASSESSMENT_INPUT_ENVELOPE: 'The projection assessment input envelope is invalid.',
  INVALID_ASSESSMENT_POLICY: 'The projection assessment policy is invalid.',
  INVALID_COMPARISON_PROBABILITIES: 'The projection comparison probabilities are invalid.',
  NON_UNIQUE_CLEAR_LEADER:
    'A non-balanced projection assessment requires one unique clear-leading AFL club.',
  INVALID_FAIL_CLOSED_INPUT_ENVELOPE: 'The fail-closed projection input envelope is invalid.',
  INVALID_FAIL_CLOSED_POLICY: 'The fail-closed projection policy is invalid.',
  INVALID_FAIL_CLOSED_VIEW: 'The fail-closed projection view is invalid.',
  INVALID_ELIGIBILITY_INPUT_ENVELOPE:
    'The projection publication-eligibility input envelope is invalid.',
  INVALID_ELIGIBILITY_POLICY: 'The projection publication-eligibility policy is invalid.',
  INVALID_ELIGIBILITY_VIEW: 'The projection publication-eligibility view is invalid.',
  INVALID_ELIGIBILITY_EVIDENCE:
    'The projection publication-eligibility public evidence is invalid.',
  INVALID_ELIGIBILITY_SOURCE_VERIFICATION:
    'The projection publication-eligibility source verification is invalid.',
  ELIGIBILITY_SOURCE_VERIFICATION_REPLAY_FAILED:
    'The projection publication-eligibility source verification cannot be reproduced from its exact evidence and sources.',
  INVALID_ELIGIBILITY_PREDICATE_FACTS:
    'The projection publication-eligibility predicate facts are invalid.',
  EVIDENCE_SOURCE_VERIFICATION_MISMATCH:
    'The source-verification report does not bind the exact public-evidence result.',
  INVALID_UNCERTAINTY_INPUT_ENVELOPE:
    'The projection uncertainty-component input envelope is invalid.',
  INVALID_UNCERTAINTY_POLICY: 'The projection uncertainty-component policy is invalid.',
  INVALID_FACTOR_INPUT_ENVELOPE: 'The projection factor-evidence input envelope is invalid.',
  INVALID_FACTOR_VIEW: 'The projection factor-evidence valuation view is invalid.',
  INVALID_FACTOR_PUBLIC_EVIDENCE: 'The projection factor public-evidence result is invalid.',
  INVALID_FACTOR_SOURCE_VERIFICATION: 'The projection factor source verification is invalid.',
  FACTOR_SOURCE_VERIFICATION_REPLAY_FAILED:
    'The projection factor source verification cannot be reproduced from its exact evidence and sources.',
  FACTOR_EVIDENCE_SOURCE_VERIFICATION_MISMATCH:
    'The projection factor source-verification report does not bind the exact public-evidence result.',
  FACTOR_SOURCE_VERIFICATION_NOT_PASSED:
    'Projection factors require a successfully passed source-verification report.',
  INVALID_FACTOR_EVIDENCE:
    'Projection factors must be direct valid public evidence within the governed limit.',
  ARTIFACT_SIZE_LIMIT_EXCEEDED:
    'The projection presentation-policy exceeds its canonical byte limit.',
  INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
    'The projection presentation-policy failed its internal artifact contract.',
});

const TRUSTED_ERRORS = new WeakSet<object>();

export class AflTradeProjectionPresentationPolicyConstructionError extends Error {
  readonly code: AflTradeProjectionPresentationPolicyConstructionErrorCode;

  constructor(code: AflTradeProjectionPresentationPolicyConstructionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AflTradeProjectionPresentationPolicyConstructionError';
    this.code = code;
    TRUSTED_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeProjectionPresentationPolicyConstructionError';
    code: AflTradeProjectionPresentationPolicyConstructionErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeProjectionPresentationPolicyConstructionError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeProjectionPresentationPolicyConstructionError(
  value: unknown
): value is AflTradeProjectionPresentationPolicyConstructionError {
  return value !== null && typeof value === 'object' && TRUSTED_ERRORS.has(value);
}

function constructionError(
  code: AflTradeProjectionPresentationPolicyConstructionErrorCode
): AflTradeProjectionPresentationPolicyConstructionError {
  return new AflTradeProjectionPresentationPolicyConstructionError(code);
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeProjectionPresentationPolicyConstructionErrorCode
): T {
  try {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    // Hostile input failures are replaced with stable construction errors.
  }
  throw constructionError(code);
}

const CREATE_INPUT_KEYS = [
  'valueUnit',
  'universalLayer',
  'balancedMaximumLeaderMargin',
  'balancedMinimumPracticalEquivalenceProbability',
  'strongMinimumLeaderMargin',
  'methodologyHref',
  'createdAt',
] as const;
const VERIFY_INPUT_KEYS = [...CREATE_INPUT_KEYS, 'output'] as const;
const ASSESSMENT_INPUT_KEYS = ['policy', 'comparisonProbabilities'] as const;
const FAIL_CLOSED_INPUT_KEYS = ['policy', 'cause', 'view'] as const;
const ELIGIBILITY_INPUT_KEYS = [
  'policy',
  'view',
  'projectionPublicEvidence',
  'evidenceSourceVerification',
  'predicateFacts',
] as const;
const UNCERTAINTY_INPUT_KEYS = ['policy'] as const;
const FACTOR_INPUT_KEYS = [
  'view',
  'projectionPublicEvidence',
  'evidenceSourceVerification',
] as const;

function snapshotExactInput<const Key extends string>(
  value: unknown,
  keys: readonly Key[]
): Record<Key, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    const expectedKeys = new Set<string>(keys);
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
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

export function createAflTradeProjectionPresentationPolicy(
  unparsedInput: unknown
): AflTradeProjectionPresentationPolicyResult {
  try {
    const snapshot = snapshotExactInput(unparsedInput, CREATE_INPUT_KEYS);
    if (snapshot === null) throw constructionError('INVALID_INPUT_ENVELOPE');

    const valueUnit = parseOrThrow(
      aflTradeValueUnitSchema,
      snapshot.valueUnit,
      'INVALID_VALUE_UNIT'
    );
    const universalLayer = parseOrThrow(
      aflTradeProjectionPresentationUniversalLayerSchema,
      snapshot.universalLayer,
      'INVALID_UNIVERSAL_LAYER'
    );
    const balancedMaximumLeaderMargin = parseOrThrow(
      probabilitySchema,
      snapshot.balancedMaximumLeaderMargin,
      'INVALID_BALANCED_MAXIMUM_LEADER_MARGIN'
    );
    const balancedMinimumPracticalEquivalenceProbability = parseOrThrow(
      strictProbabilitySchema,
      snapshot.balancedMinimumPracticalEquivalenceProbability,
      'INVALID_BALANCED_MINIMUM_PRACTICAL_EQUIVALENCE_PROBABILITY'
    );
    const strongMinimumLeaderMargin = parseOrThrow(
      probabilitySchema,
      snapshot.strongMinimumLeaderMargin,
      'INVALID_STRONG_MINIMUM_LEADER_MARGIN'
    );
    const methodologyHref = parseOrThrow(
      methodologyHrefSchema,
      snapshot.methodologyHref,
      'INVALID_METHODOLOGY_HREF'
    );
    const createdAt = parseOrThrow(
      aflTradeIsoDateTimeSchema,
      snapshot.createdAt,
      'INVALID_CREATED_AT'
    );
    if (balancedMaximumLeaderMargin >= strongMinimumLeaderMargin) {
      throw constructionError('INVALID_ASSESSMENT_THRESHOLDS');
    }

    const content = {
      schemaVersion: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PUBLIC_ASSET_BOUNDARY,
      valueUnit,
      universalLayer,
      selectedCoordinates: {
        distributions: {
          views: [...AFL_TRADE_VALUATION_VIEWS],
          subjectKinds: [...AFL_TRADE_PROJECTION_PRESENTATION_DISTRIBUTION_SUBJECT_KINDS],
          measure: { kind: 'universal_football_value' as const, layer: universalLayer },
        },
        comparisons: {
          views: [...AFL_TRADE_VALUATION_VIEWS],
          measure: { kind: 'universal_football_value' as const, layer: universalLayer },
        },
      },
      distributionSummary: {
        estimateStatistic: 'mean' as const,
        downsideQuantile: 0.1 as const,
        medianQuantile: 0.5 as const,
        upsideQuantile: 0.9 as const,
        centralIntervalLevel: 0.8 as const,
        completeStatisticsSource: {
          structuralDistributionSchemaVersion:
            AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION,
          requiredStatus: 'complete' as const,
          quantileDefinitionVersion:
            AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
          estimatePath: 'content.distribution.statistics.mean' as const,
          medianPath: 'content.distribution.statistics.median' as const,
          centralIntervalPath: 'content.distribution.statistics.centralInterval' as const,
          downsidePath: 'content.distribution.statistics.downside' as const,
          upsidePath: 'content.distribution.statistics.upside' as const,
          lowReturnProbabilityPath:
            'content.distribution.eventProbabilities.lowReturnProbability' as const,
          eliteOutcomeProbabilityPath:
            'content.distribution.eventProbabilities.eliteOutcomeProbability' as const,
        },
      },
      assessment: {
        definitionVersion: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_ASSESSMENT_DEFINITION,
        balanced: {
          result: 'balanced_within_uncertainty' as const,
          combination: 'any' as const,
          practicalEquivalence: {
            operator: 'greater_than_or_equal' as const,
            minimumProbability: balancedMinimumPracticalEquivalenceProbability,
          },
          leaderRunnerMargin: {
            operator: 'less_than_or_equal' as const,
            maximum: balancedMaximumLeaderMargin,
          },
        },
        strongLean: {
          result: 'strongly_leans_to_club' as const,
          combination: 'all' as const,
          practicalEquivalence: {
            operator: 'less_than' as const,
            maximumExclusiveSource: 'balanced.practicalEquivalence.minimumProbability' as const,
          },
          leaderRunnerMargin: {
            operator: 'greater_than_or_equal' as const,
            minimum: strongMinimumLeaderMargin,
          },
        },
        otherwise: 'leans_to_club' as const,
      },
      numericalPublication: {
        requirement: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_NUMERICAL_PUBLICATION,
        partialTreatment: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PARTIAL_TREATMENT,
        unavailableTreatment: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_UNAVAILABLE_TREATMENT,
        comparisonBasis: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_COMPARISON_BASIS,
        firstFailurePrecedence: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FIRST_FAILURE_PRECEDENCE,
        requiredPredicates: canonicalRequiredPredicates(),
        failClosedMappings: canonicalFailClosedMappings(),
      },
      factors: {
        polarityEvidenceRequirement: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_EVIDENCE,
        missingEvidenceTreatment: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MISSING_FACTOR_EVIDENCE,
        ordering: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_ORDERING,
        deduplication: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_DEDUPLICATION,
        scope: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_SCOPE,
        dtoSemantics: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_DTO_SEMANTICS,
        perSubjectRepetition: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_REPETITION,
        perClubTreatment: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PER_CLUB_FACTOR_TREATMENT,
        perAssetTreatment: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PER_ASSET_FACTOR_TREATMENT,
        kindOrder: ['positive', 'negative', 'uncertainty'] as const,
        maximumCount: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_FACTORS,
      },
      uncertaintyComponents: {
        definitionVersion: AFL_TRADE_PROJECTION_PRESENTATION_UNCERTAINTY_COMPONENT_DEFINITION,
        ordering: AFL_TRADE_PROJECTION_PRESENTATION_UNCERTAINTY_COMPONENT_ORDERING,
        mappings: canonicalUncertaintyComponentMappings(),
      },
      supportedViews: [...AFL_TRADE_VALUATION_VIEWS],
      warningReasonMappingDefinition:
        AFL_TRADE_PROJECTION_PRESENTATION_POLICY_WARNING_REASON_MAPPING,
      methodologyHref,
      predecessorPolicy: {
        predecessorSchemaVersion: null,
        compatibility: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PREDECESSOR_COMPATIBILITY,
        runtimeFallback: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_RUNTIME_FALLBACK,
      },
      createdAt,
      limitation: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_LIMITATION,
    };
    const projectionPresentationPolicy = aflTradeProjectionPresentationPolicySchema.safeParse({
      projectionPresentationPolicyId: createAflTradeContentAddress(
        'projection-presentation-policy',
        content
      ),
      content,
    });
    if (!projectionPresentationPolicy.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    const projectionPresentationPolicyArtifactRef = createAflTradeCanonicalJsonArtifactRef(
      projectionPresentationPolicy.data,
      createdAt
    );
    if (
      projectionPresentationPolicyArtifactRef.byteLength < 1 ||
      projectionPresentationPolicyArtifactRef.byteLength >
        AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_BYTES
    ) {
      throw constructionError('ARTIFACT_SIZE_LIMIT_EXCEEDED');
    }
    const result = aflTradeProjectionPresentationPolicyResultSchema.safeParse({
      projectionPresentationPolicy: projectionPresentationPolicy.data,
      projectionPresentationPolicyArtifactRef,
    });
    if (!result.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    return deepFreeze(result.data);
  } catch (error) {
    if (isAflTradeProjectionPresentationPolicyConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

export function verifyAflTradeProjectionPresentationPolicyDerivation(input: unknown): boolean {
  try {
    const snapshot = snapshotExactInput(input, VERIFY_INPUT_KEYS);
    if (snapshot === null) return false;
    const output = aflTradeProjectionPresentationPolicyResultSchema.safeParse(snapshot.output);
    if (!output.success) return false;
    const replayed = createAflTradeProjectionPresentationPolicy({
      valueUnit: snapshot.valueUnit,
      universalLayer: snapshot.universalLayer,
      balancedMaximumLeaderMargin: snapshot.balancedMaximumLeaderMargin,
      balancedMinimumPracticalEquivalenceProbability:
        snapshot.balancedMinimumPracticalEquivalenceProbability,
      strongMinimumLeaderMargin: snapshot.strongMinimumLeaderMargin,
      methodologyHref: snapshot.methodologyHref,
      createdAt: snapshot.createdAt,
    });
    return canonicalizeAflTradeJson(replayed) === canonicalizeAflTradeJson(output.data);
  } catch {
    return false;
  }
}

function canonicalComparisonProbabilities(
  probabilities: AflTradeJointOutcomeProbabilities
): AflTradeJointOutcomeProbabilities['clubClearLeaderProbabilities'] {
  return [...probabilities.clubClearLeaderProbabilities].sort((left, right) => {
    const probabilityOrder = right.probability - left.probability;
    return probabilityOrder !== 0
      ? probabilityOrder
      : compareAflTradeCodeUnits(left.aflClubId, right.aflClubId);
  });
}

export function evaluateAflTradeProjectionAssessment(input: unknown) {
  try {
    const snapshot = snapshotExactInput(input, ASSESSMENT_INPUT_KEYS);
    if (snapshot === null) throw constructionError('INVALID_ASSESSMENT_INPUT_ENVELOPE');
    const policy = parseOrThrow(
      aflTradeProjectionPresentationPolicySchema,
      snapshot.policy,
      'INVALID_ASSESSMENT_POLICY'
    );
    const probabilities = parseOrThrow(
      aflTradeJointOutcomeProbabilitiesSchema,
      snapshot.comparisonProbabilities,
      'INVALID_COMPARISON_PROBABILITIES'
    );
    const ranked = canonicalComparisonProbabilities(probabilities);
    const leader = ranked[0];
    const runnerUp = ranked[1];
    if (leader === undefined || runnerUp === undefined) {
      throw constructionError('INVALID_COMPARISON_PROBABILITIES');
    }
    const leaderRunnerMargin = leader.probability - runnerUp.probability;
    const assessmentPolicy = policy.content.assessment;
    const practicalEquivalenceProbability = probabilities.noClearLeaderProbability;
    const balanced =
      practicalEquivalenceProbability >=
        assessmentPolicy.balanced.practicalEquivalence.minimumProbability ||
      leaderRunnerMargin <= assessmentPolicy.balanced.leaderRunnerMargin.maximum;
    if (balanced) {
      return deepFreeze(
        aflTradeAssessmentSchema.parse({
          interpretation: 'balanced_within_uncertainty',
          favouredAflClubId: null,
          scope: 'complete_trade',
        })
      );
    }
    if (leader.probability === runnerUp.probability) {
      throw constructionError('NON_UNIQUE_CLEAR_LEADER');
    }
    const strong =
      practicalEquivalenceProbability <
        assessmentPolicy.balanced.practicalEquivalence.minimumProbability &&
      leaderRunnerMargin >= assessmentPolicy.strongLean.leaderRunnerMargin.minimum;
    return deepFreeze(
      aflTradeAssessmentSchema.parse({
        interpretation: strong ? 'strongly_leans_to_club' : 'leans_to_club',
        favouredAflClubId: leader.aflClubId,
        scope: 'complete_trade',
      })
    );
  } catch (error) {
    if (isAflTradeProjectionPresentationPolicyConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

export function createAflTradeProjectionFailClosedValue(input: unknown) {
  try {
    const snapshot = snapshotExactInput(input, FAIL_CLOSED_INPUT_KEYS);
    if (snapshot === null) throw constructionError('INVALID_FAIL_CLOSED_INPUT_ENVELOPE');
    const policy = parseOrThrow(
      aflTradeProjectionPresentationPolicySchema,
      snapshot.policy,
      'INVALID_FAIL_CLOSED_POLICY'
    );
    const view = parseOrThrow(
      aflTradeValuationViewSchema,
      snapshot.view,
      'INVALID_FAIL_CLOSED_VIEW'
    );
    let cause: z.infer<typeof failClosedCauseSchema>;
    try {
      const parsedCause = failClosedCauseSchema.safeParse(snapshot.cause);
      if (!parsedCause.success) {
        throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
      }
      cause = parsedCause.data;
    } catch (error) {
      if (isAflTradeProjectionPresentationPolicyConstructionError(error)) throw error;
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    const mapping = policy.content.numericalPublication.failClosedMappings.find(
      (candidate) => candidate.cause === cause
    );
    if (mapping === undefined) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    const output = aflTradeValueUnavailableSchema.safeParse({
      availability: mapping.availability,
      view,
      modelVintage: null,
      temporalContext: null,
      reasonCode: mapping.reasonCode,
      message: mapping.message,
      nextAction: {
        kind: mapping.nextAction,
        label: mapping.nextActionLabel,
        href: policy.content.methodologyHref,
        expectedAfter: null,
      },
      warnings: [mapping.warning],
      methodologyHref: policy.content.methodologyHref,
    });
    if (!output.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    return deepFreeze(output.data);
  } catch (error) {
    if (isAflTradeProjectionPresentationPolicyConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

function publicationPredicateValue(
  predicate: (typeof AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES)[number]['predicate'],
  predicateFacts: z.infer<typeof aflTradeProjectionPublicationPredicateFactsSchema>,
  confidenceEvidenceApproved: boolean
): boolean {
  switch (predicate) {
    case 'asset_coverage_complete_every_view':
      return predicateFacts.assetCoverageComplete;
    case 'confidence_evidence_approved_every_view':
      return confidenceEvidenceApproved;
    case 'identity_evidence_resolved_every_view':
      return predicateFacts.identityEvidenceResolved;
    case 'lineage_attribution_resolved_every_view':
      return predicateFacts.lineageAttributionResolved;
    case 'package_distribution_complete_every_view':
      return predicateFacts.packageDistributionComplete;
    case 'root_distribution_complete_every_view':
      return predicateFacts.rootDistributionComplete;
    case 'selected_comparison_available_every_view':
      return predicateFacts.selectedComparisonAvailable;
  }
}

function sourceVerificationMatchesEvidence(
  projectionPublicEvidence: z.infer<typeof aflTradeProjectionPublicEvidenceResultSchema>,
  evidenceSourceVerification: z.infer<
    typeof aflTradeProjectionEvidenceSourceVerificationResultSchema
  >
): boolean {
  const evidence = projectionPublicEvidence.projectionPublicEvidence;
  const evidenceArtifactRef = projectionPublicEvidence.projectionPublicEvidenceArtifactRef;
  const verification = evidenceSourceVerification.projectionEvidenceSourceVerification.content;
  const expectedEvidenceBinding = {
    schemaVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
    projectionPublicEvidenceId: evidence.projectionPublicEvidenceId,
    artifactRef: evidenceArtifactRef,
  };
  return (
    canonicalizeAflTradeJson(verification.projectionPublicEvidence) ===
      canonicalizeAflTradeJson(expectedEvidenceBinding) &&
    Date.parse(evidenceArtifactRef.createdAt) <= Date.parse(verification.verifiedAt)
  );
}

export function evaluateAflTradeProjectionPublicationEligibility(
  input: unknown
): AflTradeProjectionPublicationEligibilityResult {
  try {
    const snapshot = snapshotExactInput(input, ELIGIBILITY_INPUT_KEYS);
    if (snapshot === null) throw constructionError('INVALID_ELIGIBILITY_INPUT_ENVELOPE');
    parseOrThrow(
      aflTradeProjectionPresentationPolicySchema,
      snapshot.policy,
      'INVALID_ELIGIBILITY_POLICY'
    );
    const view = parseOrThrow(
      aflTradeValuationViewSchema,
      snapshot.view,
      'INVALID_ELIGIBILITY_VIEW'
    );
    const projectionPublicEvidence = parseOrThrow(
      aflTradeProjectionPublicEvidenceResultSchema,
      snapshot.projectionPublicEvidence,
      'INVALID_ELIGIBILITY_EVIDENCE'
    );
    const evidenceSourceVerificationReplay = parseOrThrow(
      evidenceSourceVerificationReplaySchema,
      snapshot.evidenceSourceVerification,
      'INVALID_ELIGIBILITY_SOURCE_VERIFICATION'
    );
    const predicateFacts = parseOrThrow(
      aflTradeProjectionPublicationPredicateFactsSchema,
      snapshot.predicateFacts,
      'INVALID_ELIGIBILITY_PREDICATE_FACTS'
    );

    const evidenceSourceVerification = evidenceSourceVerificationReplay.output;
    if (!sourceVerificationMatchesEvidence(projectionPublicEvidence, evidenceSourceVerification)) {
      throw constructionError('EVIDENCE_SOURCE_VERIFICATION_MISMATCH');
    }
    if (
      !verifyAflTradeProjectionEvidenceSourceVerification({
        projectionPublicEvidenceResult: projectionPublicEvidence,
        sourceArtifacts: evidenceSourceVerificationReplay.sourceArtifacts,
        verifiedAt: evidenceSourceVerificationReplay.verifiedAt,
        output: evidenceSourceVerification,
      })
    ) {
      throw constructionError('ELIGIBILITY_SOURCE_VERIFICATION_REPLAY_FAILED');
    }
    const verification = evidenceSourceVerification.projectionEvidenceSourceVerification.content;

    for (const requiredPredicate of AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES) {
      if (
        !publicationPredicateValue(
          requiredPredicate.predicate,
          predicateFacts,
          verification.status === 'passed'
        )
      ) {
        const result = aflTradeProjectionPublicationEligibilityResultSchema.safeParse({
          view,
          status: 'ineligible',
          failedPredicate: requiredPredicate.predicate,
          failureCause: requiredPredicate.failureCause,
        });
        if (!result.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
        return deepFreeze(result.data);
      }
    }

    const result = aflTradeProjectionPublicationEligibilityResultSchema.safeParse({
      view,
      status: 'eligible',
      failedPredicate: null,
      failureCause: null,
    });
    if (!result.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    return deepFreeze(result.data);
  } catch (error) {
    if (isAflTradeProjectionPresentationPolicyConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

export function selectAflTradeProjectionUncertaintyComponents(
  input: unknown
): AflTradeProjectionUncertaintyComponentSelectionResult {
  try {
    const snapshot = snapshotExactInput(input, UNCERTAINTY_INPUT_KEYS);
    if (snapshot === null) throw constructionError('INVALID_UNCERTAINTY_INPUT_ENVELOPE');
    const policy = parseOrThrow(
      aflTradeProjectionPresentationPolicySchema,
      snapshot.policy,
      'INVALID_UNCERTAINTY_POLICY'
    );
    const result = aflTradeProjectionUncertaintyComponentSelectionResultSchema.safeParse(
      policy.content.uncertaintyComponents.mappings.map(({ component }) => ({ ...component }))
    );
    if (!result.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    return deepFreeze(result.data);
  } catch (error) {
    if (isAflTradeProjectionPresentationPolicyConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

const FACTOR_KIND_RANK = Object.freeze({ positive: 0, negative: 1, uncertainty: 2 } as const);

function compareProjectionFactors(
  left: z.infer<typeof aflTradeValueFactorSchema>,
  right: z.infer<typeof aflTradeValueFactorSchema>
): number {
  const kindOrder = FACTOR_KIND_RANK[left.kind] - FACTOR_KIND_RANK[right.kind];
  if (kindOrder !== 0) return kindOrder;
  for (const field of ['code', 'label', 'explanation'] as const) {
    const fieldOrder = compareAflTradeCodeUnits(left[field], right[field]);
    if (fieldOrder !== 0) return fieldOrder;
  }
  return 0;
}

function createProjectionPublicFactorSelection(
  viewGlobalFactors: z.infer<typeof aflTradeValueFactorSchema>[]
): AflTradeProjectionPublicFactorSelectionResult {
  const result = aflTradeProjectionPublicFactorSelectionResultSchema.safeParse({
    scope: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_SCOPE,
    viewGlobalFactors,
    canRepeatIntoPerSubjectFactors: false,
    perSubjectRepetition: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_REPETITION,
    perClubFactors: [],
    perAssetFactors: [],
  });
  if (!result.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  return deepFreeze(result.data);
}

function normalizeProjectionPublicFactors(
  factorEvidence: readonly z.infer<typeof aflTradeProjectionPublicEvidenceFactorSchema>[]
): AflTradeProjectionPublicFactorSelectionResult {
  const factors = factorEvidence.map(({ kind, code, label, explanation }) => ({
    kind,
    code,
    label,
    explanation,
  }));
  const seen = new Set<string>();
  const canonicalFactors = factors.sort(compareProjectionFactors).filter((factor) => {
    const key = canonicalizeAflTradeJson(factor);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return createProjectionPublicFactorSelection(canonicalFactors);
}

export function selectAflTradeProjectionPublicFactors(
  input: unknown
): AflTradeProjectionPublicFactorSelectionResult {
  try {
    const snapshot = snapshotExactInput(input, FACTOR_INPUT_KEYS);
    if (snapshot === null) throw constructionError('INVALID_FACTOR_INPUT_ENVELOPE');
    const view = parseOrThrow(aflTradeValuationViewSchema, snapshot.view, 'INVALID_FACTOR_VIEW');
    const projectionPublicEvidence = parseOrThrow(
      aflTradeProjectionPublicEvidenceResultSchema,
      snapshot.projectionPublicEvidence,
      'INVALID_FACTOR_PUBLIC_EVIDENCE'
    );
    const evidenceSourceVerificationReplay = parseOrThrow(
      evidenceSourceVerificationReplaySchema,
      snapshot.evidenceSourceVerification,
      'INVALID_FACTOR_SOURCE_VERIFICATION'
    );
    const evidenceSourceVerification = evidenceSourceVerificationReplay.output;
    if (!sourceVerificationMatchesEvidence(projectionPublicEvidence, evidenceSourceVerification)) {
      throw constructionError('FACTOR_EVIDENCE_SOURCE_VERIFICATION_MISMATCH');
    }
    if (
      !verifyAflTradeProjectionEvidenceSourceVerification({
        projectionPublicEvidenceResult: projectionPublicEvidence,
        sourceArtifacts: evidenceSourceVerificationReplay.sourceArtifacts,
        verifiedAt: evidenceSourceVerificationReplay.verifiedAt,
        output: evidenceSourceVerification,
      })
    ) {
      throw constructionError('FACTOR_SOURCE_VERIFICATION_REPLAY_FAILED');
    }
    if (
      evidenceSourceVerification.projectionEvidenceSourceVerification.content.status !== 'passed'
    ) {
      throw constructionError('FACTOR_SOURCE_VERIFICATION_NOT_PASSED');
    }
    const factorView = projectionPublicEvidence.projectionPublicEvidence.content.factorsByView.find(
      (candidate) => candidate.view === view
    );
    if (factorView === undefined) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    return normalizeProjectionPublicFactors(factorView.factors);
  } catch (error) {
    if (isAflTradeProjectionPresentationPolicyConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}
