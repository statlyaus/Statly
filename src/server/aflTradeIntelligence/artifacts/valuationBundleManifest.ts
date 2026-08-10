import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchCanonicalJson,
} from './artifactReference';
import { addAflTradeContentAddressIssue, aflTradeContentAddressedIdSchema } from './contentAddress';

const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const playerComponentSchema = z
  .object({
    role: z.literal('player_contribution_and_availability'),
    modelKind: z.literal('player_contribution_and_availability'),
    protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    runId: aflTradeContentAddressedIdSchema('model-run'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    gate3DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
  })
  .strict();

const pickComponentSchema = z
  .object({
    role: z.literal('draft_pick_and_future_pick_distribution'),
    modelKind: z.literal('draft_pick_and_future_pick_distribution'),
    protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    runId: aflTradeContentAddressedIdSchema('model-run'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    gate3DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
  })
  .strict();

export const aflTradeValuationComponentSchema = z.discriminatedUnion('role', [
  playerComponentSchema,
  pickComponentSchema,
]);

const temporalContextShape = {
  effectiveAt: isoDateTimeSchema,
  knowledgeCutoffAt: isoDateTimeSchema,
  valuationAsOf: isoDateTimeSchema,
};

const atTradeViewContextSchema = z
  .object({
    view: z.literal('at_trade'),
    modelVintage: z.enum(['original_vintage', 'historical_restatement']),
    ...temporalContextShape,
  })
  .strict();

function currentViewContextSchema<T extends 'realized' | 'remaining' | 'current'>(view: T) {
  return z
    .object({
      view: z.literal(view),
      modelVintage: z.literal('current'),
      ...temporalContextShape,
    })
    .strict();
}

export const aflTradeValuationViewContextSchema = z.discriminatedUnion('view', [
  atTradeViewContextSchema,
  currentViewContextSchema('realized'),
  currentViewContextSchema('remaining'),
  currentViewContextSchema('current'),
]);

export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION =
  'afl-trade-valuation-output-inventory/v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_BINDING_DIRECTION =
  'detached_inventory_references_bundle_and_descendants' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_GRANULARITY =
  'one_root_inventory_per_valuation_case' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DISTRIBUTION_PARTITIONING =
  'bounded_view_measure_shards' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SEMANTIC_BINDING =
  'semantic_content_id_paired_with_immutable_byte_reference' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_REQUIREMENT =
  'required_before_publication' as const;

const valuationOutputInventoryContractPayloadShape = {
  inventorySchemaVersion: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION),
  bindingDirection: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_BINDING_DIRECTION),
  granularity: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_GRANULARITY),
  distributionPartitioning: z.literal(
    AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DISTRIBUTION_PARTITIONING
  ),
  semanticBinding: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SEMANTIC_BINDING),
  publicationRequirement: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_REQUIREMENT),
} as const;

export const aflTradeValuationOutputInventoryContractPayloadSchema = z
  .object(valuationOutputInventoryContractPayloadShape)
  .strict();

export const aflTradeValuationOutputInventoryContractSchema = z
  .object({
    ...valuationOutputInventoryContractPayloadShape,
    contractArtifact: aflTradeArtifactRefSchema,
  })
  .strict()
  .superRefine((contract, context) => {
    const payload = {
      inventorySchemaVersion: contract.inventorySchemaVersion,
      bindingDirection: contract.bindingDirection,
      granularity: contract.granularity,
      distributionPartitioning: contract.distributionPartitioning,
      semanticBinding: contract.semanticBinding,
      publicationRequirement: contract.publicationRequirement,
    };
    if (!doesAflTradeArtifactRefMatchCanonicalJson(contract.contractArtifact, payload)) {
      context.addIssue({
        code: 'custom',
        path: ['contractArtifact'],
        message: 'The contract artifact must authenticate the detached canonical contract payload.',
      });
    }
  });

const requiredStatisticSchema = z.enum([
  'mean',
  'median',
  'central_interval',
  'downside_quantile',
  'upside_quantile',
  'low_return_probability',
  'elite_outcome_probability',
  'club_finishes_ahead_probability',
  'data_and_model_confidence',
]);

const valuationBundleManifestContentShape = {
  environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
  scopeKey: publicIdSchema,
  valueUnitId: publicIdSchema,
  createdAt: isoDateTimeSchema,
  components: z.array(aflTradeValuationComponentSchema).length(2),
  viewContexts: z
    .array(aflTradeValuationViewContextSchema)
    .length(AFL_TRADE_VALUATION_VIEWS.length),
  packagePolicy: z
    .object({
      calculationUnit: z.literal('complete_multi_party_trade'),
      attribution: z.literal('lineage_frontier_exactly_once'),
      playerContributionCredit: z.literal('receiving_club_only_until_real_club_departure'),
      exercisedPickCredit: z.literal('selected_player_or_return_assets_without_double_counting'),
      unresolvedAssetTreatment: z.literal('exclude_with_explicit_reason_no_fallback_value'),
      aggregation: z.literal('joint_simulation_not_independent_point_sum'),
      sharedFactorTreatment: z.literal('preserve_correlated_outcomes'),
      currentOutcomeIdentity: z.literal('realized_club_value_plus_remaining_asset_value'),
      universalFootballValue: z.literal('always_visible'),
      clubUtilityTreatment: z.literal('separate_optional_view'),
      contractValueTreatment: z.literal('separate_or_explicitly_unavailable'),
      commercialValueTreatment: z.literal('separate_or_explicitly_unavailable'),
      listSpotPolicyArtifact: aflTradeArtifactRefSchema,
      scarcityPolicyArtifact: aflTradeArtifactRefSchema,
      roleCongestionPolicyArtifact: aflTradeArtifactRefSchema,
    })
    .strict(),
  simulation: z
    .object({
      draws: z.number().int().positive(),
      seed: z.number().int().nonnegative(),
      centralIntervalLevel: z.literal(0.8),
      downsideQuantile: z.literal(0.1),
      upsideQuantile: z.literal(0.9),
      lowReturnDefinitionArtifact: aflTradeArtifactRefSchema,
      eliteOutcomeDefinitionArtifact: aflTradeArtifactRefSchema,
      practicalEquivalenceDefinitionArtifact: aflTradeArtifactRefSchema,
      requiredStatistics: z.array(requiredStatisticSchema).length(9),
    })
    .strict(),
  explanationPolicy: z
    .object({
      sourceOfTruth: z.literal('structured_reason_codes_and_measured_factors'),
      unconstrainedGenerativeClaims: z.literal('prohibited'),
      numericalClaimParity: z.literal('required'),
      requiredDistinctions: z
        .array(
          z.enum([
            'measured_fact',
            'model_estimate',
            'assumption',
            'unavailable_information',
            'low_confidence_output',
          ])
        )
        .length(5),
      legacyValueTreatment: z.literal('separate_source_metric_never_relabelled_statly_value'),
    })
    .strict(),
  execution: z
    .object({
      codeCommitSha: gitCommitSchema,
      cleanWorktree: z.literal(true),
      jobId: publicIdSchema,
      attempt: z.number().int().positive(),
      initiatedBy: publicIdSchema,
      workerIdentity: publicIdSchema,
      startedAt: isoDateTimeSchema,
      finishedAt: isoDateTimeSchema,
      sourceCodeArtifact: aflTradeArtifactRefSchema,
      dependencyLockArtifact: aflTradeArtifactRefSchema,
      runtimeArtifact: aflTradeArtifactRefSchema,
      configurationArtifact: aflTradeArtifactRefSchema,
    })
    .strict(),
  outputs: z
    .object({
      immutableSnapshotsArtifact: aflTradeArtifactRefSchema,
      simulationDrawsArtifact: aflTradeArtifactRefSchema,
      attributionInvariantReportArtifact: aflTradeArtifactRefSchema,
      deterministicReplayReportArtifact: aflTradeArtifactRefSchema,
      explanationParityReportArtifact: aflTradeArtifactRefSchema,
      coverageAndExclusionReportArtifact: aflTradeArtifactRefSchema,
      confidenceReportArtifact: aflTradeArtifactRefSchema,
      sensitivityReportArtifact: aflTradeArtifactRefSchema,
      validationReportArtifact: aflTradeArtifactRefSchema,
      modelCardArtifact: aflTradeArtifactRefSchema,
    })
    .strict(),
  limitations: z.array(z.string().trim().min(1).max(1_000)).min(1).max(100),
} as const;

const _valuationBundleManifestCommonContentSchema = z
  .object(valuationBundleManifestContentShape)
  .strict();

function addValuationBundleManifestContentIssues(
  bundle: z.infer<typeof _valuationBundleManifestCommonContentSchema>,
  context: z.RefinementCtx
): void {
  const componentRoles = bundle.components.map((component) => component.role);
  if (
    new Set(componentRoles).size !== componentRoles.length ||
    !componentRoles.includes('player_contribution_and_availability') ||
    !componentRoles.includes('draft_pick_and_future_pick_distribution')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['components'],
      message: 'A valuation bundle requires each governed model component exactly once.',
    });
  }
  for (const field of ['protocolId', 'runId'] as const) {
    const identifiers = bundle.components.map((component) => component[field]);
    if (new Set(identifiers).size !== identifiers.length) {
      context.addIssue({
        code: 'custom',
        path: ['components'],
        message: `Valuation component ${field} values must be distinct.`,
      });
    }
  }

  const views = bundle.viewContexts.map((viewContext) => viewContext.view);
  if (
    new Set(views).size !== views.length ||
    AFL_TRADE_VALUATION_VIEWS.some((view) => !views.includes(view))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['viewContexts'],
      message: 'A valuation bundle requires each valuation view exactly once.',
    });
  }
  for (const [index, viewContext] of bundle.viewContexts.entries()) {
    const effectiveAt = Date.parse(viewContext.effectiveAt);
    const knowledgeCutoffAt = Date.parse(viewContext.knowledgeCutoffAt);
    const valuationAsOf = Date.parse(viewContext.valuationAsOf);
    if (effectiveAt > valuationAsOf || knowledgeCutoffAt > valuationAsOf) {
      context.addIssue({
        code: 'custom',
        path: ['viewContexts', index],
        message: 'Effective and knowledge-cutoff times cannot follow the valuation as-of time.',
      });
    }
    if (viewContext.view === 'at_trade' && knowledgeCutoffAt > effectiveAt) {
      context.addIssue({
        code: 'custom',
        path: ['viewContexts', index, 'knowledgeCutoffAt'],
        message: 'At-trade valuation cannot use information learned after the trade.',
      });
    }
    if (Date.parse(bundle.execution.startedAt) < valuationAsOf) {
      context.addIssue({
        code: 'custom',
        path: ['execution', 'startedAt'],
        message: 'Bundle execution cannot precede a valuation as-of time.',
      });
    }
  }

  const currentContexts = bundle.viewContexts.filter(
    (viewContext) => viewContext.view !== 'at_trade'
  );
  const currentTemporalKeys = currentContexts.map(
    (viewContext) =>
      `${viewContext.effectiveAt}|${viewContext.knowledgeCutoffAt}|${viewContext.valuationAsOf}`
  );
  if (new Set(currentTemporalKeys).size !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['viewContexts'],
      message: 'Realized, remaining, and current views must share one temporal context.',
    });
  }

  const statistics = bundle.simulation.requiredStatistics;
  if (
    new Set(statistics).size !== statistics.length ||
    requiredStatisticSchema.options.some((statistic) => !statistics.includes(statistic))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['simulation', 'requiredStatistics'],
      message: 'Simulation output must include every required statistic exactly once.',
    });
  }
  const distinctions = bundle.explanationPolicy.requiredDistinctions;
  if (new Set(distinctions).size !== distinctions.length) {
    context.addIssue({
      code: 'custom',
      path: ['explanationPolicy', 'requiredDistinctions'],
      message: 'Explanation distinctions must be unique.',
    });
  }
  if (
    Date.parse(bundle.execution.finishedAt) < Date.parse(bundle.execution.startedAt) ||
    Date.parse(bundle.createdAt) < Date.parse(bundle.execution.finishedAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['execution'],
      message: 'Bundle execution and creation times must be chronological.',
    });
  }
}

export const aflTradeValuationBundleManifestV1ContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-valuation-bundle/v1'),
    ...valuationBundleManifestContentShape,
    publicAssetBoundary: z.literal('source_native_afl_assets_no_fantasy_ownership'),
  })
  .strict()
  .superRefine(addValuationBundleManifestContentIssues);

export const aflTradeValuationBundleManifestV2ContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-valuation-bundle/v2'),
    ...valuationBundleManifestContentShape,
    publicAssetBoundary: z.literal('source_native_afl_assets_no_user_or_fantasy_ownership'),
    outputInventoryContract: aflTradeValuationOutputInventoryContractSchema,
  })
  .strict()
  .superRefine(addValuationBundleManifestContentIssues)
  .superRefine((bundle, context) => {
    if (
      Date.parse(bundle.outputInventoryContract.contractArtifact.createdAt) >
      Date.parse(bundle.execution.startedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outputInventoryContract', 'contractArtifact', 'createdAt'],
        message: 'The output-inventory contract artifact must exist before bundle execution.',
      });
    }
  });

export const aflTradeValuationBundleManifestContentSchema = z.discriminatedUnion('schemaVersion', [
  aflTradeValuationBundleManifestV1ContentSchema,
  aflTradeValuationBundleManifestV2ContentSchema,
]);

function addValuationBundleManifestContentAddressIssue(
  bundle: { valuationBundleId: string; content: unknown },
  context: z.RefinementCtx
): void {
  addAflTradeContentAddressIssue(
    'valuation-bundle',
    bundle.valuationBundleId,
    bundle.content,
    context,
    ['valuationBundleId']
  );
}

export const aflTradeValuationBundleManifestV1Schema = z
  .object({
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    content: aflTradeValuationBundleManifestV1ContentSchema,
  })
  .strict()
  .superRefine(addValuationBundleManifestContentAddressIssue);

export const aflTradeValuationBundleManifestV2Schema = z
  .object({
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    content: aflTradeValuationBundleManifestV2ContentSchema,
  })
  .strict()
  .superRefine(addValuationBundleManifestContentAddressIssue);

export const aflTradeValuationBundleManifestSchema = z.union([
  aflTradeValuationBundleManifestV1Schema,
  aflTradeValuationBundleManifestV2Schema,
]);

export type AflTradeValuationBundleManifestV1Content = z.infer<
  typeof aflTradeValuationBundleManifestV1ContentSchema
>;
export type AflTradeValuationBundleManifestV2Content = z.infer<
  typeof aflTradeValuationBundleManifestV2ContentSchema
>;
export type AflTradeValuationBundleManifestContent = z.infer<
  typeof aflTradeValuationBundleManifestContentSchema
>;
export type AflTradeValuationBundleManifestV1 = z.infer<
  typeof aflTradeValuationBundleManifestV1Schema
>;
export type AflTradeValuationBundleManifestV2 = z.infer<
  typeof aflTradeValuationBundleManifestV2Schema
>;

export type AflTradeValuationBundleManifest = z.infer<typeof aflTradeValuationBundleManifestSchema>;
