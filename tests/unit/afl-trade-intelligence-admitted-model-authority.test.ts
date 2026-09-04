import { describe, expect, it } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_VALUATION_DATASET_CANDIDATE_SCHEMA_VERSION,
  AFL_TRADE_VALUATION_DATASET_ROW_SCHEMA_VERSION,
  createAflTradeValuationDatasetAdmissionReceipt,
  createAflTradeValuationDatasetCandidate,
  createAflTradeValuationDatasetRow,
  createAflTradeValuationDatasetSpecification,
} from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
import {
  AFL_TRADE_PLAYER_MODEL_PROTOCOL_SCHEMA_VERSION_V2,
  aflTradeAnyPlayerContributionModelProtocolSchema,
  createAflTradePlayerContributionModelProtocolV2,
} from '@/server/aflTradeIntelligence/artifacts/modelProtocol';
import {
  AFL_TRADE_MODEL_RUN_SCHEMA_VERSION_V3,
  aflTradeAnyModelRunManifestSchema,
  createAflTradeModelRunIntent,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import {
  AflTradeAdmittedModelRunner,
  AflTradeAdmittedModelRunAuthorityService,
  createAflTradeModelRunOperationalAuthorization,
  createAflTradePrivateValuationModelRunOperationalAuthorization,
  type AflTradeAdmittedModelRunEvidence,
  type AflTradeModelRunAuthorizationStore,
} from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createAflTradePlayerObservationSetV2 } from '@/server/aflTradeIntelligence/modeling/playerContributionContracts';
import {
  AFL_TRADE_ACQUISITION_SPELL_METRIC_AUTHORITY_BOUNDARY,
  AFL_TRADE_ACQUISITION_SPELL_METRIC_SCHEMA_VERSION,
  createAflTradeAcquisitionSpellMetric,
  type AflTradeAcquisitionSpellMetric,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellMetricContracts';
import {
  createAflTradeReconciledFactualMetric,
  createAflTradeReconciledSubjectKey,
} from '@/server/aflTradeIntelligence/outcomes/factualReconciliationContracts';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';

import { createAflTradeGateDecisionFixture } from '../fixtures/aflDraftTradeOutcomeReleaseFixture';

const digest = (character: string) => character.repeat(64);
const retainedArtifactBytes = new Map<string, Uint8Array>();

function artifact(character: string) {
  const bytes = new TextEncoder().encode(`fixture-artifact-${character}`);
  const reference = createAflTradeByteArtifactRef(
    bytes,
    'application/json',
    '2026-08-10T00:00:00.000Z'
  );
  retainedArtifactBytes.set(reference.artifactId, bytes);
  return reference;
}

function windows() {
  return {
    train: { from: '2010-01-01T00:00:00.000Z', to: '2013-01-01T00:00:00.000Z' },
    calibration: { from: '2013-01-08T00:00:00.000Z', to: '2016-01-01T00:00:00.000Z' },
    validation: { from: '2016-01-08T00:00:00.000Z', to: '2019-01-01T00:00:00.000Z' },
    finalTest: { from: '2019-01-08T00:00:00.000Z', to: '2022-01-01T00:00:00.000Z' },
    embargoDays: 7,
  };
}

const outcomeMetricCodes = ['brownlow_votes', 'coaches_votes', 'games', 'goals'] as const;

function exactReference(prefix: string, marker: string) {
  const sha256 = digest(marker);
  return { id: `${prefix}:${sha256}`, sha256 };
}

function spellMetricFixture(input: {
  index: number;
  season: number;
  playerId: string;
  clubId: string;
  spellId: string;
  spellVersionId: string;
  metricCode: (typeof outcomeMetricCodes)[number];
  numericValue: string;
  recordedAt: string;
}): AflTradeAcquisitionSpellMetric {
  const marker = (input.index % 16).toString(16);
  const definition = exactReference('metric-definition', marker);
  const sourceFact = exactReference('source-fact', marker);
  const result = createAflTradeReconciledFactualMetric({
    resultKind: input.metricCode === 'games' ? 'derived_games' : 'source_metric',
    grain: 'match',
    playerId: input.playerId,
    clubScope: { kind: 'resolved_single_club', clubId: input.clubId },
    matchId: `afl-match:${input.season}:${input.index}`,
    competition: 'AFLM',
    seasonYear: input.season,
    metricCode: input.metricCode,
    definitionVersion: input.metricCode === 'games' ? 'games/v1' : `${input.metricCode}/v1`,
    definition,
    unit: input.metricCode,
    availability: { state: 'measured', numericValue: input.numericValue, reasonCode: null },
    coverageNumerator: 1,
    coverageDenominator: 1,
    effectiveThrough: `${input.season}-12-31T00:00:00.000Z`,
    recordedAt: input.recordedAt,
    ...(input.metricCode === 'games'
      ? {
          appearanceMembers: [
            {
              sourceFactId: sourceFact.id,
              sourceFactSha256: sourceFact.sha256,
              priority: 1,
              provider: 'fixture-provider',
              capabilityId: 'fixture-player-appearance',
              availability: 'measured',
              numericValue: input.numericValue,
            },
          ],
          selectedAppearanceFactIds: [sourceFact.id],
          matchUniverseFactIds: [sourceFact.id],
          selectedMatchUniverseFactIds: [sourceFact.id],
        }
      : {
          members: [
            {
              sourceFactId: sourceFact.id,
              sourceFactSha256: sourceFact.sha256,
              priority: 1,
              provider: 'fixture-provider',
              capabilityId: 'fixture-player-stats',
              availability: 'measured',
              numericValue: input.numericValue,
            },
          ],
          selectedMemberIds: [sourceFact.id],
        }),
  });
  const policy = exactReference('acquisition-spell-metric-policy', marker);
  const rule = exactReference('acquisition-spell-rule', marker);
  const factualRunId = `factual-reconciliation-run:${digest(marker)}`;
  const finalizationId = createAflTradeContentAddress('factual-reconciliation-finalization', {
    factualRunId,
    runSha256: digest(marker),
    finalizedAt: input.recordedAt,
  });
  const subjectKey = createAflTradeReconciledSubjectKey({
    environment: 'test_fixture',
    competition: result.content.competition,
    seasonYear: result.content.seasonYear,
    playerId: result.content.playerId,
    clubScope: result.content.clubScope,
    matchId: result.content.matchId,
    metricCode: result.content.metricCode,
    definitionVersion: result.content.definitionVersion,
  });
  return createAflTradeAcquisitionSpellMetric({
    schemaVersion: AFL_TRADE_ACQUISITION_SPELL_METRIC_SCHEMA_VERSION,
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    authorityBoundary: AFL_TRADE_ACQUISITION_SPELL_METRIC_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    policyId: policy.id,
    policySha256: policy.sha256,
    spell: {
      spellVersionId: input.spellVersionId,
      spellId: input.spellId,
      version: 1,
      playerId: input.playerId,
      clubId: input.clubId,
      startEventVersionId: `event-version:${input.index}`,
      startAssetVersionId: `asset-version:${input.index}`,
      startDate: `${input.season}-01-02`,
      endDate: null,
      rule,
      status: 'approved',
      recordedAt: `${input.season}-01-02T00:00:00.000Z`,
    },
    rule: {
      metricCode: input.metricCode,
      definitionVersion: result.content.definitionVersion,
      definition,
      unit: input.metricCode,
      sourceGrain: 'match',
      aggregation: 'sum_non_negative_integer',
      attribution: 'exact_player_real_club_and_effective_date_inside_spell',
      noEvidenceSemantics: 'unavailable_never_zero',
      conflictSemantics: 'preserve_conflict_and_withhold_numeric_total',
    },
    availability: { state: 'complete', numericValue: input.numericValue, reasonCode: null },
    coverageNumerator: 1,
    coverageDenominator: 1,
    observationCount: 1,
    effectiveThrough: `${input.season}-12-31`,
    members: [
      {
        factualRunId,
        factualRunSha256: digest(marker),
        environment: 'test_fixture',
        finalization: {
          id: finalizationId,
          sha256: finalizationId.slice('factual-reconciliation-finalization:'.length),
        },
        finalizedAt: input.recordedAt,
        subjectKey,
        headRevision: 1,
        result,
      },
    ],
    recordedAt: input.recordedAt,
  });
}

function valuationDatasetFixture() {
  const partitions = [
    { role: 'train' as const, season: 2011, prediction: '2011-01-01T00:00:00.000Z' },
    { role: 'train' as const, season: 2011, prediction: '2011-01-01T00:00:00.000Z' },
    { role: 'calibration' as const, season: 2014, prediction: '2014-01-08T00:00:00.000Z' },
    { role: 'validation' as const, season: 2017, prediction: '2017-01-08T00:00:00.000Z' },
    { role: 'final_test' as const, season: 2020, prediction: '2020-01-08T00:00:00.000Z' },
  ];
  const spellMetrics: AflTradeAcquisitionSpellMetric[] = [];
  const rows = partitions.map(({ role, season, prediction }, index) => {
    const targetFrom = `${season}-01-${role === 'train' ? '02' : '09'}`;
    const playerId = index < 2 ? 'afl-player:shared' : `afl-player:${index + 1}`;
    const clubId = `afl-club:${index + 1}`;
    const spellId = `acquisition-spell:${index + 1}`;
    const spellVersionId = `acquisition-spell-version:${String(index + 1).repeat(64)}`;
    const recordedAt = `${season + 1}-01-01T00:00:00.000Z`;
    const rowMetrics = outcomeMetricCodes.map((metricCode, metricIndex) =>
      spellMetricFixture({
        index: index + 1,
        season,
        playerId,
        clubId,
        spellId,
        spellVersionId,
        metricCode,
        numericValue: metricCode === 'games' ? '1' : String((index + 1) * (metricIndex + 1)),
        recordedAt,
      })
    );
    const featureMetric = spellMetricFixture({
      index: index + 25,
      season: season - 1,
      playerId,
      clubId,
      spellId: `feature-spell:${index + 1}`,
      spellVersionId: `acquisition-spell-version:${String(index + 5).repeat(64)}`,
      metricCode: 'goals',
      numericValue: String(index + 1),
      recordedAt: prediction,
    });
    spellMetrics.push(featureMetric, ...rowMetrics);
    const targetInputs = rowMetrics
      .map((metric) => ({
        kind: 'acquisition_spell_metric' as const,
        memberId: metric.spellMetricVersionId,
        recordSha256: metric.factSha256,
        headRevision: 1,
        effectiveFrom: targetFrom,
        effectiveThrough: metric.content.effectiveThrough,
        recordedAt: metric.content.recordedAt,
        state: 'complete' as const,
        playerId,
        clubId,
        spellVersionId,
        metricCode: metric.content.rule.metricCode,
      }))
      .sort((left, right) => left.memberId.localeCompare(right.memberId));
    return createAflTradeValuationDatasetRow({
      schemaVersion: AFL_TRADE_VALUATION_DATASET_ROW_SCHEMA_VERSION,
      ordinal: index + 1,
      rowKey: `row:${index + 1}`,
      competition: 'AFLM',
      seasonYear: season,
      cohortIds: ['era:modern', 'role:unknown'],
      predictionOriginAt: prediction,
      featureKnownThrough: prediction,
      targetFrom: `${targetFrom}T00:00:00.000Z`,
      targetThrough: `${season}-12-31T00:00:00.000Z`,
      splitRole: role,
      leakageGroups: { acquisition_spell: spellId, event: `event:${index + 1}`, player: playerId },
      identity: {
        playerId,
        playerResolutionDecisionId: `provider-resolution-decision:${String(index + 1).repeat(64)}`,
        playerAssignmentRevision: 1,
        clubId,
        clubResolutionDecisionId: `provider-resolution-decision:${String(index + 5).repeat(64)}`,
        clubAssignmentRevision: 1,
      },
      lineage: {
        eventId: `event:${index + 1}`,
        eventVersionId: `event-version:${index + 1}`,
        acquisitionSpellId: spellId,
        acquisitionSpellVersionId: spellVersionId,
        lineageEdgeIds: [],
      },
      featureInputs: [
        {
          kind: 'acquisition_spell_metric',
          memberId: featureMetric.spellMetricVersionId,
          recordSha256: featureMetric.factSha256,
          headRevision: 1,
          effectiveFrom: `${season - 1}-01-01`,
          effectiveThrough: featureMetric.content.effectiveThrough,
          recordedAt: featureMetric.content.recordedAt,
          state: 'complete',
          playerId,
          clubId,
          spellVersionId: featureMetric.content.spell.spellVersionId,
          metricCode: 'goals',
        },
      ],
      targetInputs,
    });
  });
  const specification = createAflTradeValuationDatasetSpecification({
    schemaVersion: 'afl-trade-valuation-dataset-specification/v1',
    environment: 'test_fixture',
    scopeKey: 'public-afl-draft-trade-outcomes',
    competition: 'AFLM',
    modelKind: 'player_contribution_and_availability',
    createdAt: '2026-08-10T00:00:00.000Z',
    rowGrain: 'player_acquisition_spell_prediction',
    featurePolicy: {
      knowledgeJoin: 'point_in_time_as_known_at_prediction_cutoff',
      correctionAvailability: 'only_after_known_from',
      unknownAndZero: 'distinct',
      targetDerivedFeatures: 'prohibited',
      postOutcomeFeatures: 'prohibited',
    },
    targetPolicy: {
      targetKind: 'future_real_club_contribution',
      targetStarts: 'strictly_after_prediction_origin',
      activeCareerTreatment: 'right_censored',
      unavailableObservationTreatment: 'explicit_unavailable_not_zero',
    },
    splits: [
      { role: 'train', from: '2010-01-01', to: '2013-01-01' },
      { role: 'calibration', from: '2013-01-08', to: '2016-01-01' },
      { role: 'validation', from: '2016-01-08', to: '2019-01-01' },
      { role: 'final_test', from: '2019-01-08', to: '2022-01-01' },
    ],
    embargoDays: 7,
    leakageGroupKinds: ['acquisition_spell', 'event', 'player'],
    featureDefinitions: [artifact('1')],
    targetDefinition: artifact('2'),
    valueUnitDefinition: artifact('3'),
    roleTaxonomy: artifact('4'),
    eraDefinition: artifact('5'),
    censoringDefinition: artifact('6'),
    inclusionPolicy: artifact('7'),
  });
  const candidate = createAflTradeValuationDatasetCandidate({
    schemaVersion: AFL_TRADE_VALUATION_DATASET_CANDIDATE_SCHEMA_VERSION,
    authorityBoundary:
      'private_factual_feature_dataset_no_model_fit_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'test_fixture',
    scopeKey: 'public-afl-draft-trade-outcomes',
    competition: 'AFLM',
    createdAt: '2026-08-10T00:00:00.000Z',
    knowledgeCutoffAt: '2026-08-09T00:00:00.000Z',
    factualParent: {
      corpusId: `corpus:${digest('1')}`,
      corpusToCandidateLineageId: `corpus-factual-lineage:${digest('2')}`,
      factualReleaseId: `outcome-release:${digest('3')}`,
      factualCandidateId: `factual-release-candidate:${digest('4')}`,
      sourceMemberSetSha256: digest('5'),
      archiveDatasetId: `archive-dataset:${digest('6')}`,
      sourceSnapshotSetId: `source-snapshot-set:${digest('7')}`,
      metricRegistryVersion: 'fixture-v1',
      acquisitionSpellRuleId: `acquisition-spell-rule:${digest('8')}`,
      factualEffectiveThrough: '2025-12-31T00:00:00.000Z',
      releaseRecordStateId: `outcome-release-record-state:${digest('9')}`,
      releaseApprovalEventId: `outcome-release-event:${digest('a')}`,
      releaseRegistryRevision: 1,
    },
    specification,
    requiredSourceUses: {
      operations: ['derived_feature_creation', 'model_training'],
      fieldUses: ['derived_feature', 'model_training'],
      publicDerivedOutput: 'not_authorized_by_dataset_admission',
      revalidateAtModelRunStart: true,
    },
    includedCohorts: ['era:modern', 'role:unknown'],
    excludedCohorts: [],
    rows,
    exclusionReport: artifact('8'),
    datasetArtifact: artifact('9'),
    extractor: { codeArtifact: artifact('a'), configurationArtifact: artifact('b') },
  });
  return { candidate, spellMetrics };
}

function protocolContent() {
  return {
    schemaVersion: AFL_TRADE_PLAYER_MODEL_PROTOCOL_SCHEMA_VERSION_V2,
    environment: 'test_fixture' as const,
    protocolKey: 'fixture-admitted-player-model',
    version: 1,
    modelKind: 'player_contribution_and_availability' as const,
    datasetId: `dataset:${digest('1')}`,
    datasetAdmission: {
      schemaVersion: 'afl-trade-dataset-admission/v3' as const,
      admissionId: `dataset-admission:${digest('2')}`,
      admittedAt: '2026-08-10T00:01:00.000Z',
    },
    preparedAt: '2026-08-10T00:02:00.000Z',
    preparedBy: 'fixture-model-owner',
    proposalOrigin: 'human_authored' as const,
    publicIdentityBoundary: 'source_native_no_fantasy_ownership' as const,
    estimands: [
      'at_trade_future_contribution' as const,
      'realized_club_contribution' as const,
      'remaining_contribution' as const,
    ],
    valueUnit: {
      valueUnitId: 'fixture-football-contribution',
      label: 'Fixture football contribution',
      definitionArtifact: artifact('3'),
      aggregation: 'additive_contribution' as const,
    },
    footballContext: {
      roleTaxonomyArtifact: artifact('4'),
      eraDefinitionArtifact: artifact('5'),
      roleAssignmentTiming: 'as_known_at_prediction_cutoff' as const,
      unknownRoleTreatment: 'explicit_unknown_role' as const,
    },
    replacementBaseline: {
      definitionArtifact: artifact('6'),
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
      featureAvailabilityArtifact: artifact('7'),
    },
    contributionAndCensoringPolicy: {
      clubContributionEnd: 'real_club_departure_or_observation_end' as const,
      activeCareerTreatment: 'right_censored' as const,
      unavailableObservationTreatmentArtifact: artifact('8'),
      censoringDefinitionArtifact: artifact('6'),
    },
    scalarValueTransformArtifact: artifact('f'),
    windows: windows(),
    modelSelectionPolicy: {
      candidateSelectionData: 'train_calibration_validation_only' as const,
      finalTestUse: 'single_evaluation_after_candidate_lock' as const,
      finalTestRetuning: 'prohibited' as const,
    },
    validationPlan: {
      baselineDefinitionArtifacts: [artifact('a')],
      metricDefinitionArtifacts: [artifact('b')],
      intervalCalibrationArtifact: artifact('c'),
      subgroupDimensions: [
        'era' as const,
        'role' as const,
        'position' as const,
        'age' as const,
        'availability_state' as const,
        'evidence_quality' as const,
      ],
      sensitivityAnalysisArtifacts: [artifact('d')],
      acceptanceCriteriaArtifact: artifact('e'),
    },
    limitations: ['Fixture protocol is not production authority.'],
  };
}

function runContent(protocol = createAflTradePlayerContributionModelProtocolV2(protocolContent())) {
  return {
    schemaVersion: AFL_TRADE_MODEL_RUN_SCHEMA_VERSION_V3,
    environment: 'test_fixture' as const,
    modelId: 'fixture-player-model',
    modelVersion: 'fixture-v1',
    datasetId: protocol.content.datasetId,
    datasetAdmissionId: protocol.content.datasetAdmission.admissionId,
    modelProtocolId: protocol.protocolId,
    runIntentId: `model-run-intent:${digest('4')}`,
    runAuthorizationId: `model-run-authorization:${digest('3')}`,
    observationSetId: `player-observation-set:${digest('f')}`,
    modelTrainingEvaluationReceiptIds: [
      `gate0a-evaluation:${digest('1')}`,
      `gate0a-evaluation:${digest('2')}`,
    ],
    codeCommitSha: digest('a'),
    cleanWorktree: true as const,
    seed: 17,
    job: {
      jobId: 'fixture-model-job',
      attempt: 1,
      initiatedBy: 'fixture-model-owner',
      workerIdentity: 'fixture-model-worker',
    },
    startedAt: '2026-08-10T00:03:00.000Z',
    candidateLockedAt: '2026-08-10T00:04:00.000Z',
    finalTestEvaluatedAt: '2026-08-10T00:05:00.000Z',
    finishedAt: '2026-08-10T00:06:00.000Z',
    windows: windows(),
    sourceCodeArtifact: artifact('1'),
    dependencyLockArtifact: artifact('2'),
    runtimeArtifact: artifact('3'),
    containerArtifact: artifact('4'),
    configurationArtifact: artifact('5'),
    environmentArtifact: artifact('6'),
    featureDefinitionArtifacts: [artifact('7')],
    outcome: {
      status: 'succeeded' as const,
      modelArtifact: artifact('8'),
      validationReportArtifact: artifact('9'),
      baselineComparisonArtifact: artifact('a'),
      calibrationReportArtifact: artifact('b'),
      intervalCoverageArtifact: artifact('c'),
      subgroupReportArtifact: artifact('d'),
      sensitivityReportArtifact: artifact('e'),
      leakageAuditArtifact: artifact('f'),
      modelCardArtifact: artifact('1'),
      diagnosticsArtifact: artifact('2'),
    },
  };
}

function admittedRunFixture() {
  const { candidate: datasetCandidate, spellMetrics } = valuationDatasetFixture();
  const rightsContent = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: 'fixture-model-source',
    provider: 'Fixture provider',
    dataset: 'Fixture admitted model facts',
    datasetVersion: 'fixture-v1',
    intendedPurpose: 'Verify the pre-fit admitted-model authority boundary.',
    scope: {
      competitions: ['AFLM'],
      seasonRanges: [{ from: 2026, to: 2026 }],
      accessMechanism: 'manual_review' as const,
    },
    acquisition: {
      kind: 'provided_artifact' as const,
      mediaType: 'application/json',
      deliveryMethod: 'Fabricated fixture evidence',
    },
    operations: {
      bounded_evaluation_capture: 'blocked' as const,
      raw_evidence_retention: 'blocked' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'allowed' as const,
      derived_feature_creation: 'allowed' as const,
      public_derived_output: 'blocked' as const,
      public_fact_display: 'blocked' as const,
      raw_field_redistribution: 'blocked' as const,
    },
    automatedAccess: {
      permitted: false,
      identification: null,
      rateLimit: null,
      cache: { permitted: false, maximumSeconds: null },
    },
    retention: {
      rawEvidence: {
        disposition: 'prohibited' as const,
        maximumDays: null,
        deleteOnWithdrawal: true,
        basis: 'Fixture raw bytes are not retained.',
      },
      hashesAndMetadata: {
        disposition: 'retained' as const,
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis: 'Fixture evidence only.',
      },
      derivedArtifacts: {
        disposition: 'retained' as const,
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis: 'Fixture evidence only.',
      },
    },
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: false },
    attribution: { required: false, text: null, placement: null },
    restrictions: { geographic: [], commercial: [], audience: [] },
    fields: [
      {
        sourceField: 'games',
        normalizedField: 'games',
        uses: {
          archive_fact: 'allowed' as const,
          model_training: 'allowed' as const,
          derived_feature: 'allowed' as const,
          public_display: 'blocked' as const,
        },
        attributionRequired: false,
        notes: null,
      },
    ],
    conditions: [],
    rightsEvidenceIds: [`artifact:${digest('4')}`],
    termsEffectiveAt: '2026-08-01T00:00:00.000Z',
    termsExpireAt: '2027-08-01T00:00:00.000Z',
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions: 'Delete fixture derivatives.',
      retainableAuditMaterial: 'Retain fixture hashes only.',
    },
    proposedAt: '2026-08-01T00:00:00.000Z',
    proposedBy: 'fixture-owner',
    proposalOrigin: 'human_authored' as const,
  };
  const rights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const decisionKey = 'fixture-admitted-model-rights';
  const gate = createAflTradeGateDecisionFixture({
    gate: 'gate_0a_permission_to_evaluate',
    decisionKey,
    decidedAt: '2026-08-10T00:00:00.000Z',
    revalidateAt: '2027-08-01T00:00:00.000Z',
    affectedArtifacts: [{ kind: 'source_rights', artifactId: rights.rightsArtifactId }],
    scopeDimensions: [
      { name: 'source_rights_artifact', values: [rights.rightsArtifactId] },
      { name: 'competition', values: ['AFLM'] },
      { name: 'season', values: ['2026'] },
      { name: 'access_mechanism', values: ['manual_review'] },
      { name: 'geography', values: ['fixture'] },
      { name: 'commercial_context', values: ['fixture'] },
      { name: 'audience', values: ['internal_fixture'] },
      { name: 'operation', values: ['derived_feature_creation', 'model_training'] },
    ],
  });
  const gate2DecisionKey = 'fixture-admitted-model-corpus';
  const gate2 = createAflTradeGateDecisionFixture({
    gate: 'gate_2_corpus_lineage',
    decisionKey: gate2DecisionKey,
    decidedAt: '2026-08-10T00:00:00.000Z',
    revalidateAt: '2027-08-01T00:00:00.000Z',
    affectedArtifacts: [
      { kind: 'corpus_manifest', artifactId: datasetCandidate.content.factualParent.corpusId },
      {
        kind: 'corpus_factual_lineage',
        artifactId: datasetCandidate.content.factualParent.corpusToCandidateLineageId,
      },
      {
        kind: 'factual_release',
        artifactId: datasetCandidate.content.factualParent.factualReleaseId,
      },
      {
        kind: 'factual_release_candidate',
        artifactId: datasetCandidate.content.factualParent.factualCandidateId,
      },
    ],
    scopeDimensions: [
      { name: 'scope', values: [datasetCandidate.content.scopeKey] },
      { name: 'competition', values: [datasetCandidate.content.competition] },
    ],
  });
  const request = {
    decisionKey,
    environment: 'test_fixture' as const,
    rightsArtifactId: rights.rightsArtifactId,
    competition: 'AFLM',
    season: 2026,
    accessMechanism: 'manual_review' as const,
    capabilityId: null,
    geography: 'fixture',
    commercialContext: 'fixture',
    audience: 'internal_fixture',
    operations: ['derived_feature_creation', 'model_training'] as const,
    fieldUses: [
      { sourceField: 'games', use: 'derived_feature' as const },
      { sourceField: 'games', use: 'model_training' as const },
    ],
    rawRetentionDays: null,
    metadataRetentionDays: 365,
    cacheSeconds: null,
  };
  const derivationReceipt = createAflTradeGate0AReceipt(
    gate.ledger,
    rights,
    { ...request, evaluatedAt: '2026-08-10T00:00:00.000Z' },
    '2026-08-10T00:00:00.000Z'
  );
  const admissionEvaluationReceipt = createAflTradeGate0AReceipt(
    gate.ledger,
    rights,
    { ...request, evaluatedAt: '2026-08-10T00:01:00.000Z' },
    '2026-08-10T00:01:00.000Z'
  );
  const runStartEvaluationReceipt = createAflTradeGate0AReceipt(
    gate.ledger,
    rights,
    { ...request, evaluatedAt: '2026-08-10T00:03:00.000Z' },
    '2026-08-10T00:03:00.000Z'
  );
  const datasetId = datasetCandidate.datasetId;
  const admission = createAflTradeValuationDatasetAdmissionReceipt({
    schemaVersion: 'afl-trade-dataset-admission/v3',
    authorityBoundary: 'dataset_admission_only_no_model_fit_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'test_fixture',
    admittedAt: '2026-08-10T00:01:00.000Z',
    datasetCreatedAt: '2026-08-10T00:00:00.000Z',
    datasetId,
    datasetSha256: datasetId.slice('dataset:'.length),
    factualReleaseId: datasetCandidate.content.factualParent.factualReleaseId,
    factualCandidateId: datasetCandidate.content.factualParent.factualCandidateId,
    sourceMemberSetSha256: datasetCandidate.content.factualParent.sourceMemberSetSha256,
    corpusId: datasetCandidate.content.factualParent.corpusId,
    corpusToCandidateLineageId: datasetCandidate.content.factualParent.corpusToCandidateLineageId,
    gate2Decision: {
      decisionId: gate2.ledger.decisions[0]!.decisionId,
      state: 'approved',
      effectiveAt: '2026-08-10T00:00:00.000Z',
      evaluatedAt: '2026-08-10T00:01:00.000Z',
      revalidateAt: '2027-08-01T00:00:00.000Z',
      pinnedCorpusId: datasetCandidate.content.factualParent.corpusId,
      pinnedCorpusToCandidateLineageId:
        datasetCandidate.content.factualParent.corpusToCandidateLineageId,
      pinnedFactualReleaseId: datasetCandidate.content.factualParent.factualReleaseId,
      pinnedFactualCandidateId: datasetCandidate.content.factualParent.factualCandidateId,
    },
    sourceRightsEvaluations: [
      {
        captureId: 'fixture-capture',
        sourceSnapshotId: `source-snapshot:${digest('b')}`,
        consumedFieldSetId: `consumed-field-set:${digest('c')}`,
        proposalId: rights.rightsArtifactId,
        derivationDecisionId: derivationReceipt.content.result.decisionId!,
        derivationEvaluationReceiptId: derivationReceipt.receiptId,
        derivationEvaluatedAt: derivationReceipt.content.request.evaluatedAt,
        admissionDecisionId: admissionEvaluationReceipt.content.result.decisionId!,
        admissionEvaluationReceiptId: admissionEvaluationReceipt.receiptId,
        admissionEvaluatedAt: admissionEvaluationReceipt.content.request.evaluatedAt,
        consumedFieldSetSha256: digest('d'),
        operations: ['derived_feature_creation', 'model_training'],
        fieldUses: ['derived_feature', 'model_training'],
        status: 'approved',
        termsValidThrough: '2027-08-01T00:00:00.000Z',
      },
    ],
    analyticalAuthorityReceiptId: `architecture-operation-receipt:${digest('e')}`,
    operationalAuthorizationReceiptId: `architecture-operation-receipt:${digest('f')}`,
  });
  const protocol = createAflTradePlayerContributionModelProtocolV2({
    ...protocolContent(),
    datasetId,
    datasetAdmission: {
      schemaVersion: 'afl-trade-dataset-admission/v3',
      admissionId: admission.admissionId,
      admittedAt: admission.content.admittedAt,
    },
  });
  const observationSet = createAflTradePlayerObservationSetV2({
    candidate: datasetCandidate,
    datasetAdmissionId: admission.admissionId,
    modelProtocolId: protocol.protocolId,
    spellMetrics,
  });
  const intent = createAflTradeModelRunIntent({
    environment: 'test_fixture',
    modelId: 'fixture-player-model',
    modelVersion: 'fixture-v1',
    datasetId,
    datasetAdmissionId: admission.admissionId,
    modelProtocolId: protocol.protocolId,
    observationSetId: observationSet.observationSetId,
    codeCommitSha: digest('a'),
    cleanWorktree: true,
    seed: 17,
    job: {
      jobId: 'fixture-model-job',
      attempt: 1,
      initiatedBy: 'fixture-model-owner',
      workerIdentity: 'fixture-model-worker',
    },
    startedAt: '2026-08-10T00:03:00.000Z',
    windows: windows(),
    sourceCodeArtifact: artifact('1'),
    dependencyLockArtifact: artifact('2'),
    runtimeArtifact: artifact('3'),
    containerArtifact: artifact('4'),
    configurationArtifact: artifact('5'),
    environmentArtifact: artifact('6'),
    featureDefinitionArtifacts: [
      ...datasetCandidate.content.specification.content.featureDefinitions,
    ],
    modelTrainingEvaluationReceiptIds: [runStartEvaluationReceipt.receiptId],
  });
  const operationalAuthorization = createAflTradeModelRunOperationalAuthorization({
    environment: intent.content.environment,
    runIntentId: intent.intentId,
    datasetId: intent.content.datasetId,
    datasetAdmissionId: intent.content.datasetAdmissionId,
    modelProtocolId: intent.content.modelProtocolId,
    observationSetId: intent.content.observationSetId,
    authorizedAt: intent.content.startedAt,
    validThrough: '2026-08-10T00:03:30.000Z',
    principalRef: 'fixture-model-operator',
    role: 'afl_trade_model_run_operator',
    authorityEvidence: {
      id: `reviewer-authority-evidence:${digest('e')}`,
      sha256: digest('e'),
    },
  });
  const executableReferences = [
    intent.content.sourceCodeArtifact,
    intent.content.dependencyLockArtifact,
    intent.content.runtimeArtifact,
    intent.content.containerArtifact,
    intent.content.configurationArtifact,
    intent.content.environmentArtifact,
    ...intent.content.featureDefinitionArtifacts,
    protocol.content.valueUnit.definitionArtifact,
    protocol.content.footballContext.roleTaxonomyArtifact,
    protocol.content.footballContext.eraDefinitionArtifact,
    protocol.content.replacementBaseline.definitionArtifact,
    protocol.content.featurePolicy.featureAvailabilityArtifact,
    protocol.content.contributionAndCensoringPolicy.unavailableObservationTreatmentArtifact,
    protocol.content.contributionAndCensoringPolicy.censoringDefinitionArtifact,
    protocol.content.scalarValueTransformArtifact,
    ...protocol.content.validationPlan.baselineDefinitionArtifacts,
    ...protocol.content.validationPlan.metricDefinitionArtifacts,
    protocol.content.validationPlan.intervalCalibrationArtifact,
    ...protocol.content.validationPlan.sensitivityAnalysisArtifacts,
    protocol.content.validationPlan.acceptanceCriteriaArtifact,
  ];
  const evidence: AflTradeAdmittedModelRunEvidence = {
    registeredProtocol: protocol,
    admission,
    datasetCandidate,
    observationSet,
    admissionEvaluationReceipts: [admissionEvaluationReceipt],
    runStartEvaluationReceipts: [runStartEvaluationReceipt],
    sourceRightsProposals: [rights],
    gateLedgerRevision: gate.ledger.decisions.length,
    gateDecisionLedger: gate.ledger,
    gate2DecisionKey,
    gate2Ledger: gate2.ledger,
    operationalAuthorization,
    spellMetrics,
    executableArtifacts: [
      ...new Map(
        executableReferences.map((reference) => [reference.artifactId, reference] as const)
      ).values(),
    ].map((reference) => ({
      artifactId: reference.artifactId,
      bytes: retainedArtifactBytes.get(reference.artifactId)!,
    })),
  };
  return {
    admission,
    datasetCandidate,
    evidence,
    intent,
    observationSet,
    operationalAuthorization,
    protocol,
    runStartEvaluationReceipt,
    spellMetrics,
  };
}

function fixedClock(value = '2026-08-10T00:03:00.000Z') {
  return { now: async () => value };
}

function memoryFailureRecorder() {
  return {
    recordExecutionFailure: async ({ failedAt }: { failedAt: string }) => ({
      candidateLockedAt: null,
      finalTestEvaluatedAt: null,
      finishedAt: failedAt,
      outcome: {
        status: 'failed' as const,
        failureClassification: 'training_failure' as const,
        failureArtifact: artifact('d'),
        diagnosticsArtifact: artifact('e'),
      },
    }),
  };
}

function memoryAuthorizationStore(): AflTradeModelRunAuthorizationStore & {
  persistCompletedRun: (run: { runId: string }) => Promise<boolean>;
} {
  const authorizationByIntent = new Map<string, string>();
  const consumedIntents = new Set<string>();
  return {
    issueOnceForIntent: async ({ authorization, intent }) => {
      const prior = authorizationByIntent.get(intent.intentId);
      if (prior !== undefined && prior !== authorization.authorizationId) return false;
      authorizationByIntent.set(intent.intentId, authorization.authorizationId);
      return true;
    },
    consumeIntentOnce: async ({ authorizationId, intentId }) => {
      if (
        authorizationByIntent.get(intentId) !== authorizationId ||
        consumedIntents.has(intentId)
      ) {
        return false;
      }
      consumedIntents.add(intentId);
      return true;
    },
    persistCompletedRun: async () => true,
  };
}

function authorityService(
  evidence: AflTradeAdmittedModelRunEvidence,
  store = memoryAuthorizationStore(),
  clock = fixedClock(),
  authorizationLifetimeMs?: number
) {
  return {
    clock,
    store,
    service: new AflTradeAdmittedModelRunAuthorityService({
      authenticator: { authenticate: async () => evidence },
      clock,
      authorizationStore: store,
      authorizationLifetimeMs,
    }),
  };
}

describe('admitted AFL trade model authority contracts', () => {
  it('keeps legacy protocol and model-run documents readable', () => {
    const legacyProtocol = { ...protocolContent(), schemaVersion: 'afl-trade-model-protocol/v1' };
    delete (legacyProtocol as Partial<typeof legacyProtocol>).datasetAdmission;
    delete (legacyProtocol as Partial<typeof legacyProtocol>).scalarValueTransformArtifact;
    const protocol = {
      protocolId: createAflTradeContentAddress('model-protocol', legacyProtocol),
      content: legacyProtocol,
    };
    const legacyRun = { ...runContent(), schemaVersion: 'afl-trade-model-run/v2' };
    delete (legacyRun as Partial<typeof legacyRun>).datasetAdmissionId;
    delete (legacyRun as Partial<typeof legacyRun>).runIntentId;
    delete (legacyRun as Partial<typeof legacyRun>).runAuthorizationId;
    delete (legacyRun as Partial<typeof legacyRun>).observationSetId;
    delete (legacyRun as Partial<typeof legacyRun>).modelTrainingEvaluationReceiptIds;
    const run = {
      runId: createAflTradeContentAddress('model-run', legacyRun),
      content: legacyRun,
    };

    expect(aflTradeAnyPlayerContributionModelProtocolSchema.safeParse(protocol).success).toBe(true);
    expect(aflTradeAnyModelRunManifestSchema.safeParse(run).success).toBe(true);
  });

  it('creates a protocol that binds the exact admitted dataset contract', () => {
    const protocol = createAflTradePlayerContributionModelProtocolV2(protocolContent());

    expect(protocol.protocolId).toMatch(/^model-protocol:[a-f0-9]{64}$/);
    expect(protocol.content.observationGrain).toBe('player_acquisition_spell_prediction');
    expect(protocol.content.sourceOutcomeVector).toEqual(outcomeMetricCodes);
  });

  it('requires retrospective protocols to use the policy-neutral feature artifact field', () => {
    const retrospective = {
      ...protocolContent(),
      featurePolicy: {
        ...protocolContent().featurePolicy,
        knowledgeJoin: 'retrospective_as_captured_at_dataset_creation' as const,
      },
    };
    expect(() =>
      createAflTradePlayerContributionModelProtocolV2({
        ...retrospective,
        pointInTimeFeatureValuesArtifact: artifact('1'),
      })
    ).toThrow(/may not use a point-in-time-labelled contract/i);

    expect(() =>
      createAflTradePlayerContributionModelProtocolV2({
        ...retrospective,
        featureValuesArtifact: artifact('1'),
      })
    ).not.toThrow();
  });

  it('rejects protocol chronology and duplicate or unordered run-start rights evidence', () => {
    expect(() =>
      createAflTradePlayerContributionModelProtocolV2({
        ...protocolContent(),
        preparedAt: '2026-08-10T00:00:00.000Z',
      })
    ).toThrow();

    const fixture = admittedRunFixture();
    expect(() =>
      createAflTradeModelRunIntent({
        ...fixture.intent.content,
        modelTrainingEvaluationReceiptIds: [
          `gate0a-evaluation:${digest('2')}`,
          `gate0a-evaluation:${digest('1')}`,
        ],
      })
    ).toThrow();

    expect(() =>
      createAflTradeValuationDatasetAdmissionReceipt({
        ...fixture.admission.content,
        gate2Decision: {
          ...fixture.admission.content.gate2Decision,
          evaluatedAt: '2026-08-10T00:00:59.000Z',
        },
      })
    ).toThrow();
    expect(() =>
      createAflTradeModelRunIntent({
        ...fixture.intent.content,
        modelTrainingEvaluationReceiptIds: [
          `gate0a-evaluation:${digest('1')}`,
          `gate0a-evaluation:${digest('1')}`,
        ],
      })
    ).toThrow();
  });

  it('authorizes one exact admitted observation set before constructing its model run', async () => {
    const fixture = admittedRunFixture();
    const boundary = authorityService(fixture.evidence);
    const runner = new AflTradeAdmittedModelRunner(
      boundary.service,
      {
        execute: async () => ({
          candidateLockedAt: '2026-08-10T00:04:00.000Z',
          finalTestEvaluatedAt: '2026-08-10T00:05:00.000Z',
          finishedAt: '2026-08-10T00:06:00.000Z',
          outcome: runContent(fixture.protocol).outcome,
        }),
      },
      boundary.store,
      boundary.clock,
      boundary.store,
      memoryFailureRecorder()
    );

    const result = await runner.run({ intent: fixture.intent, protocol: fixture.protocol });

    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(result.status).toBe('completed');
    expect(result.authorization.content).toMatchObject({
      datasetId: fixture.admission.content.datasetId,
      datasetAdmissionId: fixture.admission.admissionId,
      modelProtocolId: fixture.protocol.protocolId,
      observationSetId: fixture.observationSet.observationSetId,
      gateLedgerRevision: fixture.evidence.gateLedgerRevision,
      operationalAuthorizationReceiptId: fixture.operationalAuthorization.receiptId,
      authorizedAt: fixture.intent.content.startedAt,
      publicationEligible: false,
    });
    expect(result.run.content.runAuthorizationId).toBe(result.authorization.authorizationId);
    const replay = await runner.run({ intent: fixture.intent, protocol: fixture.protocol });
    expect(replay).toMatchObject({ status: 'blocked' });

    const capped = await authorityService(
      fixture.evidence,
      memoryAuthorizationStore(),
      fixedClock(),
      60_000
    ).service.authorize({ intent: fixture.intent, protocol: fixture.protocol });
    if (capped.status !== 'authorized') throw new Error(JSON.stringify(capped));
    expect(capped.authorization.content.validThrough).toBe('2026-08-10T00:03:30.000Z');

    const advancingInstants = [
      '2026-08-10T00:03:00.000Z',
      '2026-08-10T00:03:00.000Z',
      '2026-08-10T00:03:01.000Z',
    ];
    const advancingClock = {
      now: async () => advancingInstants.shift() ?? '2026-08-10T00:03:01.000Z',
    };
    const advancingBoundary = authorityService(
      fixture.evidence,
      memoryAuthorizationStore(),
      advancingClock
    );
    const advancingRunner = new AflTradeAdmittedModelRunner(
      advancingBoundary.service,
      {
        execute: async () => ({
          candidateLockedAt: '2026-08-10T00:04:00.000Z',
          finalTestEvaluatedAt: '2026-08-10T00:05:00.000Z',
          finishedAt: '2026-08-10T00:06:00.000Z',
          outcome: runContent(fixture.protocol).outcome,
        }),
      },
      advancingBoundary.store,
      advancingBoundary.clock,
      advancingBoundary.store,
      memoryFailureRecorder()
    );
    expect(
      await advancingRunner.run({ intent: fixture.intent, protocol: fixture.protocol })
    ).toMatchObject({ status: 'completed' });
    expect(
      await advancingRunner.run({ intent: fixture.intent, protocol: fixture.protocol })
    ).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'authorization_unavailable' }],
    });
  });

  it('preserves two acquisition spells for the same player and season as distinct rows', () => {
    const fixture = admittedRunFixture();
    const shared = fixture.observationSet.content.observations.filter(
      (observation) => observation.playerId === 'afl-player:shared' && observation.season === 2011
    );

    expect(shared).toHaveLength(2);
    expect(new Set(shared.map(({ acquisitionSpellId }) => acquisitionSpellId)).size).toBe(2);
  });

  it('does not report an executed model run as completed until its manifest is durable', async () => {
    const fixture = admittedRunFixture();
    const store = memoryAuthorizationStore();
    store.persistCompletedRun = async () => false;
    const boundary = authorityService(fixture.evidence, store);
    let executions = 0;
    const runner = new AflTradeAdmittedModelRunner(
      boundary.service,
      {
        execute: async () => {
          executions += 1;
          return {
            candidateLockedAt: '2026-08-10T00:04:00.000Z',
            finalTestEvaluatedAt: '2026-08-10T00:05:00.000Z',
            finishedAt: '2026-08-10T00:06:00.000Z',
            outcome: runContent(fixture.protocol).outcome,
          };
        },
      },
      store,
      boundary.clock,
      store,
      memoryFailureRecorder()
    );

    const failed = await runner.run({ intent: fixture.intent, protocol: fixture.protocol });

    expect(failed).toMatchObject({
      status: 'persistence_failed',
      run: { runId: expect.stringMatching(/^model-run:[a-f0-9]{64}$/) },
      blockers: [{ code: 'run_persistence_failed' }],
    });
    expect(executions).toBe(1);
    expect(await runner.run({ intent: fixture.intent, protocol: fixture.protocol })).toMatchObject({
      status: 'blocked',
    });
    expect(executions).toBe(1);
  });

  it('persists an immutable failed run when the executor rejects after consumption', async () => {
    const fixture = admittedRunFixture();
    const store = memoryAuthorizationStore();
    const persistedRuns: { content: { outcome: { status: string } } }[] = [];
    store.persistCompletedRun = async (run) => {
      persistedRuns.push(run as unknown as (typeof persistedRuns)[number]);
      return true;
    };
    const boundary = authorityService(fixture.evidence, store);
    const runner = new AflTradeAdmittedModelRunner(
      boundary.service,
      {
        execute: async () => {
          throw new Error('fitter rejected');
        },
      },
      store,
      boundary.clock,
      store,
      memoryFailureRecorder()
    );

    const result = await runner.run({ intent: fixture.intent, protocol: fixture.protocol });

    expect(result).toMatchObject({
      status: 'completed',
      run: { content: { outcome: { status: 'failed' } } },
    });
    expect(persistedRuns).toHaveLength(1);
    expect(persistedRuns[0]?.content.outcome.status).toBe('failed');
    expect(await runner.run({ intent: fixture.intent, protocol: fixture.protocol })).toMatchObject({
      status: 'blocked',
    });
  });

  it('never invokes the fitter until the exact intent is authorized', async () => {
    const fixture = admittedRunFixture();
    let executions = 0;
    const boundary = authorityService({
      ...fixture.evidence,
      gate2Ledger: { ...fixture.evidence.gate2Ledger, decisions: [] },
    });
    const runner = new AflTradeAdmittedModelRunner(
      boundary.service,
      {
        execute: async () => {
          executions += 1;
          return {
            candidateLockedAt: '2026-08-10T00:04:00.000Z',
            finalTestEvaluatedAt: '2026-08-10T00:05:00.000Z',
            finishedAt: '2026-08-10T00:06:00.000Z',
            outcome: runContent(fixture.protocol).outcome,
          };
        },
      },
      boundary.store,
      boundary.clock,
      boundary.store,
      memoryFailureRecorder()
    );

    const result = await runner.run({ intent: fixture.intent, protocol: fixture.protocol });

    expect(result.status).toBe('blocked');
    expect(executions).toBe(0);

    const instants = ['2026-08-10T00:03:00.000Z', '2026-08-09T14:03:31.000-10:00'];
    const offsetClock = {
      now: async () => instants.shift() ?? '2026-08-09T14:03:31.000-10:00',
    };
    const offsetBoundary = authorityService(
      fixture.evidence,
      memoryAuthorizationStore(),
      offsetClock
    );
    const offsetRunner = new AflTradeAdmittedModelRunner(
      offsetBoundary.service,
      {
        execute: async () => {
          executions += 1;
          return {
            candidateLockedAt: '2026-08-10T00:04:00.000Z',
            finalTestEvaluatedAt: '2026-08-10T00:05:00.000Z',
            finishedAt: '2026-08-10T00:06:00.000Z',
            outcome: runContent(fixture.protocol).outcome,
          };
        },
      },
      offsetBoundary.store,
      offsetBoundary.clock,
      offsetBoundary.store,
      memoryFailureRecorder()
    );
    const offsetExpired = await offsetRunner.run({
      intent: fixture.intent,
      protocol: fixture.protocol,
    });
    expect(offsetExpired).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'authorization_not_consumable' }],
    });
    expect(executions).toBe(0);
  });

  it('blocks omitted, fabricated, or no-longer-current model-training authority', async () => {
    const fixture = admittedRunFixture();
    const request = {
      intent: fixture.intent,
      protocol: fixture.protocol,
    };

    const omitted = await authorityService({
      ...fixture.evidence,
      runStartEvaluationReceipts: [],
    }).service.authorize(request);
    expect(omitted).toMatchObject({ status: 'blocked' });

    const [firstMetric, ...remainingMetrics] = fixture.spellMetrics;
    if (firstMetric.content.availability.state !== 'complete') {
      throw new Error('The authority fixture requires a complete first spell metric.');
    }
    const changedOutcomeWithOriginalObservationSet = await authorityService({
      ...fixture.evidence,
      spellMetrics: [
        {
          ...firstMetric,
          content: {
            ...firstMetric.content,
            availability: { state: 'complete', numericValue: '999', reasonCode: null },
          },
        },
        ...remainingMetrics,
      ],
    }).service.authorize(request);
    expect(changedOutcomeWithOriginalObservationSet).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'invalid_evidence' }],
    });

    const fabricatedIntent = createAflTradeModelRunIntent({
      ...fixture.intent.content,
      seed: fixture.intent.content.seed + 1,
    });
    const fabricatedOperationalAuthorization = createAflTradeModelRunOperationalAuthorization({
      ...fixture.operationalAuthorization.content,
      runIntentId: fabricatedIntent.intentId,
    });
    const fabricated = await authorityService({
      ...fixture.evidence,
      operationalAuthorization: fabricatedOperationalAuthorization,
    }).service.authorize({
      ...request,
      intent: fabricatedIntent,
    });
    if (fabricated.status !== 'authorized') throw new Error(JSON.stringify(fabricated));
    expect(fabricated).toMatchObject({ status: 'authorized' });
    const original = await authorityService(fixture.evidence).service.authorize(request);
    if (original.status !== 'authorized') throw new Error(JSON.stringify(original));
    expect(fabricated.authorization.authorizationId).not.toBe(
      original.authorization.authorizationId
    );
    const withdrawn = await authorityService({
      ...fixture.evidence,
      gateDecisionLedger: { ...fixture.evidence.gateDecisionLedger, decisions: [] },
    }).service.authorize(request);
    expect(withdrawn).toMatchObject({ status: 'blocked' });

    const gate2Withdrawn = await authorityService({
      ...fixture.evidence,
      gate2Ledger: { ...fixture.evidence.gate2Ledger, decisions: [] },
    }).service.authorize(request);
    expect(gate2Withdrawn).toMatchObject({ status: 'blocked' });

    const originalGate2Proposal = fixture.evidence.gate2Ledger.proposals[0]!;
    const originalGate2Decision = fixture.evidence.gate2Ledger.decisions[0]!;
    const changedSeasonScope = {
      ...originalGate2Decision.content.scope,
      dimensions: [
        ...originalGate2Decision.content.scope.dimensions,
        { name: 'valid_from_season', values: ['2027'] },
        { name: 'valid_through_season', values: ['2027'] },
      ],
    };
    const successorProposalContent = {
      ...originalGate2Proposal.content,
      version: 2,
      scope: changedSeasonScope,
      proposedAt: '2026-08-10T00:02:10.000Z',
    };
    const successorProposal = aflTradeGateDecisionProposalSchema.parse({
      proposalId: createAflTradeContentAddress('gate-proposal', successorProposalContent),
      content: successorProposalContent,
    });
    const successorDecisionContent = {
      ...originalGate2Decision.content,
      proposalId: successorProposal.proposalId,
      version: 2,
      scope: changedSeasonScope,
      decidedAt: '2026-08-10T00:02:20.000Z',
      effectiveAt: '2026-08-10T00:02:20.000Z',
      supersedesDecisionId: originalGate2Decision.decisionId,
    };
    const successorDecision = aflTradeGateDecisionRecordSchema.parse({
      decisionId: createAflTradeContentAddress('gate-decision', successorDecisionContent),
      content: successorDecisionContent,
    });
    const changedSeasonSuccessor = await authorityService({
      ...fixture.evidence,
      gate2Ledger: {
        proposals: [...fixture.evidence.gate2Ledger.proposals, successorProposal],
        decisions: [...fixture.evidence.gate2Ledger.decisions, successorDecision],
      },
    }).service.authorize(request);
    expect(changedSeasonSuccessor).toMatchObject({ status: 'blocked' });

    const substitutedArtifact = await authorityService({
      ...fixture.evidence,
      executableArtifacts: fixture.evidence.executableArtifacts.map((proof, index) =>
        index === 0 ? { ...proof, bytes: new TextEncoder().encode('substituted') } : proof
      ),
    }).service.authorize(request);
    expect(substitutedArtifact).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'execution_artifact_mismatch' }],
    });

    const missingScalarTransform = await authorityService({
      ...fixture.evidence,
      executableArtifacts: fixture.evidence.executableArtifacts.filter(
        ({ artifactId }) =>
          artifactId !== fixture.protocol.content.scalarValueTransformArtifact.artifactId
      ),
    }).service.authorize(request);
    expect(missingScalarTransform).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'execution_artifact_mismatch' }],
    });

    const mismatchedFeatureIntent = createAflTradeModelRunIntent({
      ...fixture.intent.content,
      featureDefinitionArtifacts: [artifact('2')],
    });
    const mismatchedFeature = await authorityService(fixture.evidence).service.authorize({
      intent: mismatchedFeatureIntent,
      protocol: fixture.protocol,
    });
    expect(mismatchedFeature).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'execution_artifact_mismatch' }],
    });

    const backdated = await authorityService(
      fixture.evidence,
      memoryAuthorizationStore(),
      fixedClock('2026-08-10T00:04:00.000Z')
    ).service.authorize(request);
    expect(backdated).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'invalid_request' }],
    });
  });

  it('requires current human operational authorization for the exact executable intent', async () => {
    const fixture = admittedRunFixture();
    const request = { intent: fixture.intent, protocol: fixture.protocol };

    const omitted = await authorityService({
      ...fixture.evidence,
      operationalAuthorization: null as never,
    }).service.authorize(request);
    expect(omitted).toMatchObject({ status: 'blocked' });

    const wrongIntent = createAflTradeModelRunOperationalAuthorization({
      ...fixture.operationalAuthorization.content,
      runIntentId: `model-run-intent:${digest('f')}`,
    });
    const substituted = await authorityService({
      ...fixture.evidence,
      operationalAuthorization: wrongIntent,
    }).service.authorize(request);
    expect(substituted).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'operational_authorization_invalid' }],
    });

    const expired = createAflTradeModelRunOperationalAuthorization({
      ...fixture.operationalAuthorization.content,
      authorizedAt: '2026-08-10T00:02:00.000Z',
      validThrough: '2026-08-10T00:02:59.999Z',
    });
    const stale = await authorityService({
      ...fixture.evidence,
      operationalAuthorization: expired,
    }).service.authorize(request);
    expect(stale).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'operational_authorization_invalid' }],
    });

    expect(() =>
      createAflTradeModelRunOperationalAuthorization({
        ...fixture.operationalAuthorization.content,
        authorityEvidence: {
          ...fixture.operationalAuthorization.content.authorityEvidence,
          sha256: digest('0'),
        },
      })
    ).toThrow(/authority evidence/i);
  });

  it('creates exact local non-production authority through the fixed private valuation policy', () => {
    const fixture = admittedRunFixture();
    const policyAuthorization = createAflTradePrivateValuationModelRunOperationalAuthorization({
      runIntentId: fixture.intent.intentId,
      datasetId: fixture.intent.content.datasetId,
      datasetAdmissionId: fixture.intent.content.datasetAdmissionId,
      modelProtocolId: fixture.intent.content.modelProtocolId,
      observationSetId: fixture.intent.content.observationSetId,
      dispatchRequestId: `private-valuation-dispatch:${digest('d')}`,
      substantiveOperationId: `private-valuation-model-operation:${digest('e')}`,
      dispatchClaimId: `private-valuation-dispatch-claim:${digest('f')}`,
      dispatchAttemptNumber: 1,
      dispatchLeaseTokenSha256: digest('a'),
      factualOutputId: `private-valuation-factual-output:${digest('1')}`,
      hpnCalculationId: `hpn-pav-season:${digest('2')}`,
      factualValuesSha256: digest('3'),
      hpnValuesSha256: digest('4'),
      authorizedAt: fixture.intent.content.startedAt,
      validThrough: '2026-08-10T00:03:30.000Z',
    });

    expect(policyAuthorization.content).toMatchObject({
      authorityBoundary: 'policy_owned_local_private_valuation_for_one_exact_model_run_intent',
      principalRef: 'system:weekly-valuation-coordinator',
      role: 'afl_trade_private_evaluation_coordinator',
      environment: 'non_production',
      executionMode: 'local',
      publicationEligible: false,
      publicationProhibited: true,
    });
  });

  it('does not let callers override the private valuation policy authorization', () => {
    const fixture = admittedRunFixture();
    const input = {
      runIntentId: fixture.intent.intentId,
      datasetId: fixture.intent.content.datasetId,
      datasetAdmissionId: fixture.intent.content.datasetAdmissionId,
      modelProtocolId: fixture.intent.content.modelProtocolId,
      observationSetId: fixture.intent.content.observationSetId,
      dispatchRequestId: `private-valuation-dispatch:${digest('d')}`,
      substantiveOperationId: `private-valuation-model-operation:${digest('e')}`,
      dispatchClaimId: `private-valuation-dispatch-claim:${digest('f')}`,
      dispatchAttemptNumber: 1,
      dispatchLeaseTokenSha256: digest('a'),
      factualOutputId: `private-valuation-factual-output:${digest('1')}`,
      hpnCalculationId: `hpn-pav-season:${digest('2')}`,
      factualValuesSha256: digest('3'),
      hpnValuesSha256: digest('4'),
      authorizedAt: fixture.intent.content.startedAt,
      validThrough: '2026-08-10T00:03:30.000Z',
    };

    const authorization = createAflTradePrivateValuationModelRunOperationalAuthorization({
      ...input,
      principalRef: 'caller-controlled-principal',
      role: 'afl_trade_model_run_operator',
      environment: 'production',
      executionMode: 'remote',
      publicationEligible: true,
      publicationProhibited: false,
    } as never);
    expect(authorization.content).toMatchObject({
      principalRef: 'system:weekly-valuation-coordinator',
      role: 'afl_trade_private_evaluation_coordinator',
      environment: 'non_production',
      executionMode: 'local',
      publicationEligible: false,
      publicationProhibited: true,
    });
  });
});
