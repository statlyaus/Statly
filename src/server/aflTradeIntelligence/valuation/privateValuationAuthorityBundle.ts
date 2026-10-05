import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_SCHEMA_VERSION =
  'afl-trade-private-valuation-authority-bundle/v2' as const;
export const AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_BOUNDARY =
  'private_non_production_pre_scoring_authority_configuration_no_grade_publication_or_fantasy_ownership' as const;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const isoInstantSchema = z.iso.datetime({ offset: true });

const playerComponentSchema = z
  .object({
    role: z.literal('player_contribution_and_availability'),
    candidateKind: z.literal('player_model_run_v3'),
    runId: aflTradeContentAddressedIdSchema('model-run'),
    protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
    observationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    knowledgeCutoffAt: isoInstantSchema,
    gate3DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
  })
  .strict();

const pickComponentSchema = z
  .object({
    role: z.literal('draft_pick_and_future_pick_distribution'),
    candidateKind: z.literal('pick_pav_model_candidate_v1'),
    candidateId: aflTradeContentAddressedIdSchema('pick-pav-model-candidate'),
    observationSetId: aflTradeContentAddressedIdSchema('pick-pav-observation-set'),
    observationAdmissionId: aflTradeContentAddressedIdSchema(
      'pick-pav-observation-admission'
    ),
    policyId: aflTradeContentAddressedIdSchema('pick-pav-policy'),
    knowledgeCutoffAt: isoInstantSchema,
    gate3DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
  })
  .strict();

const atTradeModelAuthoritySchema = z
  .object({
    modelVintage: z.literal('historical_restatement'),
    knowledgePolicy: z.literal('component_cutoffs_not_after_transaction_effective_at'),
    player: playerComponentSchema,
    pick: pickComponentSchema,
  })
  .strict();

const currentRemainingModelAuthoritySchema = z
  .object({
    modelVintage: z.literal('current'),
    knowledgePolicy: z.literal('component_cutoffs_not_after_current_valuation_as_of'),
    player: playerComponentSchema,
    pick: pickComponentSchema,
  })
  .strict();

const authorityReuseSchema = z
  .object({
    player: z.enum(['distinct_authorities', 'same_authority_cutoff_safe_for_both']),
    pick: z.enum(['distinct_authorities', 'same_authority_cutoff_safe_for_both']),
  })
  .strict();

const calculationPolicySchema = z
  .object({
    views: z.tuple([
      z.literal('at_trade'),
      z.literal('realized'),
      z.literal('remaining'),
      z.literal('current'),
    ]),
    calculationUnit: z.literal('complete_multi_party_trade'),
    playerScope: z.literal('receiving_club_and_exact_acquisition_spell'),
    playerHorizons: z.literal(
      'derive_all_completed_seasons_and_current_horizon_from_acquisition_spell'
    ),
    currentHorizon: z.literal('complete_or_explicitly_right_censored'),
    missingValues: z.literal('unavailable_never_zero'),
    pickCustody: z.literal(
      'stable_asset_identity_with_separate_custody_and_transformation_lineage'
    ),
    pickAttribution: z.literal('conserved_frontier_exactly_once'),
    selectedPlayerCredit: z.literal('actual_custodian_selection_and_receiving_spell'),
    aggregation: z.literal('joint_simulation_preserving_correlated_draws'),
    currentIdentity: z.literal('realized_plus_remaining_at_draw_and_summary_levels'),
    balance: z.literal('received_given_up_net_per_party_and_global_reconciliation'),
    gradeAvailability: z.literal(
      'only_when_every_asset_and_party_total_is_complete_and_balanced'
    ),
    syntheticTreatment: z.literal('structurally_separate_and_publication_prohibited'),
  })
  .strict();

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_BOUNDARY),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    valuationScopeKey: publicIdSchema,
    transactionEffectiveAt: isoInstantSchema,
    currentValuationAsOf: isoInstantSchema,
    createdAt: isoInstantSchema,
    valueUnitId: publicIdSchema,
    hpnPavMethodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    modelAuthorities: z
      .object({
        atTrade: atTradeModelAuthoritySchema,
        currentRemaining: currentRemainingModelAuthoritySchema,
      })
      .strict(),
    authorityReuse: authorityReuseSchema,
    componentCompatibilityArtifact: aflTradeArtifactRefSchema,
    jointSimulationProtocolArtifact: aflTradeArtifactRefSchema,
    gradePolicyArtifact: aflTradeArtifactRefSchema,
    calculationPolicy: calculationPolicySchema,
    gate3Authority: z.literal('requires_exact_current_component_and_bundle_decisions'),
    limitation: z.literal(
      'This immutable bundle pins candidate ancestry and calculation policy only. It grants no authority unless its component decisions and a separate decision affecting this exact bundle are current at execution time.'
    ),
  })
  .strict()
  .superRefine((bundle, context) => {
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
        message:
          'The current valuation as-of must not precede the transaction or follow bundle creation.',
      });
    }

    for (const [componentRole, component] of Object.entries(
      bundle.modelAuthorities.atTrade
    ).filter(([key]) => key === 'player' || key === 'pick')) {
      if (Date.parse((component as { knowledgeCutoffAt: string }).knowledgeCutoffAt) > transactionEffectiveAt) {
        context.addIssue({
          code: 'custom',
          path: ['modelAuthorities', 'atTrade', componentRole, 'knowledgeCutoffAt'],
          message: 'An at-trade model authority knowledge cutoff cannot follow the transaction.',
        });
      }
    }
    for (const [componentRole, component] of Object.entries(
      bundle.modelAuthorities.currentRemaining
    ).filter(([key]) => key === 'player' || key === 'pick')) {
      if (Date.parse((component as { knowledgeCutoffAt: string }).knowledgeCutoffAt) > currentValuationAsOf) {
        context.addIssue({
          code: 'custom',
          path: ['modelAuthorities', 'currentRemaining', componentRole, 'knowledgeCutoffAt'],
          message:
            'A current-remaining model authority knowledge cutoff cannot follow the valuation as-of.',
        });
      }
    }

    const atTrade = bundle.modelAuthorities.atTrade;
    const currentRemaining = bundle.modelAuthorities.currentRemaining;
    for (const role of ['player', 'pick'] as const) {
      const sameAuthority =
        JSON.stringify(atTrade[role]) === JSON.stringify(currentRemaining[role]);
      const sameRoot =
        role === 'player'
          ? atTrade.player.runId === currentRemaining.player.runId
          : atTrade.pick.candidateId === currentRemaining.pick.candidateId;
      const declaredReuse = bundle.authorityReuse[role];
      if (sameRoot !== sameAuthority) {
        context.addIssue({
          code: 'custom',
          path: ['modelAuthorities', 'currentRemaining', role],
          message:
            'A reused model root must retain the exact same ancestry, cutoff, and Gate 3 decision.',
        });
      }
      if (
        (sameAuthority && declaredReuse !== 'same_authority_cutoff_safe_for_both') ||
        (!sameAuthority && declaredReuse !== 'distinct_authorities')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['authorityReuse', role],
          message:
            'The authority reuse declaration must exactly match whether the retained component is reused.',
        });
      }
    }

    const governedComponents = [
      { role: 'player', rootId: atTrade.player.runId, gate3DecisionId: atTrade.player.gate3DecisionId },
      { role: 'pick', rootId: atTrade.pick.candidateId, gate3DecisionId: atTrade.pick.gate3DecisionId },
      { role: 'player', rootId: currentRemaining.player.runId, gate3DecisionId: currentRemaining.player.gate3DecisionId },
      { role: 'pick', rootId: currentRemaining.pick.candidateId, gate3DecisionId: currentRemaining.pick.gate3DecisionId },
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
            message: 'Distinct governed components require distinct Gate 3 decisions.',
          });
        }
      }
    }
    const policyArtifacts = [
      bundle.componentCompatibilityArtifact,
      bundle.jointSimulationProtocolArtifact,
      bundle.gradePolicyArtifact,
    ];
    if (
      policyArtifacts.some(
        (artifact) => Date.parse(artifact.createdAt) > Date.parse(bundle.createdAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'All bundle policy artifacts must exist before bundle creation.',
      });
    }
  });

export const aflTradePrivateValuationAuthorityBundleSchema = z
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

export type AflTradePrivateValuationAuthorityBundle = z.infer<
  typeof aflTradePrivateValuationAuthorityBundleSchema
>;

export function createAflTradePrivateValuationAuthorityBundle(input: {
  valuationScopeKey: string;
  transactionEffectiveAt: string;
  currentValuationAsOf: string;
  createdAt: string;
  valueUnitId: string;
  hpnPavMethodId: string;
  atTrade: {
    player: Omit<z.input<typeof playerComponentSchema>, 'role' | 'candidateKind'>;
    pick: Omit<z.input<typeof pickComponentSchema>, 'role' | 'candidateKind'>;
  };
  currentRemaining: {
    player: Omit<z.input<typeof playerComponentSchema>, 'role' | 'candidateKind'>;
    pick: Omit<z.input<typeof pickComponentSchema>, 'role' | 'candidateKind'>;
  };
  authorityReuse: z.input<typeof authorityReuseSchema>;
  componentCompatibilityArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  jointSimulationProtocolArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  gradePolicyArtifact: z.input<typeof aflTradeArtifactRefSchema>;
}): AflTradePrivateValuationAuthorityBundle {
  const content = contentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_PRIVATE_VALUATION_AUTHORITY_BUNDLE_BOUNDARY,
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    valuationScopeKey: input.valuationScopeKey,
    transactionEffectiveAt: input.transactionEffectiveAt,
    currentValuationAsOf: input.currentValuationAsOf,
    createdAt: input.createdAt,
    valueUnitId: input.valueUnitId,
    hpnPavMethodId: input.hpnPavMethodId,
    modelAuthorities: {
      atTrade: {
        modelVintage: 'historical_restatement',
        knowledgePolicy: 'component_cutoffs_not_after_transaction_effective_at',
        player: {
          role: 'player_contribution_and_availability',
          candidateKind: 'player_model_run_v3',
          ...input.atTrade.player,
        },
        pick: {
          role: 'draft_pick_and_future_pick_distribution',
          candidateKind: 'pick_pav_model_candidate_v1',
          ...input.atTrade.pick,
        },
      },
      currentRemaining: {
        modelVintage: 'current',
        knowledgePolicy: 'component_cutoffs_not_after_current_valuation_as_of',
        player: {
          role: 'player_contribution_and_availability',
          candidateKind: 'player_model_run_v3',
          ...input.currentRemaining.player,
        },
        pick: {
          role: 'draft_pick_and_future_pick_distribution',
          candidateKind: 'pick_pav_model_candidate_v1',
          ...input.currentRemaining.pick,
        },
      },
    },
    authorityReuse: input.authorityReuse,
    componentCompatibilityArtifact: input.componentCompatibilityArtifact,
    jointSimulationProtocolArtifact: input.jointSimulationProtocolArtifact,
    gradePolicyArtifact: input.gradePolicyArtifact,
    calculationPolicy: {
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
    },
    gate3Authority: 'requires_exact_current_component_and_bundle_decisions',
    limitation:
      'This immutable bundle pins candidate ancestry and calculation policy only. It grants no authority unless its component decisions and a separate decision affecting this exact bundle are current at execution time.',
  });
  return aflTradePrivateValuationAuthorityBundleSchema.parse({
    valuationBundleId: createAflTradeContentAddress('valuation-bundle', content),
    content,
  });
}
