import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_BOUNDARY,
  AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_SCHEMA_VERSION,
  aflTradePrivateValuationAuthorityBundleSchema,
  type AflTradePrivateValuationAuthorityBundle,
} from './privateValuationAuthorityBundle';

export const AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_V3_SCHEMA_VERSION =
  'afl-trade-private-valuation-authority-bundle/v3' as const;
export const AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_V3_BOUNDARY =
  'private_non_production_separated_trade_evidence_evaluation_evidence_and_model_training_authority_no_grade_publication_or_fantasy_ownership' as const;

const legacyContentSchema = aflTradePrivateValuationAuthorityBundleSchema.shape.content;
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const instantSchema = z.iso.datetime({ offset: true });

const evaluatedTradeSchema = z
  .object({
    authorityRole: z.literal('canonical_transaction_and_root_assets'),
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    sourceQualificationReportId: aflTradeContentAddressedIdSchema(
      'valuation-source-qualification'
    ),
    privateEvaluationDecisionId: aflTradeContentAddressedIdSchema(
      'private-valuation-evaluation-decision'
    ),
    transactionEventVersionId: publicIdSchema,
    canonicalMemberSetSha256: aflTradeSha256Schema,
    assetVersionIds: z.array(publicIdSchema).min(1).max(10_000),
  })
  .strict()
  .superRefine((authority, context) => {
    if (
      new Set(authority.assetVersionIds).size !== authority.assetVersionIds.length ||
      authority.assetVersionIds.some(
        (assetVersionId, index) =>
          index > 0 && authority.assetVersionIds[index - 1]! > assetVersionId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assetVersionIds'],
        message: 'Evaluated-trade asset versions must be unique and canonically ordered.',
      });
    }
  });

const evaluationEvidenceSchema = z
  .object({
    authorityRole: z.literal('realized_lineage_horizons_and_remaining_state'),
    evidenceBundleId: aflTradeContentAddressedIdSchema('valuation-evidence-bundle'),
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    corpusToCandidateLineageId: aflTradeContentAddressedIdSchema(
      'corpus-factual-lineage'
    ),
    sourceQualificationReportId: aflTradeContentAddressedIdSchema(
      'valuation-source-qualification'
    ),
    privateEvaluationDecisionId: aflTradeContentAddressedIdSchema(
      'private-valuation-evaluation-decision'
    ),
    knowledgeCutoffAt: instantSchema,
    memberSetSha256: aflTradeSha256Schema,
    tradeCorrespondenceArtifact: aflTradeArtifactRefSchema,
    gate3DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
  })
  .strict();

function legacyModelPolicyDocument(bundle: {
  valuationScopeKey: string;
  transactionEffectiveAt: string;
  currentValuationAsOf: string;
  createdAt: string;
  valueUnitId: string;
  hpnPavMethodId: string;
  modelAuthorities: AflTradePrivateValuationAuthorityBundle['content']['modelAuthorities'];
  authorityReuse: AflTradePrivateValuationAuthorityBundle['content']['authorityReuse'];
  componentCompatibilityArtifact: z.infer<typeof aflTradeArtifactRefSchema>;
  jointSimulationProtocolArtifact: z.infer<typeof aflTradeArtifactRefSchema>;
  gradePolicyArtifact: z.infer<typeof aflTradeArtifactRefSchema>;
  calculationPolicy: AflTradePrivateValuationAuthorityBundle['content']['calculationPolicy'];
}) {
  const content: AflTradePrivateValuationAuthorityBundle['content'] = {
    schemaVersion: AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_BOUNDARY,
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    valuationScopeKey: bundle.valuationScopeKey,
    transactionEffectiveAt: bundle.transactionEffectiveAt,
    currentValuationAsOf: bundle.currentValuationAsOf,
    createdAt: bundle.createdAt,
    valueUnitId: bundle.valueUnitId,
    hpnPavMethodId: bundle.hpnPavMethodId,
    modelAuthorities: bundle.modelAuthorities,
    authorityReuse: bundle.authorityReuse,
    componentCompatibilityArtifact: bundle.componentCompatibilityArtifact,
    jointSimulationProtocolArtifact: bundle.jointSimulationProtocolArtifact,
    gradePolicyArtifact: bundle.gradePolicyArtifact,
    calculationPolicy: bundle.calculationPolicy,
    gate3Authority: 'requires_exact_current_component_and_bundle_decisions',
    limitation:
      'This immutable bundle pins candidate ancestry and calculation policy only. It grants no authority unless its component decisions and a separate decision affecting this exact bundle are current at execution time.',
  };
  return {
    valuationBundleId: createAflTradeContentAddress('valuation-bundle', content),
    content,
  };
}

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_V3_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_V3_BOUNDARY),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    valuationScopeKey: publicIdSchema,
    transactionEffectiveAt: instantSchema,
    currentValuationAsOf: instantSchema,
    createdAt: instantSchema,
    valueUnitId: publicIdSchema,
    hpnPavMethodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    authorityRoles: z
      .object({
        evaluatedTrade: z.literal('canonical_transaction_and_root_assets'),
        evaluationEvidence: z.literal('realized_lineage_horizons_and_remaining_state'),
        modelTraining: z.literal('component_owned_independent_ancestry'),
      })
      .strict(),
    evaluatedTrade: evaluatedTradeSchema,
    evaluationEvidence: evaluationEvidenceSchema,
    modelAuthorities: legacyContentSchema.shape.modelAuthorities,
    authorityReuse: legacyContentSchema.shape.authorityReuse,
    componentCompatibilityArtifact: aflTradeArtifactRefSchema,
    jointSimulationProtocolArtifact: aflTradeArtifactRefSchema,
    gradePolicyArtifact: aflTradeArtifactRefSchema,
    calculationPolicy: legacyContentSchema.shape.calculationPolicy,
    gate3Authority: z.literal(
      'requires_exact_current_evaluation_evidence_component_and_bundle_decisions'
    ),
    limitation: z.literal(
      'This immutable bundle separates the evaluated trade, evaluation-time factual evidence, and independently governed model-training ancestry. It grants no scoring authority unless every named artifact and Gate 3 decision is exact and current at execution time.'
    ),
  })
  .strict()
  .superRefine((bundle, context) => {
    const legacyPolicy = aflTradePrivateValuationAuthorityBundleSchema.safeParse(
      legacyModelPolicyDocument(bundle)
    );
    if (!legacyPolicy.success) {
      for (const issue of legacyPolicy.error.issues) {
        context.addIssue({
          code: 'custom',
          path: ['modelAuthorities', ...issue.path],
          message: issue.message,
        });
      }
    }
    const transactionEffectiveAt = Date.parse(bundle.transactionEffectiveAt);
    const currentValuationAsOf = Date.parse(bundle.currentValuationAsOf);
    const createdAt = Date.parse(bundle.createdAt);
    if (
      transactionEffectiveAt > currentValuationAsOf ||
      currentValuationAsOf > createdAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['currentValuationAsOf'],
        message: 'The current valuation as-of must not precede the trade or follow creation.',
      });
    }
    if (Date.parse(bundle.evaluationEvidence.knowledgeCutoffAt) > currentValuationAsOf) {
      context.addIssue({
        code: 'custom',
        path: ['evaluationEvidence', 'knowledgeCutoffAt'],
        message: 'The evaluation evidence cutoff cannot follow the current valuation as-of.',
      });
    }
    if (
      bundle.evaluatedTrade.authorityRole !== bundle.authorityRoles.evaluatedTrade ||
      bundle.evaluationEvidence.authorityRole !== bundle.authorityRoles.evaluationEvidence
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authorityRoles'],
        message: 'Each factual authority must retain its declared role.',
      });
    }
    const policyArtifacts = [
      bundle.evaluationEvidence.tradeCorrespondenceArtifact,
      bundle.componentCompatibilityArtifact,
      bundle.jointSimulationProtocolArtifact,
      bundle.gradePolicyArtifact,
    ];
    if (policyArtifacts.some((artifact) => Date.parse(artifact.createdAt) > createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'Every policy and correspondence artifact must predate bundle creation.',
      });
    }
    const governedComponents = [
      {
        role: 'evaluation_evidence',
        rootId: bundle.evaluationEvidence.evidenceBundleId,
        gate3DecisionId: bundle.evaluationEvidence.gate3DecisionId,
      },
      {
        role: 'player',
        rootId: bundle.modelAuthorities.atTrade.player.runId,
        gate3DecisionId: bundle.modelAuthorities.atTrade.player.gate3DecisionId,
      },
      {
        role: 'pick',
        rootId: bundle.modelAuthorities.atTrade.pick.candidateId,
        gate3DecisionId: bundle.modelAuthorities.atTrade.pick.gate3DecisionId,
      },
      {
        role: 'player',
        rootId: bundle.modelAuthorities.currentRemaining.player.runId,
        gate3DecisionId:
          bundle.modelAuthorities.currentRemaining.player.gate3DecisionId,
      },
      {
        role: 'pick',
        rootId: bundle.modelAuthorities.currentRemaining.pick.candidateId,
        gate3DecisionId: bundle.modelAuthorities.currentRemaining.pick.gate3DecisionId,
      },
    ];
    for (let left = 0; left < governedComponents.length; left += 1) {
      for (let right = left + 1; right < governedComponents.length; right += 1) {
        const one = governedComponents[left]!;
        const two = governedComponents[right]!;
        if (
          one.gate3DecisionId === two.gate3DecisionId &&
          (one.role !== two.role || one.rootId !== two.rootId)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['modelAuthorities'],
            message: 'Distinct governed authority roots require distinct Gate 3 decisions.',
          });
        }
      }
    }
  });

export const aflTradePrivateValuationAuthorityBundleV3Schema = z
  .object({
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    content: contentSchema,
  })
  .strict()
  .superRefine((bundle, context) => {
    addAflTradeContentAddressIssue(
      'valuation-bundle',
      bundle.valuationBundleId,
      bundle.content,
      context,
      ['valuationBundleId']
    );
  });

export type AflTradePrivateValuationAuthorityBundleV3 = z.infer<
  typeof aflTradePrivateValuationAuthorityBundleV3Schema
>;

type LegacyModelAuthorities = AflTradePrivateValuationAuthorityBundle['content']['modelAuthorities'];

export function createAflTradePrivateValuationAuthorityBundleV3(input: {
  valuationScopeKey: string;
  transactionEffectiveAt: string;
  currentValuationAsOf: string;
  createdAt: string;
  valueUnitId: string;
  hpnPavMethodId: string;
  evaluatedTrade: Omit<z.input<typeof evaluatedTradeSchema>, 'authorityRole'>;
  evaluationEvidence: Omit<z.input<typeof evaluationEvidenceSchema>, 'authorityRole'>;
  atTrade: LegacyModelAuthorities['atTrade'];
  currentRemaining: LegacyModelAuthorities['currentRemaining'];
  authorityReuse: AflTradePrivateValuationAuthorityBundle['content']['authorityReuse'];
  componentCompatibilityArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  jointSimulationProtocolArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  gradePolicyArtifact: z.input<typeof aflTradeArtifactRefSchema>;
}): AflTradePrivateValuationAuthorityBundleV3 {
  const calculationPolicy: AflTradePrivateValuationAuthorityBundle['content']['calculationPolicy'] = {
    views: ['at_trade', 'realized', 'remaining', 'current'],
    calculationUnit: 'complete_multi_party_trade',
    playerScope: 'receiving_club_and_exact_acquisition_spell',
    playerHorizons:
      'derive_all_completed_seasons_and_current_horizon_from_acquisition_spell',
    currentHorizon: 'complete_or_explicitly_right_censored',
    missingValues: 'unavailable_never_zero',
    pickCustody: 'stable_asset_identity_with_separate_custody_and_transformation_lineage',
    pickAttribution: 'conserved_frontier_exactly_once',
    selectedPlayerCredit: 'actual_custodian_selection_and_receiving_spell',
    aggregation: 'joint_simulation_preserving_correlated_draws',
    currentIdentity: 'realized_plus_remaining_at_draw_and_summary_levels',
    balance: 'received_given_up_net_per_party_and_global_reconciliation',
    gradeAvailability: 'only_when_every_asset_and_party_total_is_complete_and_balanced',
    syntheticTreatment: 'structurally_separate_and_publication_prohibited',
  };
  const content = contentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_V3_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_V3_BOUNDARY,
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    valuationScopeKey: input.valuationScopeKey,
    transactionEffectiveAt: input.transactionEffectiveAt,
    currentValuationAsOf: input.currentValuationAsOf,
    createdAt: input.createdAt,
    valueUnitId: input.valueUnitId,
    hpnPavMethodId: input.hpnPavMethodId,
    authorityRoles: {
      evaluatedTrade: 'canonical_transaction_and_root_assets',
      evaluationEvidence: 'realized_lineage_horizons_and_remaining_state',
      modelTraining: 'component_owned_independent_ancestry',
    },
    evaluatedTrade: {
      authorityRole: 'canonical_transaction_and_root_assets',
      ...input.evaluatedTrade,
    },
    evaluationEvidence: {
      authorityRole: 'realized_lineage_horizons_and_remaining_state',
      ...input.evaluationEvidence,
    },
    modelAuthorities: {
      atTrade: input.atTrade,
      currentRemaining: input.currentRemaining,
    },
    authorityReuse: input.authorityReuse,
    componentCompatibilityArtifact: input.componentCompatibilityArtifact,
    jointSimulationProtocolArtifact: input.jointSimulationProtocolArtifact,
    gradePolicyArtifact: input.gradePolicyArtifact,
    calculationPolicy,
    gate3Authority:
      'requires_exact_current_evaluation_evidence_component_and_bundle_decisions',
    limitation:
      'This immutable bundle separates the evaluated trade, evaluation-time factual evidence, and independently governed model-training ancestry. It grants no scoring authority unless every named artifact and Gate 3 decision is exact and current at execution time.',
  });
  return aflTradePrivateValuationAuthorityBundleV3Schema.parse({
    valuationBundleId: createAflTradeContentAddress('valuation-bundle', content),
    content,
  });
}
