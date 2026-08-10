import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';
import { aflTradePublicIdSchema } from '@/types/aflTradeIntelligence/shared';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  aflTradeValuationBundleManifestV2Schema,
  type AflTradeValuationBundleManifestV2,
} from '../artifacts/valuationBundleManifest';
import {
  aflTradeJointOutcomeBoundsSchema,
  aflTradeJointOutcomeProbabilitiesSchema,
} from './jointOutcomeComparison';
import {
  aflTradeValuationComparisonMeasureSchema,
  aflTradeValuationComparisonSchema,
  verifyAflTradeValuationComparisonCaseCalculationDerivation,
  type AflTradeValuationComparison,
  type AflTradeValuationComparisonMeasure,
} from './jointOutcomeComparisonArtifact';
import {
  aflTradeStructuralWeightedDistributionEventBoundsSchema,
  aflTradeStructuralWeightedDistributionEventProbabilitiesSchema,
  aflTradeStructuralWeightedDistributionStatisticsSchema,
} from './structuralWeightedDistributionContracts';
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

export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_SCHEMA_VERSION =
  'afl-trade-structured-explanation/v2' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_PUBLIC_ASSET_BOUNDARY =
  'source_native_afl_assets_no_user_or_fantasy_ownership' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_SOURCE_OF_TRUTH =
  'fixed_templates_bound_to_replay_verified_distribution_and_comparison_artifacts_v1' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_NUMERICAL_CLAIM_PARITY =
  'exact_structured_values_from_named_source_artifacts_v1' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_UNCONSTRAINED_GENERATIVE_CLAIMS =
  'prohibited' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_CONFIDENCE_TREATMENT =
  'no_confidence_claims_requires_separate_approved_confidence_evidence_v1' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_COVERAGE_TREATMENT =
  'probability_missingness_is_not_asset_coverage_or_confidence_v1' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_VERIFICATION_SCOPE =
  'explanation_to_bundle_case_calculation_and_numeric_artifact_replay_only_upstream_provenance_requires_separate_validation_v1' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_SOURCE_SET_DIGEST_DEFINITION =
  'canonical_ordered_distribution_and_comparison_bindings_sha256_v1' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_PREDECESSOR_POLICY_DEFINITION =
  'parallel_predecessors_are_audit_only_no_implicit_conversion_v1' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_PREDECESSOR_COMPATIBILITY =
  'parallel_successor_no_lossless_upcast_or_downcast_v1' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_UPCAST_TREATMENT =
  'prohibited_recompute_from_case_calculation_and_governed_successor_policies' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_DOWNCAST_TREATMENT = 'prohibited' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_RUNTIME_FALLBACK = 'prohibited' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_PUBLICATION_AUTHORITY =
  'successor_outputs_only' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_LEGACY_TREATMENT =
  'optional_audit_evidence_never_satisfies_required_output_roles' as const;
export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_LIMITATION =
  'Immutable source-independent structured explanation only; it makes no confidence claim and is not source approval, model calibration, Gate approval, or publication readiness.' as const;

const MAX_SOURCE_ARTIFACTS = 25_000;
const MAX_STATEMENTS = 25_000;
const MAX_RENDERED_TEXT_LENGTH = 32_000;
const claimKindSchema = z.enum(['assumption', 'model_estimate', 'unavailable_information']);

const predecessorPolicySchema = z
  .object({
    definitionVersion: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_PREDECESSOR_POLICY_DEFINITION),
    valuationSnapshotSetSchemaVersion: z.literal('afl-trade-valuation-snapshot-set/v1'),
    structuredExplanationSchemaVersion: z.literal('afl-trade-structured-explanation/v1'),
    compatibility: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_PREDECESSOR_COMPATIBILITY),
    upcastTreatment: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_UPCAST_TREATMENT),
    downcastTreatment: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_DOWNCAST_TREATMENT),
    runtimeFallback: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_RUNTIME_FALLBACK),
    publicationAuthority: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_PUBLICATION_AUTHORITY),
    legacyTreatment: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_LEGACY_TREATMENT),
  })
  .strict();

const distributionBindingSchema = z
  .object({
    valuationDistributionId: aflTradeContentAddressedIdSchema('valuation-distribution'),
    view: z.enum(AFL_TRADE_VALUATION_VIEWS),
    subject: aflTradeValuationDistributionSubjectSchema,
    measure: aflTradeValuationDistributionMeasureSchema,
  })
  .strict();

const comparisonBindingSchema = z
  .object({
    valuationComparisonId: aflTradeContentAddressedIdSchema('valuation-comparison'),
    view: z.enum(AFL_TRADE_VALUATION_VIEWS),
    measure: aflTradeValuationComparisonMeasureSchema,
  })
  .strict();

const sourceBindingsSchema = z
  .object({
    digestDefinition: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_SOURCE_SET_DIGEST_DEFINITION),
    distributions: z.array(distributionBindingSchema).min(1).max(MAX_SOURCE_ARTIFACTS),
    comparisons: z.array(comparisonBindingSchema).length(12),
    sourceSetSha256: aflTradeSha256Schema,
  })
  .strict()
  .superRefine((bindings, context) => {
    const payload = {
      distributions: bindings.distributions,
      comparisons: bindings.comparisons,
    };
    if (sha256AflTradeCanonicalJson(payload) !== bindings.sourceSetSha256) {
      context.addIssue({
        code: 'custom',
        path: ['sourceSetSha256'],
        message: 'The explanation source-set digest must authenticate its canonical bindings.',
      });
    }
    const distributionIds = bindings.distributions.map(
      (binding) => binding.valuationDistributionId
    );
    if (new Set(distributionIds).size !== distributionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['distributions'],
        message: 'Distribution source bindings must use unique artifact identities.',
      });
    }
    const comparisonIds = bindings.comparisons.map((binding) => binding.valuationComparisonId);
    if (new Set(comparisonIds).size !== comparisonIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['comparisons'],
        message: 'Comparison source bindings must use unique artifact identities.',
      });
    }
  });

const statementBaseShape = {
  statementId: aflTradePublicIdSchema,
  renderedText: z.string().trim().min(1).max(MAX_RENDERED_TEXT_LENGTH),
} as const;

const assumptionStatementSchema = z
  .object({
    ...statementBaseShape,
    template: z.literal('definition_assumption'),
    claimKind: z.literal('assumption'),
    reasonCode: z.enum([
      'low_return_definition_assumption',
      'elite_outcome_definition_assumption',
      'practical_equivalence_definition_assumption',
    ]),
    definitionName: z.enum(['low return', 'elite outcome', 'practical equivalence']),
    definitionArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const canonicalAssumptionDefinitions = [
  {
    reasonCode: 'low_return_definition_assumption',
    definitionName: 'low return',
  },
  {
    reasonCode: 'elite_outcome_definition_assumption',
    definitionName: 'elite outcome',
  },
  {
    reasonCode: 'practical_equivalence_definition_assumption',
    definitionName: 'practical equivalence',
  },
] as const;

const distributionStatementBaseShape = {
  ...statementBaseShape,
  valuationDistributionId: aflTradeContentAddressedIdSchema('valuation-distribution'),
  aflClubId: aflTradePublicIdSchema,
  clubName: z.string().trim().min(1).max(120),
  view: z.enum(AFL_TRADE_VALUATION_VIEWS),
  subject: aflTradeValuationDistributionSubjectSchema,
  measure: aflTradeValuationDistributionMeasureSchema,
  availableProbabilityMass: z.number().finite().min(0).max(1),
  unavailableProbabilityMass: z.number().finite().min(0).max(1),
} as const;

const completeDistributionStatementSchema = z
  .object({
    ...distributionStatementBaseShape,
    template: z.literal('distribution_complete'),
    claimKind: z.literal('model_estimate'),
    reasonCode: z.literal('complete_universal_distribution'),
    status: z.literal('complete'),
    availableProbabilityMass: z.literal(1),
    unavailableProbabilityMass: z.literal(0),
    statistics: aflTradeStructuralWeightedDistributionStatisticsSchema,
    eventProbabilities: aflTradeStructuralWeightedDistributionEventProbabilitiesSchema,
  })
  .strict();

const partialDistributionStatementSchema = z
  .object({
    ...distributionStatementBaseShape,
    template: z.literal('distribution_partial'),
    claimKind: z.literal('unavailable_information'),
    reasonCode: z.literal('partial_universal_distribution'),
    status: z.literal('partial'),
    conditionalOnAvailableStatistics: aflTradeStructuralWeightedDistributionStatisticsSchema,
    conditionalOnAvailableEventProbabilities:
      aflTradeStructuralWeightedDistributionEventProbabilitiesSchema,
    unconditionalEventProbabilityBounds: aflTradeStructuralWeightedDistributionEventBoundsSchema,
    unavailableReasonCodes: z.array(aflTradePublicIdSchema).min(1).max(100),
  })
  .strict();

const unavailableDistributionStatementSchema = z
  .object({
    ...distributionStatementBaseShape,
    template: z.literal('distribution_unavailable'),
    claimKind: z.literal('unavailable_information'),
    reasonCode: z.literal('unavailable_universal_distribution'),
    status: z.literal('unavailable'),
    availableProbabilityMass: z.literal(0),
    unavailableProbabilityMass: z.literal(1),
    unconditionalEventProbabilityBounds: aflTradeStructuralWeightedDistributionEventBoundsSchema,
    unavailableReasonCodes: z.array(aflTradePublicIdSchema).min(1).max(100),
  })
  .strict();

const comparisonStatementBaseShape = {
  ...statementBaseShape,
  valuationComparisonId: aflTradeContentAddressedIdSchema('valuation-comparison'),
  view: z.enum(AFL_TRADE_VALUATION_VIEWS),
  measure: aflTradeValuationComparisonMeasureSchema,
  clearLeaderToleranceQuanta: z.number().int().safe().nonnegative(),
  availableProbabilityMass: z.number().finite().min(0).max(1),
  unavailableProbabilityMass: z.number().finite().min(0).max(1),
} as const;

const availableComparisonStatementSchema = z
  .object({
    ...comparisonStatementBaseShape,
    template: z.literal('joint_comparison_available'),
    claimKind: z.literal('model_estimate'),
    reasonCode: z.literal('complete_joint_clear_leader_comparison'),
    status: z.literal('available'),
    availableProbabilityMass: z.literal(1),
    unavailableProbabilityMass: z.literal(0),
    probabilities: aflTradeJointOutcomeProbabilitiesSchema,
  })
  .strict();

const unavailableComparisonStatementSchema = z
  .object({
    ...comparisonStatementBaseShape,
    template: z.literal('joint_comparison_unavailable'),
    claimKind: z.literal('unavailable_information'),
    reasonCode: z.literal('incomplete_joint_clear_leader_comparison'),
    status: z.literal('unavailable'),
    conditionalOnAvailableProbabilities: aflTradeJointOutcomeProbabilitiesSchema.nullable(),
    unconditionalBounds: aflTradeJointOutcomeBoundsSchema,
    unavailableReasonCodes: z.array(aflTradePublicIdSchema).min(1).max(100),
  })
  .strict();

export const aflTradeStructuredExplanationV2StatementSchema = z.discriminatedUnion('template', [
  assumptionStatementSchema,
  completeDistributionStatementSchema,
  partialDistributionStatementSchema,
  unavailableDistributionStatementSchema,
  availableComparisonStatementSchema,
  unavailableComparisonStatementSchema,
]);

export type AflTradeStructuredExplanationV2Statement = z.infer<
  typeof aflTradeStructuredExplanationV2StatementSchema
>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K & keyof T> : never;
type ExplanationStatementSource = DistributiveOmit<
  AflTradeStructuredExplanationV2Statement,
  'renderedText'
>;
type ExplanationStatementInput = DistributiveOmit<
  AflTradeStructuredExplanationV2Statement,
  'statementId' | 'renderedText'
>;

function formatNumber(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}

function formatProbability(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

function layerLabel(measure: AflTradeValuationDistributionMeasure): string {
  if (measure.kind !== 'universal_football_value') return 'club utility';
  return measure.layer.replaceAll('_', ' ');
}

function subjectLabel(subject: AflTradeValuationDistributionSubject, clubName: string): string {
  return subject.kind === 'afl_club_received_package'
    ? `${clubName}'s received package`
    : `${subject.rootAssetId}, received by ${clubName}`;
}

function formatClubProbabilities(
  probabilities: z.infer<typeof aflTradeJointOutcomeProbabilitiesSchema>
): string {
  const clubs = probabilities.clubClearLeaderProbabilities
    .map((entry) => `${entry.aflClubId} ${formatProbability(entry.probability)}`)
    .join(', ');
  return `${clubs}; no clear leader ${formatProbability(probabilities.noClearLeaderProbability)}`;
}

function formatBounds(bounds: z.infer<typeof aflTradeJointOutcomeBoundsSchema>): string {
  const clubs = bounds.clubClearLeaderBounds
    .map(
      (bound) =>
        `${bound.aflClubId} [${formatProbability(bound.lower)}, ${formatProbability(bound.upper)}]`
    )
    .join(', ');
  return `${clubs}; no clear leader [${formatProbability(bounds.noClearLeaderBounds.lower)}, ${formatProbability(bounds.noClearLeaderBounds.upper)}]`;
}

export function renderAflTradeStructuredExplanationV2Statement(
  statement: ExplanationStatementSource
): string {
  switch (statement.template) {
    case 'definition_assumption':
      return `The ${statement.definitionName} definition is governed by immutable artifact ${statement.definitionArtifact.artifactId}.`;
    case 'distribution_complete':
      return `${subjectLabel(statement.subject, statement.clubName)} has a complete ${statement.view.replaceAll('_', ' ')} ${layerLabel(statement.measure)} universal distribution: mean ${formatNumber(statement.statistics.mean)}, median ${formatNumber(statement.statistics.median)}, P10 ${formatNumber(statement.statistics.downside.value)}, P90 ${formatNumber(statement.statistics.upside.value)}, low-return probability ${formatProbability(statement.eventProbabilities.lowReturnProbability)}, and elite-outcome probability ${formatProbability(statement.eventProbabilities.eliteOutcomeProbability)}.`;
    case 'distribution_partial':
      return `${subjectLabel(statement.subject, statement.clubName)} has an incomplete ${statement.view.replaceAll('_', ' ')} ${layerLabel(statement.measure)} universal distribution with ${formatProbability(statement.availableProbabilityMass)} available and ${formatProbability(statement.unavailableProbabilityMass)} unavailable probability mass. No unconditional point statistic is claimed. Conditional on available draws only: mean ${formatNumber(statement.conditionalOnAvailableStatistics.mean)}, median ${formatNumber(statement.conditionalOnAvailableStatistics.median)}, P10 ${formatNumber(statement.conditionalOnAvailableStatistics.downside.value)}, and P90 ${formatNumber(statement.conditionalOnAvailableStatistics.upside.value)}. Unconditional low-return bounds are [${formatProbability(statement.unconditionalEventProbabilityBounds.lowReturn.lower)}, ${formatProbability(statement.unconditionalEventProbabilityBounds.lowReturn.upper)}] and elite-outcome bounds are [${formatProbability(statement.unconditionalEventProbabilityBounds.eliteOutcome.lower)}, ${formatProbability(statement.unconditionalEventProbabilityBounds.eliteOutcome.upper)}]. Unavailable because: ${statement.unavailableReasonCodes.join(', ')}.`;
    case 'distribution_unavailable':
      return `${subjectLabel(statement.subject, statement.clubName)} has no available ${statement.view.replaceAll('_', ' ')} ${layerLabel(statement.measure)} universal distribution. No unconditional or conditional point statistic is claimed. Unconditional low-return bounds are [${formatProbability(statement.unconditionalEventProbabilityBounds.lowReturn.lower)}, ${formatProbability(statement.unconditionalEventProbabilityBounds.lowReturn.upper)}] and elite-outcome bounds are [${formatProbability(statement.unconditionalEventProbabilityBounds.eliteOutcome.lower)}, ${formatProbability(statement.unconditionalEventProbabilityBounds.eliteOutcome.upper)}]. Unavailable because: ${statement.unavailableReasonCodes.join(', ')}.`;
    case 'joint_comparison_available':
      return `The complete ${statement.view.replaceAll('_', ' ')} ${layerLabel(statement.measure)} joint comparison, using a clear-leader tolerance of ${statement.clearLeaderToleranceQuanta} quanta, reports: ${formatClubProbabilities(statement.probabilities)}.`;
    case 'joint_comparison_unavailable':
      return statement.conditionalOnAvailableProbabilities === null
        ? `The ${statement.view.replaceAll('_', ' ')} ${layerLabel(statement.measure)} joint comparison has no available draws. No unconditional or conditional point probability is claimed. Unconditional bounds are: ${formatBounds(statement.unconditionalBounds)}. Unavailable because: ${statement.unavailableReasonCodes.join(', ')}.`
        : `The ${statement.view.replaceAll('_', ' ')} ${layerLabel(statement.measure)} joint comparison has ${formatProbability(statement.availableProbabilityMass)} available and ${formatProbability(statement.unavailableProbabilityMass)} unavailable probability mass. No unconditional point probability is claimed. Conditional on available draws only: ${formatClubProbabilities(statement.conditionalOnAvailableProbabilities)}. Unconditional bounds are: ${formatBounds(statement.unconditionalBounds)}. Unavailable because: ${statement.unavailableReasonCodes.join(', ')}.`;
  }
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function bindingCoordinate(binding: {
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number];
  subject?: AflTradeValuationDistributionSubject;
  measure: AflTradeValuationDistributionMeasure | AflTradeValuationComparisonMeasure;
}): string {
  return canonicalizeAflTradeJson({
    view: binding.view,
    ...(binding.subject === undefined ? {} : { subject: binding.subject }),
    measure: binding.measure,
  });
}

export const aflTradeStructuredExplanationV2ContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_PUBLIC_ASSET_BOUNDARY),
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    lineageGraphId: aflTradeContentAddressedIdSchema('lineage-graph'),
    componentDrawSetId: aflTradeContentAddressedIdSchema('component-draw-set'),
    realizedContributionLedgerId: aflTradeContentAddressedIdSchema('realized-contribution-ledger'),
    packagePolicyId: aflTradeContentAddressedIdSchema('package-policy'),
    tradeId: aflTradePublicIdSchema,
    valueUnitId: aflTradePublicIdSchema,
    sourceOfTruth: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_SOURCE_OF_TRUTH),
    numericalClaimParity: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_NUMERICAL_CLAIM_PARITY),
    unconstrainedGenerativeClaims: z.literal(
      AFL_TRADE_STRUCTURED_EXPLANATION_V2_UNCONSTRAINED_GENERATIVE_CLAIMS
    ),
    confidenceTreatment: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_CONFIDENCE_TREATMENT),
    coverageTreatment: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_COVERAGE_TREATMENT),
    verificationScope: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_VERIFICATION_SCOPE),
    supportedClaimKinds: z.array(claimKindSchema).length(claimKindSchema.options.length),
    predecessorPolicy: predecessorPolicySchema,
    sourceBindings: sourceBindingsSchema,
    statementCount: z.number().int().positive().max(MAX_STATEMENTS),
    statements: z.array(aflTradeStructuredExplanationV2StatementSchema).min(1).max(MAX_STATEMENTS),
    limitation: z.literal(AFL_TRADE_STRUCTURED_EXPLANATION_V2_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (
      content.supportedClaimKinds.some(
        (claimKind, index) => claimKind !== claimKindSchema.options[index]
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['supportedClaimKinds'],
        message: 'Supported explanation claim kinds must use canonical order.',
      });
    }
    if (content.statementCount !== content.statements.length) {
      context.addIssue({
        code: 'custom',
        path: ['statementCount'],
        message: 'The statement count must match the immutable statement array.',
      });
    }
    for (const [index, statement] of content.statements.entries()) {
      if (statement.statementId !== `statement:${index + 1}`) {
        context.addIssue({
          code: 'custom',
          path: ['statements', index, 'statementId'],
          message: 'Explanation statements require contiguous canonical identities.',
        });
      }
      const { renderedText: _renderedText, ...source } = statement;
      if (
        statement.renderedText !==
        renderAflTradeStructuredExplanationV2Statement(source as ExplanationStatementSource)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['statements', index, 'renderedText'],
          message: 'Rendered explanation text must match its fixed structured template.',
        });
      }
    }

    canonicalAssumptionDefinitions.forEach((definition, index) => {
      const statement = content.statements[index];
      if (
        statement?.template !== 'definition_assumption' ||
        statement.reasonCode !== definition.reasonCode ||
        statement.definitionName !== definition.definitionName
      ) {
        context.addIssue({
          code: 'custom',
          path: ['statements', index],
          message: 'Explanation statements must begin with the three canonical assumptions.',
        });
      }
    });

    const distributionStart = canonicalAssumptionDefinitions.length;
    const comparisonStart = distributionStart + content.sourceBindings.distributions.length;
    const distributionStatements = content.statements.slice(distributionStart, comparisonStart);
    if (distributionStatements.length !== content.sourceBindings.distributions.length) {
      context.addIssue({
        code: 'custom',
        path: ['statements'],
        message: 'Every distribution binding must produce exactly one structured statement.',
      });
    } else {
      distributionStatements.forEach((statement, index) => {
        const binding = content.sourceBindings.distributions[index];
        if (
          (statement.template !== 'distribution_complete' &&
            statement.template !== 'distribution_partial' &&
            statement.template !== 'distribution_unavailable') ||
          statement.valuationDistributionId !== binding.valuationDistributionId ||
          bindingCoordinate(statement) !== bindingCoordinate(binding)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['statements', index + distributionStart],
            message: 'Distribution statements must follow and match canonical source bindings.',
          });
        }
      });
    }

    const comparisonStatements = content.statements.slice(comparisonStart);
    if (comparisonStatements.length !== content.sourceBindings.comparisons.length) {
      context.addIssue({
        code: 'custom',
        path: ['statements'],
        message: 'Every comparison binding must produce exactly one structured statement.',
      });
    } else {
      comparisonStatements.forEach((statement, index) => {
        const binding = content.sourceBindings.comparisons[index];
        if (
          (statement.template !== 'joint_comparison_available' &&
            statement.template !== 'joint_comparison_unavailable') ||
          statement.valuationComparisonId !== binding.valuationComparisonId ||
          bindingCoordinate(statement) !== bindingCoordinate(binding)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['statements', index + comparisonStart],
            message: 'Comparison statements must follow and match canonical source bindings.',
          });
        }
      });
    }
  });

export const aflTradeStructuredExplanationV2Schema = z
  .object({
    structuredExplanationId: aflTradeContentAddressedIdSchema('structured-explanation'),
    content: aflTradeStructuredExplanationV2ContentSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    addAflTradeContentAddressIssue(
      'structured-explanation',
      artifact.structuredExplanationId,
      artifact.content,
      context,
      ['structuredExplanationId']
    );
  });

export type AflTradeStructuredExplanationV2Content = z.infer<
  typeof aflTradeStructuredExplanationV2ContentSchema
>;
export type AflTradeStructuredExplanationV2 = z.infer<typeof aflTradeStructuredExplanationV2Schema>;

export const AFL_TRADE_STRUCTURED_EXPLANATION_V2_CONSTRUCTION_ERROR_CODES = [
  'INVALID_INPUT_ENVELOPE',
  'INVALID_VALUATION_BUNDLE_MANIFEST',
  'INVALID_VALUATION_CASE',
  'INVALID_VALUATION_CALCULATION',
  'INVALID_VALUATION_DISTRIBUTIONS',
  'INVALID_VALUATION_COMPARISONS',
  'PARENT_LINEAGE_MISMATCH',
  'INCOMPLETE_DISTRIBUTION_LATTICE',
  'INCOMPLETE_COMPARISON_LATTICE',
  'DISTRIBUTION_REPLAY_FAILURE',
  'COMPARISON_REPLAY_FAILURE',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const;

export type AflTradeStructuredExplanationV2ConstructionErrorCode =
  (typeof AFL_TRADE_STRUCTURED_EXPLANATION_V2_CONSTRUCTION_ERROR_CODES)[number];

const CONSTRUCTION_ERROR_MESSAGES: Readonly<
  Record<AflTradeStructuredExplanationV2ConstructionErrorCode, string>
> = Object.freeze({
  INVALID_INPUT_ENVELOPE: 'The structured-explanation v2 input envelope is invalid.',
  INVALID_VALUATION_BUNDLE_MANIFEST: 'The valuation bundle manifest is not a valid v2 manifest.',
  INVALID_VALUATION_CASE: 'The valuation case is invalid.',
  INVALID_VALUATION_CALCULATION: 'The valuation calculation is invalid.',
  INVALID_VALUATION_DISTRIBUTIONS: 'The valuation-distribution collection is invalid.',
  INVALID_VALUATION_COMPARISONS: 'The valuation-comparison collection is invalid.',
  PARENT_LINEAGE_MISMATCH:
    'The explanation inputs do not share one complete valuation parent lineage.',
  INCOMPLETE_DISTRIBUTION_LATTICE:
    'The universal valuation-distribution lattice is incomplete or contains extra coordinates.',
  INCOMPLETE_COMPARISON_LATTICE:
    'The universal valuation-comparison lattice is incomplete or contains extra coordinates.',
  DISTRIBUTION_REPLAY_FAILURE:
    'A valuation distribution failed scoped case-and-calculation replay.',
  COMPARISON_REPLAY_FAILURE: 'A valuation comparison failed scoped case-and-calculation replay.',
  INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
    'The structured-explanation v2 artifact failed its internal contract.',
});

const TRUSTED_CONSTRUCTION_ERRORS = new WeakSet<object>();

export class AflTradeStructuredExplanationV2ConstructionError extends Error {
  readonly code: AflTradeStructuredExplanationV2ConstructionErrorCode;

  constructor(code: AflTradeStructuredExplanationV2ConstructionErrorCode) {
    super(CONSTRUCTION_ERROR_MESSAGES[code]);
    this.name = 'AflTradeStructuredExplanationV2ConstructionError';
    this.code = code;
    TRUSTED_CONSTRUCTION_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeStructuredExplanationV2ConstructionError';
    code: AflTradeStructuredExplanationV2ConstructionErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeStructuredExplanationV2ConstructionError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeStructuredExplanationV2ConstructionError(
  value: unknown
): value is AflTradeStructuredExplanationV2ConstructionError {
  return value !== null && typeof value === 'object' && TRUSTED_CONSTRUCTION_ERRORS.has(value);
}

export interface CreateAflTradeStructuredExplanationV2Input {
  valuationBundleManifest: unknown;
  valuationCase: unknown;
  valuationCalculation: unknown;
  valuationDistributions: unknown;
  valuationComparisons: unknown;
}

const CREATE_INPUT_KEYS = [
  'valuationBundleManifest',
  'valuationCase',
  'valuationCalculation',
  'valuationDistributions',
  'valuationComparisons',
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

function constructionError(
  code: AflTradeStructuredExplanationV2ConstructionErrorCode
): AflTradeStructuredExplanationV2ConstructionError {
  return new AflTradeStructuredExplanationV2ConstructionError(code);
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeStructuredExplanationV2ConstructionErrorCode
): T {
  try {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
  } catch {
    // Hostile input failures are deliberately replaced with stable public errors.
  }
  throw constructionError(code);
}

const universalMeasures: readonly AflTradeValuationDistributionMeasure[] = [
  { kind: 'universal_football_value', layer: 'gross' },
  { kind: 'universal_football_value', layer: 'list_spot_adjusted' },
  { kind: 'universal_football_value', layer: 'scarcity_adjusted' },
];

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

function expectedDistributionCoordinates(valuationCase: AflTradeValuationCase): Array<{
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number];
  subject: AflTradeValuationDistributionSubject;
  measure: AflTradeValuationDistributionMeasure;
}> {
  const subjects = expectedSubjects(valuationCase);
  return AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    universalMeasures.flatMap((measure) => subjects.map((subject) => ({ view, subject, measure })))
  );
}

function expectedComparisonCoordinates(): Array<{
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number];
  measure: AflTradeValuationComparisonMeasure;
}> {
  return AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    universalMeasures.map((measure) => ({
      view,
      measure: measure as AflTradeValuationComparisonMeasure,
    }))
  );
}

function canonicalizeDistributionLattice(
  valuationCase: AflTradeValuationCase,
  distributions: readonly AflTradeValuationDistribution[]
): AflTradeValuationDistribution[] {
  const expected = expectedDistributionCoordinates(valuationCase);
  if (distributions.length !== expected.length) {
    throw constructionError('INCOMPLETE_DISTRIBUTION_LATTICE');
  }
  const byCoordinate = new Map<string, AflTradeValuationDistribution>();
  for (const distribution of distributions) {
    if (distribution.content.measure.kind !== 'universal_football_value') {
      throw constructionError('INCOMPLETE_DISTRIBUTION_LATTICE');
    }
    const coordinate = bindingCoordinate({
      view: distribution.content.viewContext.view,
      subject: distribution.content.subject,
      measure: distribution.content.measure,
    });
    if (byCoordinate.has(coordinate)) {
      throw constructionError('INCOMPLETE_DISTRIBUTION_LATTICE');
    }
    byCoordinate.set(coordinate, distribution);
  }
  return expected.map((coordinate) => {
    const distribution = byCoordinate.get(bindingCoordinate(coordinate));
    if (!distribution) throw constructionError('INCOMPLETE_DISTRIBUTION_LATTICE');
    return distribution;
  });
}

function canonicalizeComparisonLattice(
  comparisons: readonly AflTradeValuationComparison[]
): AflTradeValuationComparison[] {
  const expected = expectedComparisonCoordinates();
  if (comparisons.length !== expected.length) {
    throw constructionError('INCOMPLETE_COMPARISON_LATTICE');
  }
  const byCoordinate = new Map<string, AflTradeValuationComparison>();
  for (const comparison of comparisons) {
    const coordinate = bindingCoordinate({
      view: comparison.content.viewContext.view,
      measure: comparison.content.measure,
    });
    if (byCoordinate.has(coordinate)) {
      throw constructionError('INCOMPLETE_COMPARISON_LATTICE');
    }
    byCoordinate.set(coordinate, comparison);
  }
  return expected.map((coordinate) => {
    const comparison = byCoordinate.get(bindingCoordinate(coordinate));
    if (!comparison) throw constructionError('INCOMPLETE_COMPARISON_LATTICE');
    return comparison;
  });
}

function assertParentLineage(
  bundle: AflTradeValuationBundleManifestV2,
  valuationCase: AflTradeValuationCase,
  calculation: AflTradeValuationCalculation,
  distributions: readonly AflTradeValuationDistribution[],
  comparisons: readonly AflTradeValuationComparison[]
): void {
  if (
    valuationCase.content.valuationBundleId !== bundle.valuationBundleId ||
    calculation.content.valuationCaseId !== valuationCase.valuationCaseId ||
    calculation.content.valuationBundleId !== bundle.valuationBundleId ||
    calculation.content.componentDrawSetId !== valuationCase.content.componentDrawSetId ||
    calculation.content.realizedContributionLedgerId !==
      valuationCase.content.realizedContributionLedgerId ||
    calculation.content.packagePolicyId !== valuationCase.content.packagePolicyId ||
    calculation.content.valueUnitId !== valuationCase.content.valueUnitId ||
    bundle.content.valueUnitId !== valuationCase.content.valueUnitId ||
    bundle.content.simulation.draws !== calculation.content.draws.length ||
    !sameCanonicalJson(bundle.content.viewContexts, valuationCase.content.viewContexts) ||
    valuationCase.content.publicAssetBoundary !==
      AFL_TRADE_STRUCTURED_EXPLANATION_V2_PUBLIC_ASSET_BOUNDARY ||
    calculation.content.publicAssetBoundary !==
      AFL_TRADE_STRUCTURED_EXPLANATION_V2_PUBLIC_ASSET_BOUNDARY ||
    bundle.content.publicAssetBoundary !== AFL_TRADE_STRUCTURED_EXPLANATION_V2_PUBLIC_ASSET_BOUNDARY
  ) {
    throw constructionError('PARENT_LINEAGE_MISMATCH');
  }

  const parentMatches = (content: {
    valuationCaseId: string;
    valuationCalculationId: string;
    valuationBundleId: string;
    lineageGraphId: string;
    componentDrawSetId: string;
    realizedContributionLedgerId: string;
    packagePolicyId: string;
    tradeId: string;
    valueUnitId: string;
  }) =>
    content.valuationCaseId === valuationCase.valuationCaseId &&
    content.valuationCalculationId === calculation.valuationCalculationId &&
    content.valuationBundleId === bundle.valuationBundleId &&
    content.lineageGraphId === valuationCase.content.lineageGraphId &&
    content.componentDrawSetId === valuationCase.content.componentDrawSetId &&
    content.realizedContributionLedgerId === valuationCase.content.realizedContributionLedgerId &&
    content.packagePolicyId === valuationCase.content.packagePolicyId &&
    content.tradeId === valuationCase.content.tradeId &&
    content.valueUnitId === valuationCase.content.valueUnitId;

  if (
    distributions.some((distribution) => !parentMatches(distribution.content)) ||
    comparisons.some((comparison) => !parentMatches(comparison.content))
  ) {
    throw constructionError('PARENT_LINEAGE_MISMATCH');
  }
}

function assertScopedReplay(
  valuationCase: AflTradeValuationCase,
  calculation: AflTradeValuationCalculation,
  distributions: readonly AflTradeValuationDistribution[],
  comparisons: readonly AflTradeValuationComparison[]
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
}

function withRenderedText(
  statement: ExplanationStatementSource
): AflTradeStructuredExplanationV2Statement {
  return {
    ...statement,
    renderedText: renderAflTradeStructuredExplanationV2Statement(statement),
  } as AflTradeStructuredExplanationV2Statement;
}

function addStatement(
  statements: AflTradeStructuredExplanationV2Statement[],
  statement: ExplanationStatementInput
): void {
  statements.push(
    withRenderedText({
      ...statement,
      statementId: `statement:${statements.length + 1}`,
    } as ExplanationStatementSource)
  );
}

function createAssumptionStatements(
  bundle: AflTradeValuationBundleManifestV2,
  statements: AflTradeStructuredExplanationV2Statement[]
): void {
  const definitionArtifacts = [
    bundle.content.simulation.lowReturnDefinitionArtifact,
    bundle.content.simulation.eliteOutcomeDefinitionArtifact,
    bundle.content.simulation.practicalEquivalenceDefinitionArtifact,
  ] as const;
  canonicalAssumptionDefinitions.forEach((assumption, index) => {
    addStatement(statements, {
      template: 'definition_assumption',
      claimKind: 'assumption',
      ...assumption,
      definitionArtifact: definitionArtifacts[index],
    });
  });
}

function createDistributionStatement(
  valuationCase: AflTradeValuationCase,
  artifact: AflTradeValuationDistribution,
  statements: AflTradeStructuredExplanationV2Statement[]
): void {
  const { distribution } = artifact.content;
  const clubName = valuationCase.content.parties.find(
    (party) => party.aflClubId === artifact.content.subject.aflClubId
  )!.clubName;
  const base = {
    valuationDistributionId: artifact.valuationDistributionId,
    aflClubId: artifact.content.subject.aflClubId,
    clubName,
    view: artifact.content.viewContext.view,
    subject: artifact.content.subject,
    measure: artifact.content.measure,
    availableProbabilityMass: distribution.availableProbabilityMass,
    unavailableProbabilityMass: distribution.unavailableProbabilityMass,
  };
  if (distribution.status === 'complete') {
    addStatement(statements, {
      ...base,
      template: 'distribution_complete',
      claimKind: 'model_estimate',
      reasonCode: 'complete_universal_distribution',
      status: 'complete',
      availableProbabilityMass: 1,
      unavailableProbabilityMass: 0,
      statistics: distribution.statistics,
      eventProbabilities: distribution.eventProbabilities,
    });
    return;
  }
  if (distribution.status === 'partial') {
    addStatement(statements, {
      ...base,
      template: 'distribution_partial',
      claimKind: 'unavailable_information',
      reasonCode: 'partial_universal_distribution',
      status: 'partial',
      conditionalOnAvailableStatistics: distribution.conditionalOnAvailableStatistics,
      conditionalOnAvailableEventProbabilities:
        distribution.conditionalOnAvailableEventProbabilities,
      unconditionalEventProbabilityBounds: distribution.unconditionalEventProbabilityBounds,
      unavailableReasonCodes: distribution.reasonCodes,
    });
    return;
  }
  addStatement(statements, {
    ...base,
    template: 'distribution_unavailable',
    claimKind: 'unavailable_information',
    reasonCode: 'unavailable_universal_distribution',
    status: 'unavailable',
    availableProbabilityMass: 0,
    unavailableProbabilityMass: 1,
    unconditionalEventProbabilityBounds: distribution.unconditionalEventProbabilityBounds,
    unavailableReasonCodes: distribution.reasonCodes,
  });
}

function createComparisonStatement(
  artifact: AflTradeValuationComparison,
  statements: AflTradeStructuredExplanationV2Statement[]
): void {
  const { comparison } = artifact.content;
  const base = {
    valuationComparisonId: artifact.valuationComparisonId,
    view: artifact.content.viewContext.view,
    measure: artifact.content.measure,
    clearLeaderToleranceQuanta: comparison.clearLeaderToleranceQuanta,
    availableProbabilityMass: comparison.availableProbabilityMass,
    unavailableProbabilityMass: comparison.unavailableProbabilityMass,
  };
  if (comparison.status === 'available') {
    addStatement(statements, {
      ...base,
      template: 'joint_comparison_available',
      claimKind: 'model_estimate',
      reasonCode: 'complete_joint_clear_leader_comparison',
      status: 'available',
      availableProbabilityMass: 1,
      unavailableProbabilityMass: 0,
      probabilities: comparison.probabilities,
    });
    return;
  }
  addStatement(statements, {
    ...base,
    template: 'joint_comparison_unavailable',
    claimKind: 'unavailable_information',
    reasonCode: 'incomplete_joint_clear_leader_comparison',
    status: 'unavailable',
    conditionalOnAvailableProbabilities: comparison.conditionalOnAvailableProbabilities,
    unconditionalBounds: comparison.unconditionalBounds,
    unavailableReasonCodes: comparison.reasonCodes,
  });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

export function createAflTradeStructuredExplanationV2(
  unparsedInput: unknown
): AflTradeStructuredExplanationV2 {
  try {
    const snapshot = snapshotExactEnvelope(unparsedInput);
    if (snapshot === null) throw constructionError('INVALID_INPUT_ENVELOPE');

    const bundle = parseOrThrow(
      aflTradeValuationBundleManifestV2Schema,
      snapshot.valuationBundleManifest,
      'INVALID_VALUATION_BUNDLE_MANIFEST'
    );
    const valuationCase = parseOrThrow(
      aflTradeValuationCaseSchema,
      snapshot.valuationCase,
      'INVALID_VALUATION_CASE'
    );
    const calculation = parseOrThrow(
      aflTradeValuationCalculationSchema,
      snapshot.valuationCalculation,
      'INVALID_VALUATION_CALCULATION'
    );
    const distributions = parseOrThrow(
      z.array(aflTradeValuationDistributionSchema).min(1).max(MAX_SOURCE_ARTIFACTS),
      snapshot.valuationDistributions,
      'INVALID_VALUATION_DISTRIBUTIONS'
    );
    const comparisons = parseOrThrow(
      z.array(aflTradeValuationComparisonSchema).length(12),
      snapshot.valuationComparisons,
      'INVALID_VALUATION_COMPARISONS'
    );

    const canonicalDistributions = canonicalizeDistributionLattice(valuationCase, distributions);
    const canonicalComparisons = canonicalizeComparisonLattice(comparisons);
    assertParentLineage(
      bundle,
      valuationCase,
      calculation,
      canonicalDistributions,
      canonicalComparisons
    );
    assertScopedReplay(valuationCase, calculation, canonicalDistributions, canonicalComparisons);

    const distributionBindings = canonicalDistributions.map((distribution) => ({
      valuationDistributionId: distribution.valuationDistributionId,
      view: distribution.content.viewContext.view,
      subject: distribution.content.subject,
      measure: distribution.content.measure,
    }));
    const comparisonBindings = canonicalComparisons.map((comparison) => ({
      valuationComparisonId: comparison.valuationComparisonId,
      view: comparison.content.viewContext.view,
      measure: comparison.content.measure,
    }));
    const sourceBindingPayload = {
      distributions: distributionBindings,
      comparisons: comparisonBindings,
    };
    const sourceBindings = {
      digestDefinition: AFL_TRADE_STRUCTURED_EXPLANATION_V2_SOURCE_SET_DIGEST_DEFINITION,
      ...sourceBindingPayload,
      sourceSetSha256: sha256AflTradeCanonicalJson(sourceBindingPayload),
    };

    const statements: AflTradeStructuredExplanationV2Statement[] = [];
    createAssumptionStatements(bundle, statements);
    canonicalDistributions.forEach((distribution) =>
      createDistributionStatement(valuationCase, distribution, statements)
    );
    canonicalComparisons.forEach((comparison) => createComparisonStatement(comparison, statements));

    const parsedContent = aflTradeStructuredExplanationV2ContentSchema.safeParse({
      schemaVersion: AFL_TRADE_STRUCTURED_EXPLANATION_V2_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_STRUCTURED_EXPLANATION_V2_PUBLIC_ASSET_BOUNDARY,
      valuationBundleId: bundle.valuationBundleId,
      valuationCaseId: valuationCase.valuationCaseId,
      valuationCalculationId: calculation.valuationCalculationId,
      lineageGraphId: valuationCase.content.lineageGraphId,
      componentDrawSetId: valuationCase.content.componentDrawSetId,
      realizedContributionLedgerId: valuationCase.content.realizedContributionLedgerId,
      packagePolicyId: valuationCase.content.packagePolicyId,
      tradeId: valuationCase.content.tradeId,
      valueUnitId: valuationCase.content.valueUnitId,
      sourceOfTruth: AFL_TRADE_STRUCTURED_EXPLANATION_V2_SOURCE_OF_TRUTH,
      numericalClaimParity: AFL_TRADE_STRUCTURED_EXPLANATION_V2_NUMERICAL_CLAIM_PARITY,
      unconstrainedGenerativeClaims:
        AFL_TRADE_STRUCTURED_EXPLANATION_V2_UNCONSTRAINED_GENERATIVE_CLAIMS,
      confidenceTreatment: AFL_TRADE_STRUCTURED_EXPLANATION_V2_CONFIDENCE_TREATMENT,
      coverageTreatment: AFL_TRADE_STRUCTURED_EXPLANATION_V2_COVERAGE_TREATMENT,
      verificationScope: AFL_TRADE_STRUCTURED_EXPLANATION_V2_VERIFICATION_SCOPE,
      supportedClaimKinds: claimKindSchema.options,
      predecessorPolicy: {
        definitionVersion: AFL_TRADE_STRUCTURED_EXPLANATION_V2_PREDECESSOR_POLICY_DEFINITION,
        valuationSnapshotSetSchemaVersion: 'afl-trade-valuation-snapshot-set/v1',
        structuredExplanationSchemaVersion: 'afl-trade-structured-explanation/v1',
        compatibility: AFL_TRADE_STRUCTURED_EXPLANATION_V2_PREDECESSOR_COMPATIBILITY,
        upcastTreatment: AFL_TRADE_STRUCTURED_EXPLANATION_V2_UPCAST_TREATMENT,
        downcastTreatment: AFL_TRADE_STRUCTURED_EXPLANATION_V2_DOWNCAST_TREATMENT,
        runtimeFallback: AFL_TRADE_STRUCTURED_EXPLANATION_V2_RUNTIME_FALLBACK,
        publicationAuthority: AFL_TRADE_STRUCTURED_EXPLANATION_V2_PUBLICATION_AUTHORITY,
        legacyTreatment: AFL_TRADE_STRUCTURED_EXPLANATION_V2_LEGACY_TREATMENT,
      },
      sourceBindings,
      statementCount: statements.length,
      statements,
      limitation: AFL_TRADE_STRUCTURED_EXPLANATION_V2_LIMITATION,
    });
    if (!parsedContent.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }

    const parsedArtifact = aflTradeStructuredExplanationV2Schema.safeParse({
      structuredExplanationId: createAflTradeContentAddress(
        'structured-explanation',
        parsedContent.data
      ),
      content: parsedContent.data,
    });
    if (!parsedArtifact.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    return deepFreeze(parsedArtifact.data);
  } catch (error) {
    if (isAflTradeStructuredExplanationV2ConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

const VERIFY_INPUT_KEYS = [
  'structuredExplanation',
  'valuationBundleManifest',
  'valuationCase',
  'valuationCalculation',
  'valuationDistributions',
  'valuationComparisons',
] as const;
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

export function verifyAflTradeStructuredExplanationV2Derivation(input: unknown): boolean {
  try {
    const snapshot = snapshotVerifyEnvelope(input);
    if (snapshot === null) return false;
    const explanation = aflTradeStructuredExplanationV2Schema.safeParse(
      snapshot.structuredExplanation
    );
    if (!explanation.success) return false;
    const replayed = createAflTradeStructuredExplanationV2({
      valuationBundleManifest: snapshot.valuationBundleManifest,
      valuationCase: snapshot.valuationCase,
      valuationCalculation: snapshot.valuationCalculation,
      valuationDistributions: snapshot.valuationDistributions,
      valuationComparisons: snapshot.valuationComparisons,
    });
    return (
      replayed.structuredExplanationId === explanation.data.structuredExplanationId &&
      canonicalizeAflTradeJson(replayed) === canonicalizeAflTradeJson(explanation.data)
    );
  } catch {
    return false;
  }
}
