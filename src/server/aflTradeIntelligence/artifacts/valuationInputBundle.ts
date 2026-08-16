import { z } from 'zod';

import { aflTradeArtifactRefSchema } from './artifactReference';
import { addAflTradeContentAddressIssue, aflTradeContentAddressedIdSchema } from './contentAddress';
import { aflTradeValuationComponentSchema } from './valuationBundleManifest';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const currentViewPolicySchema = z
  .object({
    modelVintage: z.literal('current'),
    effectiveAt: isoDateTimeSchema,
    knowledgeCutoffAt: isoDateTimeSchema,
    valuationAsOf: isoDateTimeSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    const effectiveAt = Date.parse(policy.effectiveAt);
    const knowledgeCutoffAt = Date.parse(policy.knowledgeCutoffAt);
    const valuationAsOf = Date.parse(policy.valuationAsOf);
    if (effectiveAt > valuationAsOf || knowledgeCutoffAt > valuationAsOf) {
      context.addIssue({
        code: 'custom',
        message: 'Current effective and knowledge-cutoff times cannot follow valuation time.',
      });
    }
  });

const viewPolicySchema = z
  .object({
    atTrade: z
      .object({
        modelVintage: z.literal('historical_restatement'),
        knowledgeCutoff: z.literal('transaction_effective_at_exclusive'),
      })
      .strict(),
    current: currentViewPolicySchema,
    currentViewsShareOneTemporalContext: z.literal(true),
  })
  .strict();

const packagePolicySchema = z
  .object({
    calculationUnit: z.literal('complete_multi_party_trade'),
    attribution: z.literal('lineage_frontier_exactly_once'),
    aggregation: z.literal('joint_simulation_not_independent_point_sum'),
    currentOutcomeIdentity: z.literal('realized_club_value_plus_remaining_asset_value'),
    unresolvedAssetTreatment: z.literal('exclude_with_explicit_reason_no_fallback_value'),
    listSpotPolicyArtifact: aflTradeArtifactRefSchema,
    scarcityPolicyArtifact: aflTradeArtifactRefSchema,
    roleCongestionPolicyArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const simulationSchema = z
  .object({
    mode: z.literal('deterministic_counter_sample'),
    draws: z.number().int().positive().max(100_000),
    seed: publicIdSchema,
    samplingAlgorithmVersion: z.literal('counter_sha256_rejection_v1'),
    centralIntervalLevel: z.literal(0.8),
    downsideQuantile: z.literal(0.1),
    upsideQuantile: z.literal(0.9),
    lowReturnDefinitionArtifact: aflTradeArtifactRefSchema,
    eliteOutcomeDefinitionArtifact: aflTradeArtifactRefSchema,
    practicalEquivalenceDefinitionArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const artifactFields = [
  'listSpotPolicyArtifact',
  'scarcityPolicyArtifact',
  'roleCongestionPolicyArtifact',
] as const;
const simulationArtifactFields = [
  'lowReturnDefinitionArtifact',
  'eliteOutcomeDefinitionArtifact',
  'practicalEquivalenceDefinitionArtifact',
] as const;

export const AFL_TRADE_VALUATION_INPUT_BUNDLE_SCHEMA_VERSION =
  'afl-trade-valuation-input-bundle/v1' as const;

export const aflTradeValuationInputBundleContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_INPUT_BUNDLE_SCHEMA_VERSION),
    publicAssetBoundary: z.literal('source_native_afl_assets_no_user_or_fantasy_ownership'),
    environment: z.literal('non_production'),
    scopeKey: publicIdSchema,
    valueUnitId: publicIdSchema,
    createdAt: isoDateTimeSchema,
    components: z.array(aflTradeValuationComponentSchema).length(2),
    viewPolicy: viewPolicySchema,
    packagePolicy: packagePolicySchema,
    simulation: simulationSchema,
    explanationPolicyArtifact: aflTradeArtifactRefSchema,
    publicationEligible: z.literal(false),
    limitation: z.literal(
      'Approved calculation inputs only; not execution evidence, numerical validity, publication approval, or activation authority.'
    ),
  })
  .strict()
  .superRefine((bundle, context) => {
    const componentRoles = bundle.components.map(({ role }) => role);
    if (
      componentRoles[0] !== 'player_contribution_and_availability' ||
      componentRoles[1] !== 'draft_pick_and_future_pick_distribution'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'Valuation input components must contain both governed roles in canonical order.',
      });
    }

    for (const field of ['protocolId', 'runId', 'datasetId', 'gate3DecisionId'] as const) {
      const identifiers = bundle.components.map((component) => component[field]);
      if (new Set(identifiers).size !== identifiers.length) {
        context.addIssue({
          code: 'custom',
          path: ['components'],
          message: `Valuation input component ${field} values must be distinct.`,
        });
      }
    }

    const createdAt = Date.parse(bundle.createdAt);
    const artifacts = [
      ...artifactFields.map((field) => bundle.packagePolicy[field]),
      ...simulationArtifactFields.map((field) => bundle.simulation[field]),
      bundle.explanationPolicyArtifact,
    ];
    if (artifacts.some((artifact) => Date.parse(artifact.createdAt) > createdAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Every valuation input artifact must exist before the bundle is created.',
      });
    }
  });

export const aflTradeValuationInputBundleSchema = z
  .object({
    valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle'),
    content: aflTradeValuationInputBundleContentSchema,
  })
  .strict()
  .superRefine((bundle, context) => {
    addAflTradeContentAddressIssue(
      'valuation-input-bundle',
      bundle.valuationInputBundleId,
      bundle.content,
      context,
      ['valuationInputBundleId']
    );
  });

export type AflTradeValuationInputBundleContent = z.infer<
  typeof aflTradeValuationInputBundleContentSchema
>;
export type AflTradeValuationInputBundle = z.infer<typeof aflTradeValuationInputBundleSchema>;
