import { describe, expect, it } from 'vitest';

import {
  aflTradeModelRunManifestSchema,
  aflTradePickDistributionModelProtocolSchema,
  aflTradePlayerContributionModelProtocolSchema,
  aflTradeProjectionManifestSchema,
  aflTradePublicationManifestSchema,
  aflTradeValuationBundleManifestSchema,
  validateAflTradeManifestProvenance,
  type AflTradeManifestProvenanceInput,
} from '@/server/aflTradeIntelligence/artifacts/manifestContracts';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_ARCHITECTURE_DESIGN_ASSERTIONS,
  AFL_TRADE_ARCHITECTURE_PACKAGE_SECTIONS,
  aflTradeArchitectureDecisionPackageSchema,
} from '@/server/aflTradeIntelligence/governance/architectureDecisionPackage';
import {
  AFL_TRADE_AUTHORITY_CONCERNS,
  AFL_TRADE_REQUIRED_CURRENT_STATE_OBSERVATIONS,
  aflTradeArchitectureCurrentStateSchema,
} from '@/server/aflTradeIntelligence/governance/architectureCurrentState';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import type {
  AflTradeGateCode,
  AflTradeGovernedArtifactRef,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';

const digest = (character: string) => character.repeat(64);

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt: '2026-08-04T00:00:00.000Z',
  };
}

function modelWindows() {
  return {
    train: { from: '2020-01-01T00:00:00.000Z', to: '2021-01-01T00:00:00.000Z' },
    calibration: { from: '2021-01-08T00:00:00.000Z', to: '2022-01-01T00:00:00.000Z' },
    validation: { from: '2022-01-08T00:00:00.000Z', to: '2023-01-01T00:00:00.000Z' },
    finalTest: { from: '2023-01-08T00:00:00.000Z', to: '2024-01-01T00:00:00.000Z' },
    embargoDays: 7,
  };
}

function modelProtocolContent() {
  return {
    schemaVersion: 'afl-trade-model-protocol/v1' as const,
    environment: 'test_fixture' as const,
    protocolKey: 'fixture-player-contribution',
    version: 1,
    modelKind: 'player_contribution_and_availability' as const,
    datasetId: `dataset:${digest('1')}`,
    preparedAt: '2026-08-04T12:00:00.000Z',
    preparedBy: 'fixture-model-owner',
    proposalOrigin: 'agent_assisted' as const,
    publicIdentityBoundary: 'source_native_no_fantasy_ownership' as const,
    estimands: ['realized_club_contribution' as const, 'remaining_contribution' as const],
    valueUnit: {
      valueUnitId: 'fixture-contribution',
      label: 'Fixture contribution',
      definitionArtifact: artifact('1'),
      aggregation: 'additive_contribution' as const,
    },
    footballContext: {
      roleTaxonomyArtifact: artifact('2'),
      eraDefinitionArtifact: artifact('3'),
      roleAssignmentTiming: 'as_known_at_prediction_cutoff' as const,
      unknownRoleTreatment: 'explicit_unknown_role' as const,
    },
    replacementBaseline: {
      definitionArtifact: artifact('4'),
      stratification: 'role_and_era' as const,
      estimationData: 'training_partition_only' as const,
      validationAndTestRefit: 'prohibited' as const,
    },
    featurePolicy: {
      knowledgeJoin: 'point_in_time_as_known_at_prediction_cutoff' as const,
      correctionAvailability: 'only_after_known_from' as const,
      unknownAndZero: 'distinct' as const,
      targetDerivedFeatures: 'prohibited' as const,
      postOutcomeFeatures: 'prohibited' as const,
      featureAvailabilityArtifact: artifact('5'),
    },
    contributionAndCensoringPolicy: {
      clubContributionEnd: 'real_club_departure_or_observation_end' as const,
      activeCareerTreatment: 'right_censored' as const,
      unavailableObservationTreatmentArtifact: artifact('6'),
      censoringDefinitionArtifact: artifact('7'),
    },
    windows: modelWindows(),
    modelSelectionPolicy: {
      candidateSelectionData: 'train_calibration_validation_only' as const,
      finalTestUse: 'single_evaluation_after_candidate_lock' as const,
      finalTestRetuning: 'prohibited' as const,
    },
    validationPlan: {
      baselineDefinitionArtifacts: [artifact('8')],
      metricDefinitionArtifacts: [artifact('9')],
      intervalCalibrationArtifact: artifact('a'),
      subgroupDimensions: [
        'era' as const,
        'role' as const,
        'position' as const,
        'age' as const,
        'availability_state' as const,
        'evidence_quality' as const,
      ],
      sensitivityAnalysisArtifacts: [artifact('b')],
      acceptanceCriteriaArtifact: artifact('c'),
    },
    limitations: ['Fabricated protocol with no production authority.'],
  };
}

function modelProtocol(content = modelProtocolContent()) {
  return aflTradePlayerContributionModelProtocolSchema.parse({
    protocolId: createAflTradeContentAddress('model-protocol', content),
    content,
  });
}

function runContent(protocol = modelProtocol()) {
  return {
    schemaVersion: 'afl-trade-model-run/v2' as const,
    environment: 'test_fixture' as const,
    modelId: 'fixture-model',
    modelVersion: 'fixture-v1',
    datasetId: protocol.content.datasetId,
    modelProtocolId: protocol.protocolId,
    codeCommitSha: digest('2').slice(0, 40),
    cleanWorktree: true as const,
    seed: 42,
    job: {
      jobId: 'fixture-job',
      attempt: 1,
      initiatedBy: 'fixture-model-owner',
      workerIdentity: 'fixture-worker',
    },
    startedAt: '2026-08-05T00:00:00.000Z',
    candidateLockedAt: '2026-08-05T00:30:00.000Z',
    finalTestEvaluatedAt: '2026-08-05T00:45:00.000Z',
    finishedAt: '2026-08-05T01:00:00.000Z',
    windows: modelWindows(),
    sourceCodeArtifact: artifact('3'),
    dependencyLockArtifact: artifact('4'),
    runtimeArtifact: artifact('5'),
    containerArtifact: artifact('6'),
    configurationArtifact: artifact('7'),
    environmentArtifact: artifact('8'),
    featureDefinitionArtifacts: [artifact('9'), artifact('0')],
    outcome: {
      status: 'succeeded' as const,
      modelArtifact: artifact('a'),
      validationReportArtifact: artifact('b'),
      baselineComparisonArtifact: artifact('c'),
      calibrationReportArtifact: artifact('d'),
      intervalCoverageArtifact: artifact('e'),
      subgroupReportArtifact: artifact('f'),
      sensitivityReportArtifact: artifact('1'),
      leakageAuditArtifact: artifact('2'),
      modelCardArtifact: artifact('c'),
      diagnosticsArtifact: artifact('d'),
    },
  };
}

function modelRun(content = runContent()) {
  return aflTradeModelRunManifestSchema.parse({
    runId: createAflTradeContentAddress('model-run', content),
    content,
  });
}

function pickModelProtocolContent() {
  return {
    schemaVersion: 'afl-trade-model-protocol/v1' as const,
    environment: 'test_fixture' as const,
    protocolKey: 'fixture-pick-distribution',
    version: 1,
    modelKind: 'draft_pick_and_future_pick_distribution' as const,
    datasetId: `dataset:${digest('d')}`,
    preparedAt: '2026-08-04T13:00:00.000Z',
    preparedBy: 'fixture-model-owner',
    proposalOrigin: 'agent_assisted' as const,
    publicAssetBoundary: 'source_native_afl_draft_entitlement_no_fantasy_ownership' as const,
    estimands: [
      'draft_pick_outcome_distribution' as const,
      'future_pick_landing_distribution' as const,
    ],
    valueAlignment: {
      valueUnitId: 'fixture-contribution',
      playerContributionAlignmentArtifact: artifact('d'),
      aggregation: 'expected_additive_contribution' as const,
    },
    outcomeMixture: {
      hurdleOutcomeDefinitionArtifact: artifact('1'),
      regularOutcomeDefinitionArtifact: artifact('2'),
      eliteOutcomeDefinitionArtifact: artifact('3'),
      probabilityMass: 'mutually_exclusive_and_exhaustive' as const,
      activeCareerTreatment: 'right_censored' as const,
    },
    pickCurve: {
      domain: 'national_draft_selection_number' as const,
      smoother: 'constrained_monotonic' as const,
      expectedContributionDirection: 'non_increasing_with_pick_number' as const,
      monotonicViolations: 'prohibited' as const,
      uncertaintyTreatment: 'preserved_not_point_estimate_only' as const,
      extrapolationDefinitionArtifact: artifact('4'),
    },
    cohortPolicy: {
      eraDefinitionArtifact: artifact('5'),
      draftPathwayDefinitionArtifact: artifact('6'),
      incompleteCareerTreatmentArtifact: artifact('7'),
      delistedAndInactiveDefinitionArtifact: artifact('8'),
    },
    futurePickSimulation: {
      landingPositionModelArtifact: artifact('9'),
      selectionOrderRulesArtifact: artifact('a'),
      ruleVintage: 'as_known_at_valuation_cutoff' as const,
      timeDelayDefinitionArtifact: artifact('b'),
      correlatedLadderOutcomeArtifact: artifact('c'),
      simulationDraws: 10_000,
      randomSeedPolicy: 'model_run_manifest_seed' as const,
      landingCalibration: 'held_out_temporal_seasons' as const,
      scenarioSensitivityArtifacts: [artifact('d')],
    },
    featurePolicy: {
      knowledgeJoin: 'point_in_time_as_known_at_valuation_cutoff' as const,
      correctionAvailability: 'only_after_known_from' as const,
      unknownAndZero: 'distinct' as const,
      postOutcomeFeatures: 'prohibited' as const,
      featureAvailabilityArtifact: artifact('e'),
    },
    windows: modelWindows(),
    modelSelectionPolicy: {
      candidateSelectionData: 'train_calibration_validation_only' as const,
      finalTestUse: 'single_evaluation_after_candidate_lock' as const,
      finalTestRetuning: 'prohibited' as const,
    },
    validationPlan: {
      baselineDefinitionArtifacts: [artifact('f')],
      metricDefinitionArtifacts: [artifact('0')],
      probabilityCalibrationArtifact: artifact('1'),
      intervalCoverageArtifact: artifact('2'),
      monotonicityAuditArtifact: artifact('3'),
      subgroupDimensions: [
        'era' as const,
        'draft_round' as const,
        'draft_pathway' as const,
        'player_position' as const,
        'age_at_draft' as const,
        'evidence_quality' as const,
      ],
      sensitivityAnalysisArtifacts: [artifact('4')],
      acceptanceCriteriaArtifact: artifact('5'),
    },
    limitations: ['Fabricated pick protocol with no production authority.'],
  };
}

function pickModelProtocol(content = pickModelProtocolContent()) {
  return aflTradePickDistributionModelProtocolSchema.parse({
    protocolId: createAflTradeContentAddress('model-protocol', content),
    content,
  });
}

function pickRunContent(protocol = pickModelProtocol()) {
  const playerContent = runContent();
  return {
    ...playerContent,
    modelId: 'fixture-pick-model',
    datasetId: protocol.content.datasetId,
    modelProtocolId: protocol.protocolId,
    job: { ...playerContent.job, jobId: 'fixture-pick-job' },
  };
}

function pickModelRun(content = pickRunContent()) {
  return aflTradeModelRunManifestSchema.parse({
    runId: createAflTradeContentAddress('model-run', content),
    content,
  });
}

function valuationBundleContent(
  playerProtocol = modelProtocol(),
  playerRun = modelRun(runContent(playerProtocol)),
  pickProtocol = pickModelProtocol(),
  pickRun = pickModelRun(pickRunContent(pickProtocol))
) {
  return {
    schemaVersion: 'afl-trade-valuation-bundle/v1' as const,
    environment: 'test_fixture' as const,
    scopeKey: 'fixture-current-outcome',
    valueUnitId: 'fixture-contribution',
    createdAt: '2026-08-05T04:00:00.000Z',
    components: [
      {
        role: 'player_contribution_and_availability' as const,
        modelKind: 'player_contribution_and_availability' as const,
        protocolId: playerProtocol.protocolId,
        runId: playerRun.runId,
        datasetId: playerProtocol.content.datasetId,
        gate3DecisionId: `gate-decision:${digest('a')}`,
      },
      {
        role: 'draft_pick_and_future_pick_distribution' as const,
        modelKind: 'draft_pick_and_future_pick_distribution' as const,
        protocolId: pickProtocol.protocolId,
        runId: pickRun.runId,
        datasetId: pickProtocol.content.datasetId,
        gate3DecisionId: `gate-decision:${digest('b')}`,
      },
    ],
    viewContexts: [
      {
        view: 'at_trade' as const,
        modelVintage: 'historical_restatement' as const,
        effectiveAt: '2020-11-12T00:00:00.000Z',
        knowledgeCutoffAt: '2020-11-11T23:59:59.000Z',
        valuationAsOf: '2020-11-12T00:00:00.000Z',
      },
      ...(['realized', 'remaining', 'current'] as const).map((view) => ({
        view,
        modelVintage: 'current' as const,
        effectiveAt: '2025-12-31T00:00:00.000Z',
        knowledgeCutoffAt: '2025-12-31T23:59:59.000Z',
        valuationAsOf: '2026-01-01T00:00:00.000Z',
      })),
    ],
    publicAssetBoundary: 'source_native_afl_assets_no_fantasy_ownership' as const,
    packagePolicy: {
      calculationUnit: 'complete_multi_party_trade' as const,
      attribution: 'lineage_frontier_exactly_once' as const,
      playerContributionCredit: 'receiving_club_only_until_real_club_departure' as const,
      exercisedPickCredit: 'selected_player_or_return_assets_without_double_counting' as const,
      unresolvedAssetTreatment: 'exclude_with_explicit_reason_no_fallback_value' as const,
      aggregation: 'joint_simulation_not_independent_point_sum' as const,
      sharedFactorTreatment: 'preserve_correlated_outcomes' as const,
      currentOutcomeIdentity: 'realized_club_value_plus_remaining_asset_value' as const,
      universalFootballValue: 'always_visible' as const,
      clubUtilityTreatment: 'separate_optional_view' as const,
      contractValueTreatment: 'separate_or_explicitly_unavailable' as const,
      commercialValueTreatment: 'separate_or_explicitly_unavailable' as const,
      listSpotPolicyArtifact: artifact('1'),
      scarcityPolicyArtifact: artifact('2'),
      roleCongestionPolicyArtifact: artifact('3'),
    },
    simulation: {
      draws: 10_000,
      seed: 42,
      centralIntervalLevel: 0.8 as const,
      downsideQuantile: 0.1 as const,
      upsideQuantile: 0.9 as const,
      lowReturnDefinitionArtifact: artifact('4'),
      eliteOutcomeDefinitionArtifact: artifact('5'),
      practicalEquivalenceDefinitionArtifact: artifact('6'),
      requiredStatistics: [
        'mean' as const,
        'median' as const,
        'central_interval' as const,
        'downside_quantile' as const,
        'upside_quantile' as const,
        'low_return_probability' as const,
        'elite_outcome_probability' as const,
        'club_finishes_ahead_probability' as const,
        'data_and_model_confidence' as const,
      ],
    },
    explanationPolicy: {
      sourceOfTruth: 'structured_reason_codes_and_measured_factors' as const,
      unconstrainedGenerativeClaims: 'prohibited' as const,
      numericalClaimParity: 'required' as const,
      requiredDistinctions: [
        'measured_fact' as const,
        'model_estimate' as const,
        'assumption' as const,
        'unavailable_information' as const,
        'low_confidence_output' as const,
      ],
      legacyValueTreatment: 'separate_source_metric_never_relabelled_statly_value' as const,
    },
    execution: {
      codeCommitSha: digest('c').slice(0, 40),
      cleanWorktree: true as const,
      jobId: 'fixture-valuation-job',
      attempt: 1,
      initiatedBy: 'fixture-model-owner',
      workerIdentity: 'fixture-worker',
      startedAt: '2026-08-05T02:00:00.000Z',
      finishedAt: '2026-08-05T03:00:00.000Z',
      sourceCodeArtifact: artifact('7'),
      dependencyLockArtifact: artifact('8'),
      runtimeArtifact: artifact('9'),
      configurationArtifact: artifact('a'),
    },
    outputs: {
      immutableSnapshotsArtifact: artifact('b'),
      simulationDrawsArtifact: artifact('c'),
      attributionInvariantReportArtifact: artifact('d'),
      deterministicReplayReportArtifact: artifact('e'),
      explanationParityReportArtifact: artifact('f'),
      coverageAndExclusionReportArtifact: artifact('0'),
      confidenceReportArtifact: artifact('1'),
      sensitivityReportArtifact: artifact('2'),
      validationReportArtifact: artifact('3'),
      modelCardArtifact: artifact('4'),
    },
    limitations: ['Fabricated bundle with no production authority.'],
  };
}

function valuationBundle(content = valuationBundleContent()) {
  return aflTradeValuationBundleManifestSchema.parse({
    valuationBundleId: createAflTradeContentAddress('valuation-bundle', content),
    content,
  });
}

function publicationContent(bundle = valuationBundle()) {
  return {
    schemaVersion: 'afl-trade-publication/v2' as const,
    environment: 'test_fixture' as const,
    scopeKey: bundle.content.scopeKey,
    createdAt: '2026-08-06T00:00:00.000Z',
    valuationBundleId: bundle.valuationBundleId,
    gate3DecisionId: `gate-decision:${digest('e')}`,
    sourceRegisterIds: ['fixture-source'],
    supportedViews: ['at_trade' as const, 'realized' as const, 'remaining' as const, 'current' as const],
    supportedCohorts: ['fixture-supported'],
    excludedCohorts: ['fixture-excluded'],
    valueUnitId: bundle.content.valueUnitId,
    entryCount: 10,
    publicationBundleArtifact: artifact('1'),
    methodologyArtifact: artifact('2'),
    validationReportArtifact: bundle.content.outputs.validationReportArtifact,
    modelCardArtifact: bundle.content.outputs.modelCardArtifact,
  };
}

function publication(content = publicationContent()) {
  return aflTradePublicationManifestSchema.parse({
    publicationId: createAflTradeContentAddress('publication', content),
    content,
  });
}

function projectionContent(parent = publication()) {
  return {
    schemaVersion: 'afl-trade-projection/v1' as const,
    environment: 'test_fixture' as const,
    scopeKey: parent.content.scopeKey,
    createdAt: '2026-08-07T00:00:00.000Z',
    publicationId: parent.publicationId,
    buildJobId: 'fixture-projection-job',
    responseContractVersion: 'afl-trade-value/v2' as const,
    documentCount: 10,
    projectionArtifact: artifact('5'),
    schemaArtifact: artifact('6'),
    parityReportArtifact: artifact('7'),
  };
}

function gatePair(
  gate: AflTradeGateCode,
  decisionCharacter: string,
  affectedArtifacts: AflTradeGovernedArtifactRef[]
) {
  const scope = {
    scopeKey: `${gate}-fixture-${decisionCharacter}`,
    description: 'Fabricated artifact-chain scope.',
    dimensions: [],
    exclusions: [],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate,
    decisionKey: `${gate}-fixture-${decisionCharacter}`,
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    accountableOwner: 'fixture-owner',
    conditions: [],
    proposal: 'Approve the fabricated artifact-chain fixture.',
    alternativesConsidered: ['Keep the fabricated chain blocked.'],
    evidenceIds: [`artifact:${digest(decisionCharacter)}`],
    affectedArtifacts,
    proposedAt: '2026-08-01T00:00:00.000Z',
    proposedBy: 'fixture-owner',
    proposalOrigin: 'agent_assisted' as const,
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate,
    decisionKey: proposal.content.decisionKey,
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    state: 'approved' as const,
    authorityKind: 'fixture' as const,
    accountableOwner: 'fixture-owner',
    decidedBy: 'fixture-owner',
    reviewers: [],
    authorityEvidenceIds: [`artifact:${digest('f')}`],
    conditionResults: [],
    rationale: 'Fabricated approval.',
    limitations: ['No production authority.'],
    decidedAt: '2026-08-01T00:00:00.000Z',
    effectiveAt: '2026-08-01T00:00:00.000Z',
    revalidateAt: '2027-01-01T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposal, decision };
}

function architectureArtifacts() {
  const currentStateContent = {
    schemaVersion: 'afl-trade-architecture-current-state/v1' as const,
    subject: 'afl-trade-intelligence' as const,
    environment: 'test_fixture' as const,
    repositoryRevision: digest('a').slice(0, 40),
    capturedAt: '2026-08-02T00:00:00.000Z',
    capturedBy: 'fixture-owner',
    captureMethod: 'repository_inspection' as const,
    productionClaim: false as const,
    integrityStatement: 'content_address_proves_integrity_not_truth_or_authority' as const,
    verifications: [
      {
        verificationId: 'fixture-verification',
        command: 'Inspect fabricated fixtures.',
        outcome: 'confirmed' as const,
        observedAt: '2026-08-02T00:00:00.000Z',
        evidenceIds: [`artifact:${digest('a')}`],
      },
    ],
    authorities: AFL_TRADE_AUTHORITY_CONCERNS.map((concern) => ({
      concern,
      implementationState: 'not_implemented' as const,
      currentAuthority: `Fixture current authority for ${concern}.`,
      readPath: `Fixture read path for ${concern}.`,
      writePath: `Fixture write path for ${concern}.`,
      sourceReferences: [`fixture/${concern}`],
      limitations: ['No production authority.'],
    })),
    requiredObservations: AFL_TRADE_REQUIRED_CURRENT_STATE_OBSERVATIONS.map((observation) => ({
      observation,
      finding: `Fixture finding for ${observation}.`,
      sourceReferences: [`fixture/${observation}`],
      verificationIds: ['fixture-verification'],
    })),
    unresolvedQuestions: ['Production readiness remains unverified.'],
  };
  const currentState = aflTradeArchitectureCurrentStateSchema.parse({
    snapshotId: createAflTradeContentAddress('architecture-current-state', currentStateContent),
    content: currentStateContent,
  });
  const packageContent = {
    schemaVersion: 'afl-trade-architecture-decision-package/v1' as const,
    subject: 'afl-trade-intelligence' as const,
    environment: 'test_fixture' as const,
    decisionKey: 'fixture-gate1',
    packageVersion: 1,
    currentStateSnapshotId: currentState.snapshotId,
    preparedAt: '2026-08-03T00:00:00.000Z',
    preparedBy: 'fixture-owner',
    packageState: 'proposal_only' as const,
    productionClaim: false as const,
    infrastructureReadiness: 'not_asserted' as const,
    operationalAuthorization: 'not_granted' as const,
    authorityTransfer: 'not_executed' as const,
    integrityStatement: 'content_address_proves_integrity_not_truth_or_authority' as const,
    designAssertions: [...AFL_TRADE_ARCHITECTURE_DESIGN_ASSERTIONS],
    isolationContract: {
      protectedFantasyAuthority: 'observed_unchanged_outside_trade_engine' as const,
      analyticalDatabase: {
        deploymentBoundary: 'independent_database_or_isolated_database_and_role' as const,
        credentials: 'separate_pooled_and_direct' as const,
        migrationHistory: 'separate_postgresql_native' as const,
        backupRestore: 'separate_evidence_required' as const,
        connectionBudget: 'separate' as const,
        relationalDependencies: 'no_fantasy_foreign_keys' as const,
      },
      publicIdentities: 'source_native_no_fantasy_ownership' as const,
      valuationProjectionPointer: 'separate_from_legacy_archive_pointer' as const,
    },
    authorityMatrix: AFL_TRADE_AUTHORITY_CONCERNS.map((concern) => {
      const currentAuthority = `Fixture current authority for ${concern}.`;
      const protectedFantasy = concern === 'protected_fantasy_relational_state';
      return {
        concern,
        currentAuthority,
        targetAuthority: protectedFantasy
          ? currentAuthority
          : `Fixture target authority for ${concern}.`,
        transitionRequired: !protectedFantasy,
        currentAuthorityDisposition: 'unchanged_until_authorized_activation' as const,
        targetAuthorityStatus: 'proposed_not_authoritative' as const,
        activationOwner: 'fixture-owner',
        activationConditions: ['Verify the fabricated target.'],
        retirementConditions: ['Close the fabricated rollback window.'],
      };
    }),
    sections: AFL_TRADE_ARCHITECTURE_PACKAGE_SECTIONS.map((section) => ({
      section,
      decision: `Fixture decision for ${section}.`,
      owner: 'fixture-owner',
      acceptanceCriteria: ['Review fabricated evidence.'],
      evidenceIds: [`artifact:${digest('a')}`],
      sourceReferences: [`fixture/${section}`],
    })),
    readinessEvidenceRequirements: ['Observe controlled behavior.'],
    operationalAuthorizationRequirements: ['Record separate authorization.'],
    limitations: ['No production authority.'],
  };
  const decisionPackage = aflTradeArchitectureDecisionPackageSchema.parse({
    packageId: createAflTradeContentAddress('architecture-decision-package', packageContent),
    content: packageContent,
  });
  return { currentState, decisionPackage };
}

function validProvenanceInput(): AflTradeManifestProvenanceInput {
  const rightsId = `source-rights:${digest('1')}`;
  const receiptId = `gate0a-evaluation:${digest('2')}`;
  const evidenceId = `evidence:${digest('3')}`;
  const protocolContent = {
    schemaVersion: 'afl-trade-data-sufficiency-protocol/v1' as const,
    protocolKey: 'fixture-protocol',
    version: 1,
    environment: 'test_fixture' as const,
    evidenceManifestId: evidenceId,
    scope: { scopeKey: 'fixture', description: 'Fixture scope.', dimensions: [], exclusions: [] },
    estimand: 'Fabricated measurability only.',
    evidenceLanes: [
      {
        lane: 'transactions_and_lineage' as const,
        description: 'Fabricated transaction lineage.',
        requiredFields: ['trade_id', 'asset_id'],
        cohortIds: ['fixture-cohort'],
      },
      {
        lane: 'player_contribution_and_availability' as const,
        description: 'Fabricated player contribution.',
        requiredFields: ['player_id', 'appearance'],
        cohortIds: ['fixture-cohort'],
      },
      {
        lane: 'point_in_time_current_state' as const,
        description: 'Fabricated point-in-time state.',
        requiredFields: ['club_id', 'effective_at'],
        cohortIds: ['fixture-cohort'],
      },
    ],
    identityAndQuarantinePolicy: {
      automaticIdentityMerge: 'prohibited' as const,
      ambiguousIdentity: 'quarantine' as const,
      unresolvedIdentity: 'quarantine' as const,
      conflictingEvidence: 'quarantine' as const,
      quarantinedApprovalNumerator: 'excluded' as const,
      quarantinedEligibleDenominator: 'included' as const,
      manualResolutionRequiresEvidence: true as const,
    },
    cohorts: [
      {
        cohortId: 'fixture-cohort',
        description: 'Fixture cohort.',
        dimensions: [{ name: 'season', values: ['2025'] }],
      },
    ],
    measures: [
      {
        measureId: 'coverage',
        category: 'coverage' as const,
        description: 'Fixture coverage.',
        numeratorDefinition: 'Observed fixtures.',
        denominatorDefinition: 'Expected fixtures.',
        evidenceLanes: [
          'transactions_and_lineage' as const,
          'player_contribution_and_availability' as const,
          'point_in_time_current_state' as const,
        ],
        cohortIds: ['fixture-cohort'],
        requiredForApproval: true,
        minimumRatio: { numerator: '1', denominator: '1' },
      },
    ],
    nullZeroSemantics: [
      {
        field: 'player_name',
        unknownMeaning: 'Missing fixture.',
        observedZeroMeaning: 'Explicit fixture zero.',
      },
    ],
    candidateWindows: {
      train: { from: '2020-01-01T00:00:00.000Z', to: '2021-01-01T00:00:00.000Z' },
      calibration: { from: '2021-01-01T00:00:00.000Z', to: '2022-01-01T00:00:00.000Z' },
      validation: { from: '2022-01-01T00:00:00.000Z', to: '2023-01-01T00:00:00.000Z' },
      finalTest: { from: '2023-01-01T00:00:00.000Z', to: '2024-01-01T00:00:00.000Z' },
      embargoDays: 0,
    },
    exclusions: [],
    proposedAt: '2026-08-02T00:00:00.000Z',
    proposedBy: 'fixture-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const protocolId = createAflTradeContentAddress('data-sufficiency-protocol', protocolContent);
  const reportContent = {
    schemaVersion: 'afl-trade-coverage-report/v1' as const,
    protocolId,
    evidenceManifestId: evidenceId,
    environment: 'test_fixture' as const,
    sourceRegisterIds: ['fixture-source'],
    measurementStartedAt: '2026-08-03T00:00:00.000Z',
    measurementCompletedAt: '2026-08-03T01:00:00.000Z',
    createdAt: '2026-08-03T01:00:01.000Z',
    observations: [
      {
        measureId: 'coverage',
        cohortId: 'fixture-cohort',
        status: 'measured' as const,
        observedRatio: { numerator: '1', denominator: '1' },
        supportingArtifacts: [artifact('e')],
      },
    ],
    findings: [],
    unsupportedCohorts: [],
  };
  const reportId = createAflTradeContentAddress('coverage-report', reportContent);
  const corpusId = `corpus:${digest('4')}`;
  const playerProtocol = modelProtocol();
  const playerRun = modelRun(runContent(playerProtocol));
  const pickProtocol = pickModelProtocol();
  const pickRun = pickModelRun(pickRunContent(pickProtocol));
  const gate0a = gatePair('gate_0a_permission_to_evaluate', '5', [
    { kind: 'source_rights', artifactId: rightsId },
  ]);
  const gate0b = gatePair('gate_0b_data_sufficiency', '6', [
    { kind: 'data_sufficiency_protocol', artifactId: protocolId },
    { kind: 'coverage_report', artifactId: reportId },
  ]);
  const architecture = architectureArtifacts();
  const gate1 = gatePair('gate_1_architecture_authority', 'b', [
    { kind: 'architecture_current_state', artifactId: architecture.currentState.snapshotId },
    { kind: 'architecture_decision_package', artifactId: architecture.decisionPackage.packageId },
  ]);
  const gate2 = gatePair('gate_2_corpus_lineage', '7', [
    { kind: 'corpus_manifest', artifactId: corpusId },
  ]);
  const playerGate3 = gatePair('gate_3_model_validity', '8', [
    { kind: 'model_protocol', artifactId: playerProtocol.protocolId },
    { kind: 'model_run', artifactId: playerRun.runId },
  ]);
  const pickGate3 = gatePair('gate_3_model_validity', '9', [
    { kind: 'model_protocol', artifactId: pickProtocol.protocolId },
    { kind: 'model_run', artifactId: pickRun.runId },
  ]);
  const bundleValue = valuationBundleContent(playerProtocol, playerRun, pickProtocol, pickRun);
  bundleValue.components[0].gate3DecisionId = playerGate3.decision.decisionId;
  bundleValue.components[1].gate3DecisionId = pickGate3.decision.decisionId;
  const bundle = valuationBundle(bundleValue);
  const bundleGate3 = gatePair('gate_3_model_validity', 'a', [
    { kind: 'valuation_bundle', artifactId: bundle.valuationBundleId },
  ]);
  const candidate = publication({
    ...publicationContent(bundle),
    gate3DecisionId: bundleGate3.decision.decisionId,
  });
  const projectionValue = projectionContent(candidate);
  const build = aflTradeProjectionManifestSchema.parse({
    projectionId: createAflTradeContentAddress('projection', projectionValue),
    content: projectionValue,
  });
  const gatePairs = [gate0a, gate0b, gate1, gate2, playerGate3, pickGate3, bundleGate3];
  return {
    ledger: {
      proposals: gatePairs.map((pair) => pair.proposal),
      decisions: gatePairs.map((pair) => pair.decision),
    } as unknown as AflTradeGateDecisionLedger,
    environment: 'test_fixture',
    evaluatedAt: '2026-08-10T00:00:00.000Z',
    sourceRights: [
      { rightsArtifactId: rightsId, content: { registerId: 'fixture-source' } } as never,
    ],
    gate0aReceipts: [
      {
        receiptId,
        content: {
          request: {
            rightsArtifactId: rightsId,
            operations: ['bounded_evaluation_capture'],
            fieldUses: [{ sourceField: 'player_name', use: 'archive_fact' }],
          },
          result: { status: 'mechanically_eligible', decisionId: gate0a.decision.decisionId },
          recordedAt: '2026-08-01T01:00:00.000Z',
        },
      } as never,
    ],
    evidence: {
      manifestId: evidenceId,
      content: {
        environment: 'test_fixture',
        createdAt: '2026-08-02T00:00:00.000Z',
        sourceAuthorizations: [
          {
            authorizationId: 'fixture-auth',
            sourceRegisterId: 'fixture-source',
            rightsArtifactId: rightsId,
            gate0aDecisionId: gate0a.decision.decisionId,
            gate0aReceiptId: receiptId,
          },
        ],
        items: [
          {
            evidenceItemId: `evidence-item:${digest('8')}`,
            content: {
              authorizationId: 'fixture-auth',
              sourceRegisterId: 'fixture-source',
              capturedFields: ['player_name'],
              retrievedAt: '2026-08-01T02:00:00.000Z',
            },
          },
        ],
      },
    } as never,
    dataSufficiencyProtocol: { protocolId, content: protocolContent },
    coverageReport: { reportId, content: reportContent },
    architectureCurrentState: architecture.currentState,
    architectureDecisionPackage: architecture.decisionPackage,
    corpus: {
      corpusId,
      content: {
        evidenceManifestId: evidenceId,
        dataSufficiencyProtocolId: protocolId,
        coverageReportId: reportId,
        gate0bDecisionId: gate0b.decision.decisionId,
        architectureCurrentStateId: architecture.currentState.snapshotId,
        architectureDecisionPackageId: architecture.decisionPackage.packageId,
        gate1DecisionId: gate1.decision.decisionId,
        sourceRegisterIds: ['fixture-source'],
        environment: 'test_fixture',
        createdAt: '2026-08-04T00:00:00.000Z',
        unsupportedCohortIds: [],
      },
    } as never,
    datasets: [
      {
        datasetId: playerProtocol.content.datasetId,
        content: {
          corpusId,
          gate2DecisionId: gate2.decision.decisionId,
          sourceRegisterIds: ['fixture-source'],
          environment: 'test_fixture',
          createdAt: '2026-08-04T06:00:00.000Z',
          includedCohorts: ['fixture-cohort'],
          excludedCohorts: [],
          featureDefinitionArtifacts: playerRun.content.featureDefinitionArtifacts,
        },
      } as never,
      {
        datasetId: pickProtocol.content.datasetId,
        content: {
          corpusId,
          gate2DecisionId: gate2.decision.decisionId,
          sourceRegisterIds: ['fixture-source'],
          environment: 'test_fixture',
          createdAt: '2026-08-04T06:30:00.000Z',
          includedCohorts: ['fixture-cohort'],
          excludedCohorts: [],
          featureDefinitionArtifacts: pickRun.content.featureDefinitionArtifacts,
        },
      } as never,
    ],
    modelProtocols: [playerProtocol, pickProtocol],
    modelRuns: [playerRun, pickRun],
    valuationBundle: bundle,
    publication: candidate,
    projection: build,
  };
}

describe('AFL trade-intelligence model, publication, and projection artifacts', () => {
  it('accepts one complete authorization-aware provenance DAG', () => {
    expect(validateAflTradeManifestProvenance(validProvenanceInput())).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('treats feature-definition artifacts as an order-independent multiset', () => {
    const input = validProvenanceInput();
    const reordered = {
      ...input,
      datasets: input.datasets.map((dataset, index) =>
        index === 0
          ? {
              ...dataset,
              content: {
                ...dataset.content,
                featureDefinitionArtifacts: [
                  ...dataset.content.featureDefinitionArtifacts,
                ].reverse(),
              },
            }
          : dataset
      ),
    };

    expect(validateAflTradeManifestProvenance(reordered)).toEqual({ valid: true, issues: [] });
  });

  it('reports independent provenance failures in stable validation order', () => {
    const input = validProvenanceInput();
    input.datasets[0].content.corpusId = `corpus:${digest('d')}`;
    input.publication.content.sourceRegisterIds = ['other-source'];
    input.projection.content.environment = 'non_production';
    input.projection.content.createdAt = '2026-08-05T12:00:00.000Z';

    expect(validateAflTradeManifestProvenance(input)).toEqual({
      valid: false,
      issues: [
        {
          code: 'parent_mismatch',
          subject: input.datasets[0].datasetId,
          message: 'Every component dataset must reference the exact corpus.',
        },
        {
          code: 'source_set_mismatch',
          subject: input.publication.publicationId,
          message: 'Artifact source set differs from evidence.',
        },
        {
          code: 'environment_mismatch',
          subject: input.environment,
          message: 'Artifact environments must match.',
        },
        {
          code: 'chronology_invalid',
          subject: input.projection.projectionId,
          message: `${input.projection.projectionId} predates ${input.publication.publicationId}.`,
        },
      ],
    });
  });

  it('requires the exact Gate 1 architecture decision in the corpus provenance chain', () => {
    const input = validProvenanceInput();
    const gate1DecisionId = input.corpus.content.gate1DecisionId;
    input.ledger = {
      proposals: input.ledger.proposals.filter(
        (proposal) => proposal.content.gate !== 'gate_1_architecture_authority'
      ),
      decisions: input.ledger.decisions.filter(
        (decision) => decision.decisionId !== gate1DecisionId
      ),
    };

    expect(validateAflTradeManifestProvenance(input).issues).toContainEqual(
      expect.objectContaining({ code: 'decision_invalid', subject: gate1DecisionId })
    );
  });

  it('requires the model run to reference the exact prespecified protocol', () => {
    const input = validProvenanceInput();
    input.modelRuns[0].content.modelProtocolId = `model-protocol:${digest('d')}`;

    expect(validateAflTradeManifestProvenance(input).issues).toContainEqual({
      code: 'parent_mismatch',
      subject: input.modelRuns[0].runId,
      message: 'Component protocol and run must reference the exact dataset and each other.',
    });
  });

  it('requires executed model windows to match the prespecified protocol exactly', () => {
    const input = validProvenanceInput();
    input.modelRuns[0].content.windows.embargoDays += 1;

    expect(validateAflTradeManifestProvenance(input).issues).toContainEqual({
      code: 'parent_mismatch',
      subject: input.modelRuns[0].runId,
      message: 'Component run windows must exactly match the prespecified protocol.',
    });
  });

  it('rejects an incomplete valuation component inventory', () => {
    const input = validProvenanceInput();
    input.modelRuns = [input.modelRuns[0]];

    expect(validateAflTradeManifestProvenance(input).issues).toContainEqual({
      code: 'artifact_missing',
      subject: input.valuationBundle.valuationBundleId,
      message: 'Valuation bundle model run inventory must match its exact component references.',
    });
  });

  it('requires the effective Gate 3 decision that pins the exact valuation bundle', () => {
    const input = validProvenanceInput();
    const bundleDecisionId = input.publication.content.gate3DecisionId;
    input.ledger = {
      proposals: input.ledger.proposals.filter(
        (proposal) => proposal.content.decisionKey !==
          input.ledger.decisions.find((decision) => decision.decisionId === bundleDecisionId)?.content
            .decisionKey
      ),
      decisions: input.ledger.decisions.filter(
        (decision) => decision.decisionId !== bundleDecisionId
      ),
    };

    expect(validateAflTradeManifestProvenance(input).issues).toContainEqual({
      code: 'decision_invalid',
      subject: bundleDecisionId,
      message: 'Required gate_3_model_validity decision is absent.',
    });
  });

  it('rejects publication evidence borrowed from one component run', () => {
    const input = validProvenanceInput();
    const playerOutcome = input.modelRuns[0].content.outcome;
    if (playerOutcome.status !== 'succeeded') throw new Error('Expected a successful fixture run.');
    input.publication.content.validationReportArtifact = playerOutcome.validationReportArtifact;

    expect(validateAflTradeManifestProvenance(input).issues).toContainEqual({
      code: 'parent_mismatch',
      subject: input.publication.publicationId,
      message: 'Publication validation report and model card must come from its valuation bundle.',
    });
  });

  it('rejects corpus unsupported cohorts that differ from the coverage report', () => {
    const input = validProvenanceInput();
    input.corpus.content.unsupportedCohortIds = ['fixture-cohort'];

    expect(validateAflTradeManifestProvenance(input).issues).toContainEqual({
      code: 'cohort_mismatch',
      subject: input.corpus.corpusId,
      message: 'Corpus unsupported cohorts must exactly match the approved coverage report.',
    });
  });

  it('prevents a corpus-unsupported cohort from leaking into a feature dataset', () => {
    const input = validProvenanceInput();
    input.coverageReport.content.unsupportedCohorts = [
      {
        cohortId: 'fixture-cohort',
        reason: 'cohort_empty',
        explanation: 'The fixture has no eligible observations.',
      },
    ];
    input.corpus.content.unsupportedCohortIds = ['fixture-cohort'];

    expect(validateAflTradeManifestProvenance(input).issues).toContainEqual({
      code: 'cohort_mismatch',
      subject: `${input.datasets[0].datasetId}:fixture-cohort`,
      message:
        'A corpus-unsupported cohort must be explicitly excluded from every component dataset.',
    });
  });

  it('builds an acyclic component, bundle, publication, and projection chain', () => {
    const playerProtocol = modelProtocol();
    const playerRun = modelRun(runContent(playerProtocol));
    const pickProtocol = pickModelProtocol();
    const pickRun = pickModelRun(pickRunContent(pickProtocol));
    const bundle = valuationBundle(
      valuationBundleContent(playerProtocol, playerRun, pickProtocol, pickRun)
    );
    const candidate = publication(publicationContent(bundle));
    const projectionContentValue = projectionContent(candidate);
    const projection = aflTradeProjectionManifestSchema.parse({
      projectionId: createAflTradeContentAddress('projection', projectionContentValue),
      content: projectionContentValue,
    });

    expect(candidate.content.valuationBundleId).toBe(bundle.valuationBundleId);
    expect(bundle.content.components.map((component) => component.runId)).toEqual([
      playerRun.runId,
      pickRun.runId,
    ]);
    expect(projection.content.publicationId).toBe(candidate.publicationId);
  });

  it('rejects a projection built for any response contract other than v2', () => {
    const content = {
      ...projectionContent(),
      responseContractVersion: 'afl-trade-value/v1',
    };

    expect(
      aflTradeProjectionManifestSchema.safeParse({
        projectionId: createAflTradeContentAddress('projection', content),
        content,
      }).success
    ).toBe(false);
  });

  it('requires a clean source tree for a reproducible model run', () => {
    const content = { ...runContent(), cleanWorktree: false };
    expect(
      aflTradeModelRunManifestSchema.safeParse({
        runId: createAflTradeContentAddress('model-run', content),
        content,
      }).success
    ).toBe(false);
  });

  it('records failed runs without allowing them to impersonate successful output', () => {
    const content = {
      ...runContent(),
      candidateLockedAt: null,
      finalTestEvaluatedAt: null,
      outcome: {
        status: 'failed' as const,
        failureClassification: 'validation_failure' as const,
        failureArtifact: artifact('e'),
        diagnosticsArtifact: artifact('f'),
      },
    };

    expect(
      aflTradeModelRunManifestSchema.parse({
        runId: createAflTradeContentAddress('model-run', content),
        content,
      }).content.outcome.status
    ).toBe('failed');

    const impersonatingContent = {
      ...content,
      outcome: { ...content.outcome, modelArtifact: artifact('a') },
    };
    expect(
      aflTradeModelRunManifestSchema.safeParse({
        runId: createAflTradeContentAddress('model-run', impersonatingContent),
        content: impersonatingContent,
      }).success
    ).toBe(false);
  });

  it('requires successful validation evidence and candidate lock before final testing', () => {
    const valid = runContent();
    const reversedMilestones = {
      ...valid,
      candidateLockedAt: '2026-08-05T00:50:00.000Z',
      finalTestEvaluatedAt: '2026-08-05T00:40:00.000Z',
    };
    const successfulOutcome = valid.outcome;
    const { leakageAuditArtifact: _omitted, ...incompleteOutcome } = successfulOutcome;
    const incompleteEvidence = { ...valid, outcome: incompleteOutcome };

    for (const content of [reversedMilestones, incompleteEvidence]) {
      expect(
        aflTradeModelRunManifestSchema.safeParse({
          runId: createAflTradeContentAddress('model-run', content),
          content,
        }).success
      ).toBe(false);
    }
  });

  it('rejects a forward projection reference from a publication manifest', () => {
    const content = publicationContent();
    const invalidContent = { ...content, projectionId: `projection:${digest('f')}` };

    expect(
      aflTradePublicationManifestSchema.safeParse({
        publicationId: createAflTradeContentAddress('publication', invalidContent),
        content: invalidContent,
      }).success
    ).toBe(false);
  });

  it('rejects publication and projection content altered after hashing', () => {
    const candidate = publication();
    const content = projectionContent(candidate);
    const projection = aflTradeProjectionManifestSchema.parse({
      projectionId: createAflTradeContentAddress('projection', content),
      content,
    });

    expect(
      aflTradePublicationManifestSchema.safeParse({
        ...candidate,
        content: { ...candidate.content, entryCount: 11 },
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionManifestSchema.safeParse({
        ...projection,
        content: { ...projection.content, documentCount: 11 },
      }).success
    ).toBe(false);
  });

  it('fails the full provenance boundary immediately for an invalid decision ledger', () => {
    const duplicateProposal = {
      proposalId: 'duplicate',
      content: {
        gate: 'gate_0a_permission_to_evaluate',
        environment: 'test_fixture',
        decisionKey: 'duplicate',
        version: 1,
      },
    };
    const input = {
      ledger: {
        proposals: [duplicateProposal, duplicateProposal],
        decisions: [],
      },
    } as unknown as AflTradeManifestProvenanceInput;

    expect(validateAflTradeManifestProvenance(input)).toEqual({
      valid: false,
      issues: [
        {
          code: 'invalid_ledger',
          subject: 'ledger',
          message: 'The gate decision ledger is invalid.',
        },
      ],
    });
  });
});
