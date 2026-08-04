import { z } from 'zod';

import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import { aflTradeArtifactRefSchema } from './artifactReference';
import { addAflTradeContentAddressIssue, aflTradeContentAddressedIdSchema } from './contentAddress';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const boundedTextSchema = z.string().trim().min(1).max(1000);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const AFL_TRADE_PLAYER_MODEL_SUBGROUPS = [
  'era',
  'role',
  'position',
  'age',
  'availability_state',
  'evidence_quality',
] as const;

export const AFL_TRADE_PICK_MODEL_SUBGROUPS = [
  'era',
  'draft_round',
  'draft_pathway',
  'player_position',
  'age_at_draft',
  'evidence_quality',
] as const;

const temporalWindowSchema = z
  .object({ from: isoDateTimeSchema, to: isoDateTimeSchema })
  .strict()
  .superRefine((window, context) => {
    if (Date.parse(window.to) <= Date.parse(window.from)) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'Window must be non-empty.' });
    }
  });

const modelWindowsSchema = z
  .object({
    train: temporalWindowSchema,
    calibration: temporalWindowSchema,
    validation: temporalWindowSchema,
    finalTest: temporalWindowSchema,
    embargoDays: z.number().int().nonnegative(),
  })
  .strict();

function addModelWindowIssues(
  windows: z.infer<typeof modelWindowsSchema>,
  context: z.RefinementCtx
) {
  const orderedWindows = [
    windows.train,
    windows.calibration,
    windows.validation,
    windows.finalTest,
  ];
  for (let index = 1; index < orderedWindows.length; index += 1) {
    const requiredFrom =
      Date.parse(orderedWindows[index - 1].to) + windows.embargoDays * 86_400_000;
    if (Date.parse(orderedWindows[index].from) < requiredFrom) {
      context.addIssue({
        code: 'custom',
        path: ['windows'],
        message: 'Protocol windows must be chronological and respect the declared embargo.',
      });
      break;
    }
  }
}

export const aflTradePlayerContributionModelProtocolContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-model-protocol/v1'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    protocolKey: publicIdSchema,
    version: z.number().int().positive(),
    modelKind: z.literal('player_contribution_and_availability'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    preparedAt: isoDateTimeSchema,
    preparedBy: publicIdSchema,
    proposalOrigin: z.enum(['human_authored', 'agent_assisted']),
    publicIdentityBoundary: z.literal('source_native_no_fantasy_ownership'),
    estimands: z
      .array(
        z.enum([
          'at_trade_future_contribution',
          'realized_club_contribution',
          'remaining_contribution',
        ])
      )
      .min(1)
      .max(3),
    valueUnit: z
      .object({
        valueUnitId: publicIdSchema,
        label: boundedTextSchema,
        definitionArtifact: aflTradeArtifactRefSchema,
        aggregation: z.literal('additive_contribution'),
      })
      .strict(),
    footballContext: z
      .object({
        roleTaxonomyArtifact: aflTradeArtifactRefSchema,
        eraDefinitionArtifact: aflTradeArtifactRefSchema,
        roleAssignmentTiming: z.literal('as_known_at_prediction_cutoff'),
        unknownRoleTreatment: z.literal('explicit_unknown_role'),
      })
      .strict(),
    replacementBaseline: z
      .object({
        definitionArtifact: aflTradeArtifactRefSchema,
        stratification: z.literal('role_and_era'),
        estimationData: z.literal('training_partition_only'),
        validationAndTestRefit: z.literal('prohibited'),
      })
      .strict(),
    featurePolicy: z
      .object({
        knowledgeJoin: z.literal('point_in_time_as_known_at_prediction_cutoff'),
        correctionAvailability: z.literal('only_after_known_from'),
        unknownAndZero: z.literal('distinct'),
        targetDerivedFeatures: z.literal('prohibited'),
        postOutcomeFeatures: z.literal('prohibited'),
        featureAvailabilityArtifact: aflTradeArtifactRefSchema,
      })
      .strict(),
    contributionAndCensoringPolicy: z
      .object({
        clubContributionEnd: z.literal('real_club_departure_or_observation_end'),
        activeCareerTreatment: z.literal('right_censored'),
        unavailableObservationTreatmentArtifact: aflTradeArtifactRefSchema,
        censoringDefinitionArtifact: aflTradeArtifactRefSchema,
      })
      .strict(),
    windows: modelWindowsSchema,
    modelSelectionPolicy: z
      .object({
        candidateSelectionData: z.literal('train_calibration_validation_only'),
        finalTestUse: z.literal('single_evaluation_after_candidate_lock'),
        finalTestRetuning: z.literal('prohibited'),
      })
      .strict(),
    validationPlan: z
      .object({
        baselineDefinitionArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(100),
        metricDefinitionArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(100),
        intervalCalibrationArtifact: aflTradeArtifactRefSchema,
        subgroupDimensions: z
          .array(z.enum(AFL_TRADE_PLAYER_MODEL_SUBGROUPS))
          .length(AFL_TRADE_PLAYER_MODEL_SUBGROUPS.length),
        sensitivityAnalysisArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(100),
        acceptanceCriteriaArtifact: aflTradeArtifactRefSchema,
      })
      .strict(),
    limitations: z.array(boundedTextSchema).min(1).max(100),
  })
  .strict()
  .superRefine((protocol, context) => {
    if (new Set(protocol.estimands).size !== protocol.estimands.length) {
      context.addIssue({
        code: 'custom',
        path: ['estimands'],
        message: 'Model estimands must be unique.',
      });
    }
    const subgroupDimensions = protocol.validationPlan.subgroupDimensions;
    if (
      new Set(subgroupDimensions).size !== subgroupDimensions.length ||
      AFL_TRADE_PLAYER_MODEL_SUBGROUPS.some(
        (dimension) => !subgroupDimensions.includes(dimension)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validationPlan', 'subgroupDimensions'],
        message: 'Validation must cover every required player-model subgroup exactly once.',
      });
    }
    addModelWindowIssues(protocol.windows, context);
  });

export const aflTradePlayerContributionModelProtocolSchema = z
  .object({
    protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    content: aflTradePlayerContributionModelProtocolContentSchema,
  })
  .strict()
  .superRefine((protocol, context) => {
    addAflTradeContentAddressIssue(
      'model-protocol',
      protocol.protocolId,
      protocol.content,
      context,
      ['protocolId']
    );
  });

export type AflTradePlayerContributionModelProtocol = z.infer<
  typeof aflTradePlayerContributionModelProtocolSchema
>;

export const aflTradePickDistributionModelProtocolContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-model-protocol/v1'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    protocolKey: publicIdSchema,
    version: z.number().int().positive(),
    modelKind: z.literal('draft_pick_and_future_pick_distribution'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    preparedAt: isoDateTimeSchema,
    preparedBy: publicIdSchema,
    proposalOrigin: z.enum(['human_authored', 'agent_assisted']),
    publicAssetBoundary: z.literal(
      'source_native_afl_draft_entitlement_no_fantasy_ownership'
    ),
    estimands: z
      .array(z.enum(['draft_pick_outcome_distribution', 'future_pick_landing_distribution']))
      .length(2),
    valueAlignment: z
      .object({
        valueUnitId: publicIdSchema,
        playerContributionAlignmentArtifact: aflTradeArtifactRefSchema,
        aggregation: z.literal('expected_additive_contribution'),
      })
      .strict(),
    outcomeMixture: z
      .object({
        hurdleOutcomeDefinitionArtifact: aflTradeArtifactRefSchema,
        regularOutcomeDefinitionArtifact: aflTradeArtifactRefSchema,
        eliteOutcomeDefinitionArtifact: aflTradeArtifactRefSchema,
        probabilityMass: z.literal('mutually_exclusive_and_exhaustive'),
        activeCareerTreatment: z.literal('right_censored'),
      })
      .strict(),
    pickCurve: z
      .object({
        domain: z.literal('national_draft_selection_number'),
        smoother: z.literal('constrained_monotonic'),
        expectedContributionDirection: z.literal('non_increasing_with_pick_number'),
        monotonicViolations: z.literal('prohibited'),
        uncertaintyTreatment: z.literal('preserved_not_point_estimate_only'),
        extrapolationDefinitionArtifact: aflTradeArtifactRefSchema,
      })
      .strict(),
    cohortPolicy: z
      .object({
        eraDefinitionArtifact: aflTradeArtifactRefSchema,
        draftPathwayDefinitionArtifact: aflTradeArtifactRefSchema,
        incompleteCareerTreatmentArtifact: aflTradeArtifactRefSchema,
        delistedAndInactiveDefinitionArtifact: aflTradeArtifactRefSchema,
      })
      .strict(),
    futurePickSimulation: z
      .object({
        landingPositionModelArtifact: aflTradeArtifactRefSchema,
        selectionOrderRulesArtifact: aflTradeArtifactRefSchema,
        ruleVintage: z.literal('as_known_at_valuation_cutoff'),
        timeDelayDefinitionArtifact: aflTradeArtifactRefSchema,
        correlatedLadderOutcomeArtifact: aflTradeArtifactRefSchema,
        simulationDraws: z.number().int().positive(),
        randomSeedPolicy: z.literal('model_run_manifest_seed'),
        landingCalibration: z.literal('held_out_temporal_seasons'),
        scenarioSensitivityArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(100),
      })
      .strict(),
    featurePolicy: z
      .object({
        knowledgeJoin: z.literal('point_in_time_as_known_at_valuation_cutoff'),
        correctionAvailability: z.literal('only_after_known_from'),
        unknownAndZero: z.literal('distinct'),
        postOutcomeFeatures: z.literal('prohibited'),
        featureAvailabilityArtifact: aflTradeArtifactRefSchema,
      })
      .strict(),
    windows: modelWindowsSchema,
    modelSelectionPolicy: z
      .object({
        candidateSelectionData: z.literal('train_calibration_validation_only'),
        finalTestUse: z.literal('single_evaluation_after_candidate_lock'),
        finalTestRetuning: z.literal('prohibited'),
      })
      .strict(),
    validationPlan: z
      .object({
        baselineDefinitionArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(100),
        metricDefinitionArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(100),
        probabilityCalibrationArtifact: aflTradeArtifactRefSchema,
        intervalCoverageArtifact: aflTradeArtifactRefSchema,
        monotonicityAuditArtifact: aflTradeArtifactRefSchema,
        subgroupDimensions: z
          .array(z.enum(AFL_TRADE_PICK_MODEL_SUBGROUPS))
          .length(AFL_TRADE_PICK_MODEL_SUBGROUPS.length),
        sensitivityAnalysisArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(100),
        acceptanceCriteriaArtifact: aflTradeArtifactRefSchema,
      })
      .strict(),
    limitations: z.array(boundedTextSchema).min(1).max(100),
  })
  .strict()
  .superRefine((protocol, context) => {
    if (
      new Set(protocol.estimands).size !== protocol.estimands.length ||
      !protocol.estimands.includes('draft_pick_outcome_distribution') ||
      !protocol.estimands.includes('future_pick_landing_distribution')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['estimands'],
        message: 'Pick protocols must include each required estimand exactly once.',
      });
    }
    const subgroupDimensions = protocol.validationPlan.subgroupDimensions;
    if (
      new Set(subgroupDimensions).size !== subgroupDimensions.length ||
      AFL_TRADE_PICK_MODEL_SUBGROUPS.some(
        (dimension) => !subgroupDimensions.includes(dimension)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validationPlan', 'subgroupDimensions'],
        message: 'Validation must cover every required pick-model subgroup exactly once.',
      });
    }
    addModelWindowIssues(protocol.windows, context);
  });

export const aflTradePickDistributionModelProtocolSchema = z
  .object({
    protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    content: aflTradePickDistributionModelProtocolContentSchema,
  })
  .strict()
  .superRefine((protocol, context) => {
    addAflTradeContentAddressIssue(
      'model-protocol',
      protocol.protocolId,
      protocol.content,
      context,
      ['protocolId']
    );
  });

export type AflTradePickDistributionModelProtocol = z.infer<
  typeof aflTradePickDistributionModelProtocolSchema
>;

export const aflTradeModelProtocolSchema = z.union([
  aflTradePlayerContributionModelProtocolSchema,
  aflTradePickDistributionModelProtocolSchema,
]);

export type AflTradeModelProtocol = z.infer<typeof aflTradeModelProtocolSchema>;
