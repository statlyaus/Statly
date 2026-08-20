import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchCanonicalJson,
} from '../../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../../artifacts/contentAddress';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateDecisionProposal,
  type AflTradeGateDecisionRecord,
} from '../../governance/gateDecisionTypes';

const SCHEMA_VERSION = 'governed-valuation-model-qualification/v1' as const;
const POLICY_SCHEMA_VERSION = 'governed-valuation-model-qualification-policy/v1' as const;
const instantSchema = z.iso.datetime({ offset: true });
const finiteNonNegative = z.number().finite().nonnegative();
const probability = z.number().finite().min(0).max(1);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

export const governedPlayerModelQualificationCriteriaSchema = z
  .object({
    schemaVersion: z.literal('governed-player-model-qualification-criteria/v1'),
    minimumComparableObservations: z.number().int().positive().max(100_000),
    minimumRelativeMaeImprovement: probability.gt(0),
    minimumRelativeRmseImprovement: probability.gt(0),
    requiredAcceptanceOutcome: z.literal('meets_declared_predictive_thresholds'),
  })
  .strict();

export const governedPickModelQualificationCriteriaSchema = z
  .object({
    schemaVersion: z.literal('governed-pick-model-qualification-criteria/v1'),
    evaluatedScope: z.literal('final_test'),
    minimumObservations: z.number().int().positive().max(100_000),
    maximumMulticlassBrierScore: finiteNonNegative,
    maximumMulticlassLogLoss: finiteNonNegative,
    maximumRankedProbabilityScore: finiteNonNegative,
    maximumContributionCrps: finiteNonNegative,
    maximumMeanAbsoluteContributionError: finiteNonNegative,
    maximumRootMeanSquaredContributionError: finiteNonNegative,
    maximumMeanAbsoluteGamesError: finiteNonNegative,
    maximumRootMeanSquaredGamesError: finiteNonNegative,
    minimumEmpiricalP10P90Coverage: probability,
    maximumEmpiricalP10P90Coverage: probability,
    maximumMeanEmpiricalIntervalWidth: finiteNonNegative,
    maximumZeroProbabilityObservationCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((criteria, context) => {
    if (
      criteria.maximumEmpiricalP10P90Coverage < criteria.minimumEmpiricalP10P90Coverage
    ) {
      context.addIssue({
        code: 'custom',
        path: ['maximumEmpiricalP10P90Coverage'],
        message: 'Maximum empirical coverage cannot be below the declared minimum.',
      });
    }
  });

export const governedValuationModelQualificationPolicySchema = z
  .object({
    schemaVersion: z.literal(POLICY_SCHEMA_VERSION),
    policyVersion: publicIdSchema,
    player: governedPlayerModelQualificationCriteriaSchema,
    pick: governedPickModelQualificationCriteriaSchema,
  })
  .strict();

const playerEvidenceSchema = z
  .object({
    schemaVersion: z.literal('governed-player-model-qualification-evidence/v1'),
    validationReportId: aflTradeContentAddressedIdSchema('player-validation-report'),
    comparableObservationCount: z.number().int().nonnegative().max(100_000),
    acceptanceOutcome: z.enum([
      'meets_declared_predictive_thresholds',
      'does_not_meet_declared_predictive_thresholds',
    ]),
    relativeMaeImprovement: z.number().finite().nullable(),
    relativeRmseImprovement: z.number().finite().nullable(),
  })
  .strict();

const pickMetricsSchema = z
  .object({
    multiclassBrierScore: finiteNonNegative,
    multiclassLogLoss: finiteNonNegative.nullable(),
    rankedProbabilityScore: finiteNonNegative,
    contributionCrps: finiteNonNegative,
    meanAbsoluteContributionError: finiteNonNegative,
    rootMeanSquaredContributionError: finiteNonNegative,
    meanAbsoluteGamesError: finiteNonNegative,
    rootMeanSquaredGamesError: finiteNonNegative,
    empiricalP10P90Coverage: probability,
    meanEmpiricalIntervalWidth: finiteNonNegative,
    zeroProbabilityObservationCount: z.number().int().nonnegative(),
  })
  .strict();

const pickEvidenceSchema = z
  .object({
    schemaVersion: z.literal('governed-pick-model-qualification-evidence/v1'),
    validationReportId: aflTradeContentAddressedIdSchema('pick-pav-validation-report'),
    evaluationStatus: z.enum([
      'scored_not_approved',
      'insufficient_eligible_observations_not_approved',
      'invalid_zero_probability_not_approved',
    ]),
    scope: z.literal('final_test'),
    observationCount: z.number().int().nonnegative().max(100_000),
    metrics: pickMetricsSchema.nullable(),
  })
  .strict();

const commonComponentSchema = z.object({
  runId: aflTradeContentAddressedIdSchema('model-run'),
  runArtifact: aflTradeArtifactRefSchema,
  protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
  protocolArtifact: aflTradeArtifactRefSchema,
  criteriaArtifact: aflTradeArtifactRefSchema,
  validationEvidenceArtifact: aflTradeArtifactRefSchema,
});

const playerComponentInputSchema = commonComponentSchema
  .extend({
    role: z.literal('player_contribution_and_availability'),
    validationEvidence: playerEvidenceSchema,
  })
  .strict();

const pickComponentInputSchema = commonComponentSchema
  .extend({
    role: z.literal('draft_pick_and_future_pick_distribution'),
    validationEvidence: pickEvidenceSchema,
  })
  .strict();

const qualificationInputSchema = z
  .object({
    environment: z.literal('non_production'),
    scopeKey: publicIdSchema,
    evaluatedAt: instantSchema,
    policy: governedValuationModelQualificationPolicySchema,
    policyArtifact: aflTradeArtifactRefSchema,
    components: z
      .object({
        player: playerComponentInputSchema,
        pick: pickComponentInputSchema,
      })
      .strict(),
  })
  .strict();

export const GOVERNED_VALUATION_MODEL_QUALIFICATION_FAILURE_CODES = [
  'player_observation_count_below_minimum',
  'player_acceptance_outcome_not_met',
  'player_mae_improvement_below_minimum',
  'player_rmse_improvement_below_minimum',
  'pick_evaluation_not_scored',
  'pick_observation_count_below_minimum',
  'pick_metrics_unavailable',
  'pick_brier_score_above_maximum',
  'pick_log_loss_unavailable',
  'pick_log_loss_above_maximum',
  'pick_ranked_probability_score_above_maximum',
  'pick_contribution_crps_above_maximum',
  'pick_contribution_mae_above_maximum',
  'pick_contribution_rmse_above_maximum',
  'pick_games_mae_above_maximum',
  'pick_games_rmse_above_maximum',
  'pick_coverage_below_minimum',
  'pick_coverage_above_maximum',
  'pick_interval_width_above_maximum',
  'pick_zero_probability_count_above_maximum',
] as const;

const failureCodeSchema = z.enum(GOVERNED_VALUATION_MODEL_QUALIFICATION_FAILURE_CODES);
type FailureCode = z.infer<typeof failureCodeSchema>;

function playerFailures(
  criteria: z.infer<typeof governedPlayerModelQualificationCriteriaSchema>,
  evidence: z.infer<typeof playerEvidenceSchema>
): FailureCode[] {
  const failures: FailureCode[] = [];
  if (evidence.comparableObservationCount < criteria.minimumComparableObservations) {
    failures.push('player_observation_count_below_minimum');
  }
  if (evidence.acceptanceOutcome !== criteria.requiredAcceptanceOutcome) {
    failures.push('player_acceptance_outcome_not_met');
  }
  if (
    evidence.relativeMaeImprovement === null ||
    evidence.relativeMaeImprovement < criteria.minimumRelativeMaeImprovement
  ) {
    failures.push('player_mae_improvement_below_minimum');
  }
  if (
    evidence.relativeRmseImprovement === null ||
    evidence.relativeRmseImprovement < criteria.minimumRelativeRmseImprovement
  ) {
    failures.push('player_rmse_improvement_below_minimum');
  }
  return failures;
}

function pickFailures(
  criteria: z.infer<typeof governedPickModelQualificationCriteriaSchema>,
  evidence: z.infer<typeof pickEvidenceSchema>
): FailureCode[] {
  const failures: FailureCode[] = [];
  if (evidence.evaluationStatus !== 'scored_not_approved') {
    failures.push('pick_evaluation_not_scored');
  }
  if (evidence.observationCount < criteria.minimumObservations) {
    failures.push('pick_observation_count_below_minimum');
  }
  const metrics = evidence.metrics;
  if (metrics === null) return [...failures, 'pick_metrics_unavailable'];
  const upperBounds: ReadonlyArray<readonly [boolean, FailureCode]> = [
    [metrics.multiclassBrierScore > criteria.maximumMulticlassBrierScore, 'pick_brier_score_above_maximum'],
    [metrics.rankedProbabilityScore > criteria.maximumRankedProbabilityScore, 'pick_ranked_probability_score_above_maximum'],
    [metrics.contributionCrps > criteria.maximumContributionCrps, 'pick_contribution_crps_above_maximum'],
    [metrics.meanAbsoluteContributionError > criteria.maximumMeanAbsoluteContributionError, 'pick_contribution_mae_above_maximum'],
    [metrics.rootMeanSquaredContributionError > criteria.maximumRootMeanSquaredContributionError, 'pick_contribution_rmse_above_maximum'],
    [metrics.meanAbsoluteGamesError > criteria.maximumMeanAbsoluteGamesError, 'pick_games_mae_above_maximum'],
    [metrics.rootMeanSquaredGamesError > criteria.maximumRootMeanSquaredGamesError, 'pick_games_rmse_above_maximum'],
    [metrics.meanEmpiricalIntervalWidth > criteria.maximumMeanEmpiricalIntervalWidth, 'pick_interval_width_above_maximum'],
    [metrics.zeroProbabilityObservationCount > criteria.maximumZeroProbabilityObservationCount, 'pick_zero_probability_count_above_maximum'],
  ];
  for (const [failed, code] of upperBounds) if (failed) failures.push(code);
  if (metrics.multiclassLogLoss === null) failures.push('pick_log_loss_unavailable');
  else if (metrics.multiclassLogLoss > criteria.maximumMulticlassLogLoss) {
    failures.push('pick_log_loss_above_maximum');
  }
  if (metrics.empiricalP10P90Coverage < criteria.minimumEmpiricalP10P90Coverage) {
    failures.push('pick_coverage_below_minimum');
  }
  if (metrics.empiricalP10P90Coverage > criteria.maximumEmpiricalP10P90Coverage) {
    failures.push('pick_coverage_above_maximum');
  }
  return failures;
}

const qualifiedComponentSchema = commonComponentSchema
  .extend({
    role: z.enum([
      'player_contribution_and_availability',
      'draft_pick_and_future_pick_distribution',
    ]),
    validationEvidence: z.union([playerEvidenceSchema, pickEvidenceSchema]),
    passed: z.boolean(),
  })
  .strict();

export const governedValuationModelQualificationContentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    environment: z.literal('non_production'),
    scopeKey: publicIdSchema,
    evaluatedAt: instantSchema,
    policy: governedValuationModelQualificationPolicySchema,
    policyArtifact: aflTradeArtifactRefSchema,
    player: qualifiedComponentSchema.extend({
      role: z.literal('player_contribution_and_availability'),
      validationEvidence: playerEvidenceSchema,
    }),
    pick: qualifiedComponentSchema.extend({
      role: z.literal('draft_pick_and_future_pick_distribution'),
      validationEvidence: pickEvidenceSchema,
    }),
    outcome: z.enum(['qualified', 'failed']),
    failureCodes: z.array(failureCodeSchema).max(GOVERNED_VALUATION_MODEL_QUALIFICATION_FAILURE_CODES.length),
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((qualification, context) => {
    const player = playerFailures(qualification.policy.player, qualification.player.validationEvidence);
    const pick = pickFailures(qualification.policy.pick, qualification.pick.validationEvidence);
    const expectedFailures = [...player, ...pick];
    const artifactChecks: ReadonlyArray<readonly [boolean, (string | number)[], string]> = [
      [doesAflTradeArtifactRefMatchCanonicalJson(qualification.policyArtifact, qualification.policy), ['policyArtifact'], 'Qualification policy artifact does not authenticate the declared policy.'],
      [doesAflTradeArtifactRefMatchCanonicalJson(qualification.player.criteriaArtifact, qualification.policy.player), ['player', 'criteriaArtifact'], 'Player criteria artifact does not authenticate the declared criteria.'],
      [doesAflTradeArtifactRefMatchCanonicalJson(qualification.pick.criteriaArtifact, qualification.policy.pick), ['pick', 'criteriaArtifact'], 'Pick criteria artifact does not authenticate the declared criteria.'],
      [doesAflTradeArtifactRefMatchCanonicalJson(qualification.player.validationEvidenceArtifact, qualification.player.validationEvidence), ['player', 'validationEvidenceArtifact'], 'Player validation evidence artifact does not authenticate the retained evidence.'],
      [doesAflTradeArtifactRefMatchCanonicalJson(qualification.pick.validationEvidenceArtifact, qualification.pick.validationEvidence), ['pick', 'validationEvidenceArtifact'], 'Pick validation evidence artifact does not authenticate the retained evidence.'],
    ];
    for (const [valid, path, message] of artifactChecks) {
      if (!valid) context.addIssue({ code: 'custom', path, message });
    }
    if (
      qualification.player.runId === qualification.pick.runId ||
      qualification.player.protocolId === qualification.pick.protocolId
    ) {
      context.addIssue({ code: 'custom', path: ['pick'], message: 'Player and pick qualification require distinct run and protocol lineage.' });
    }
    if (
      qualification.player.passed !== (player.length === 0) ||
      qualification.pick.passed !== (pick.length === 0) ||
      qualification.outcome !== (expectedFailures.length === 0 ? 'qualified' : 'failed') ||
      JSON.stringify(qualification.failureCodes) !== JSON.stringify(expectedFailures)
    ) {
      context.addIssue({ code: 'custom', path: ['outcome'], message: 'Qualification result must equal the recomputed criteria outcome.' });
    }
    const latestArtifactTime = Math.max(
      ...[
        qualification.policyArtifact,
        qualification.player.runArtifact,
        qualification.player.protocolArtifact,
        qualification.player.criteriaArtifact,
        qualification.player.validationEvidenceArtifact,
        qualification.pick.runArtifact,
        qualification.pick.protocolArtifact,
        qualification.pick.criteriaArtifact,
        qualification.pick.validationEvidenceArtifact,
      ].map(({ createdAt }) => Date.parse(createdAt))
    );
    if (latestArtifactTime > Date.parse(qualification.evaluatedAt)) {
      context.addIssue({ code: 'custom', path: ['evaluatedAt'], message: 'Qualification cannot predate retained authority or validation evidence.' });
    }
  });

export const governedValuationModelQualificationSchema = z
  .object({
    qualificationId: aflTradeContentAddressedIdSchema('model-qualification'),
    content: governedValuationModelQualificationContentSchema,
  })
  .strict()
  .superRefine((qualification, context) => {
    addAflTradeContentAddressIssue('model-qualification', qualification.qualificationId, qualification.content, context, ['qualificationId']);
  });

export type GovernedValuationModelQualification = z.infer<
  typeof governedValuationModelQualificationSchema
>;

export function createGovernedValuationModelQualification(
  rawInput: z.input<typeof qualificationInputSchema>
): GovernedValuationModelQualification {
  const input = qualificationInputSchema.parse(rawInput);
  const playerFailureCodes = playerFailures(input.policy.player, input.components.player.validationEvidence);
  const pickFailureCodes = pickFailures(input.policy.pick, input.components.pick.validationEvidence);
  const failureCodes = [...playerFailureCodes, ...pickFailureCodes];
  const content = governedValuationModelQualificationContentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    environment: input.environment,
    scopeKey: input.scopeKey,
    evaluatedAt: input.evaluatedAt,
    policy: input.policy,
    policyArtifact: input.policyArtifact,
    player: { ...input.components.player, passed: playerFailureCodes.length === 0 },
    pick: { ...input.components.pick, passed: pickFailureCodes.length === 0 },
    outcome: failureCodes.length === 0 ? 'qualified' : 'failed',
    failureCodes,
    publicationEligible: false,
  });
  return governedValuationModelQualificationSchema.parse({
    qualificationId: createAflTradeContentAddress('model-qualification', content),
    content,
  });
}

export function authenticateGovernedValuationModelQualification(
  input: unknown
): GovernedValuationModelQualification {
  return governedValuationModelQualificationSchema.parse(input);
}

export type GovernedValuationModelQualificationGateRecord = Readonly<{
  proposal: AflTradeGateDecisionProposal;
  decision: AflTradeGateDecisionRecord;
}>;

export function createGovernedValuationModelQualificationGateRecords(input: {
  readonly qualification: GovernedValuationModelQualification;
  readonly qualificationArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  readonly decidedAt: string;
  readonly automationPrincipal: string;
  readonly accountableOwner: string;
  readonly versions: Readonly<{ player: number; pick: number }>;
  readonly supersedes: Readonly<{ player: string | null; pick: string | null }>;
}): readonly [
  GovernedValuationModelQualificationGateRecord,
  GovernedValuationModelQualificationGateRecord,
] {
  const qualification = governedValuationModelQualificationSchema.parse(input.qualification);
  const qualificationArtifact = aflTradeArtifactRefSchema.parse(input.qualificationArtifact);
  const decidedAt = instantSchema.parse(input.decidedAt);
  const automationPrincipal = publicIdSchema.parse(input.automationPrincipal);
  const accountableOwner = publicIdSchema.parse(input.accountableOwner);
  if (
    qualification.content.outcome !== 'qualified' ||
    !doesAflTradeArtifactRefMatchCanonicalJson(qualificationArtifact, qualification) ||
    Date.parse(qualificationArtifact.createdAt) > Date.parse(decidedAt)
  ) {
    throw new RangeError(
      'Automated Gate 3 records require a passing exact qualification retained before decision.'
    );
  }

  const createRecord = (
    component: 'player' | 'pick'
  ): GovernedValuationModelQualificationGateRecord => {
    const qualifiedComponent = qualification.content[component];
    const version = z.number().int().positive().parse(input.versions[component]);
    const supersedesDecisionId = input.supersedes[component];
    const decisionKey = `${qualification.content.scopeKey}:${component}-model-validity`;
    const affectedArtifacts = [
      { kind: 'model_run' as const, artifactId: qualifiedComponent.runId },
      {
        kind: 'model_qualification' as const,
        artifactId: qualification.qualificationId,
      },
    ];
    const proposalContent = {
      schemaVersion: 'afl-trade-gate-proposal/v1' as const,
      gate: 'gate_3_model_validity' as const,
      decisionKey,
      version,
      environment: 'non_production' as const,
      scope: {
        scopeKey: qualification.content.scopeKey,
        description: `Automated ${component} model validity for one exact qualified pair.`,
        dimensions: [{ name: 'qualification', values: [qualification.qualificationId] }],
        exclusions: ['Production use, publication, and trade grades'],
      },
      proposal: `Apply the exact retained ${component} result from the shared model-pair qualification.`,
      alternativesConsidered: ['Retain the candidate without advancing current model authority.'],
      accountableOwner,
      reviewRequirement: 'accountable_owner_only' as const,
      requiredReviewerRoles: [],
      conditions: [],
      evidenceIds: [qualificationArtifact.artifactId],
      affectedArtifacts,
      proposedAt: decidedAt,
      proposedBy: automationPrincipal,
      proposalOrigin: 'agent_assisted' as const,
    };
    const proposal = aflTradeGateDecisionProposalSchema.parse({
      proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
      content: proposalContent,
    });
    const decisionContent = {
      schemaVersion: 'afl-trade-gate-decision/v1' as const,
      proposalId: proposal.proposalId,
      gate: proposal.content.gate,
      decisionKey,
      version,
      environment: 'non_production' as const,
      scope: proposal.content.scope,
      state: 'approved' as const,
      authorityKind: 'automated_validation_record' as const,
      accountableOwner,
      decidedBy: automationPrincipal,
      reviewers: [],
      authorityEvidenceIds: [qualificationArtifact.artifactId],
      conditionResults: [],
      rationale: `The shared exact model-pair qualification passed every declared ${component} criterion.`,
      limitations: ['Private non-production model validity only.'],
      decidedAt,
      effectiveAt: decidedAt,
      revalidateAt: null,
      supersedesDecisionId,
      affectedArtifacts,
      withdrawalActions: [],
    };
    const decision = aflTradeGateDecisionRecordSchema.parse({
      decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
      content: decisionContent,
    });
    return { proposal, decision };
  };

  return [createRecord('player'), createRecord('pick')];
}
