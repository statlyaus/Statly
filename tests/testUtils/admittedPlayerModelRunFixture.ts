import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
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
  createAflTradePlayerContributionModelProtocolV2,
} from '@/server/aflTradeIntelligence/artifacts/modelProtocol';
import {
  AFL_TRADE_MODEL_RUN_SCHEMA_VERSION_V3,
  createAflTradeModelRunIntent,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import {
  createAflTradeModelRunOperationalAuthorization,
  type AflTradeAdmittedModelRunEvidence,
} from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
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
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from '@/server/aflTradeIntelligence/valuation/automatedPrivateEvaluationPolicy';

import { createAflTradeGateDecisionFixture } from '../fixtures/aflDraftTradeOutcomeReleaseFixture';

export const digest = (character: string) => character.repeat(64);
const retainedArtifactBytes = new Map<string, Uint8Array>();

export function artifact(character: string) {
  const bytes = new TextEncoder().encode(`fixture-artifact-${character}`);
  const reference = createAflTradeByteArtifactRef(
    bytes,
    'application/json',
    '2026-08-10T00:00:00.000Z'
  );
  retainedArtifactBytes.set(reference.artifactId, bytes);
  return reference;
}

function jsonArtifact(document: unknown) {
  const reference = createAflTradeCanonicalJsonArtifactRef(document, '2026-08-10T00:00:00.000Z');
  retainedArtifactBytes.set(
    reference.artifactId,
    new TextEncoder().encode(canonicalizeAflTradeJson(document))
  );
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

export const outcomeMetricCodes = ['brownlow_votes', 'coaches_votes', 'games', 'goals'] as const;
type FixtureEnvironment = 'test_fixture' | 'non_production';

function exactReference(prefix: string, marker: string) {
  const sha256 = digest(marker);
  return { id: `${prefix}:${sha256}`, sha256 };
}

function spellMetricFixture(input: {
  environment: FixtureEnvironment;
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
    environment: input.environment,
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
    environment: input.environment,
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
        environment: input.environment,
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

interface AdmittedPlayerFactualParentOverride {
  readonly scopeKey: string;
  readonly corpusId?: string;
  readonly corpusToCandidateLineageId?: string;
  readonly factualReleaseId: string;
  readonly factualCandidateId: string;
  readonly sourceMemberSetSha256: string;
  readonly archiveDatasetId?: string;
  readonly sourceSnapshotSetId?: string;
  readonly metricRegistryVersion: string;
  readonly acquisitionSpellRuleId: string;
  readonly factualEffectiveThrough: string;
  readonly analyticalAuthorityReceiptId?: string;
  readonly operationalAuthorizationReceiptId?: string;
  readonly gate2Decision?: Readonly<{
    decisionId: string;
    effectiveAt: string;
    revalidateAt: string;
  }>;
  readonly sourceAuthority?: Readonly<{
    captureId: string;
    sourceSnapshotId: string;
    consumedFieldSetId: string;
    consumedFieldSetSha256: string;
    rights: ReturnType<typeof aflTradeSourceRightsProposalSchema.parse>;
    ledger: Parameters<typeof createAflTradeGate0AReceipt>[0];
    request: Omit<Parameters<typeof createAflTradeGate0AReceipt>[2], 'evaluatedAt'>;
  }>;
}

function valuationDatasetFixture(
  environment: FixtureEnvironment,
  factualParentOverride?: AdmittedPlayerFactualParentOverride,
  additionalFinalRows = 0,
  predictiveFeatures = false
) {
  const datasetCreatedAt = factualParentOverride
    ? '2026-08-12T00:08:00.000Z'
    : '2026-08-10T00:00:00.000Z';
  const knowledgeCutoffAt = factualParentOverride
    ? '2026-08-12T00:07:00.000Z'
    : '2026-08-09T00:00:00.000Z';
  const partitions = [
    { role: 'train' as const, season: 2011, prediction: '2011-01-01T00:00:00.000Z' },
    { role: 'train' as const, season: 2011, prediction: '2011-01-01T00:00:00.000Z' },
    { role: 'calibration' as const, season: 2014, prediction: '2014-01-08T00:00:00.000Z' },
    { role: 'validation' as const, season: 2017, prediction: '2017-01-08T00:00:00.000Z' },
    { role: 'final_test' as const, season: 2020, prediction: '2020-01-08T00:00:00.000Z' },
    ...Array.from({ length: additionalFinalRows }, () => ({
      role: 'final_test' as const,
      season: 2020,
      prediction: '2020-01-08T00:00:00.000Z',
    })),
  ];
  const spellMetrics: AflTradeAcquisitionSpellMetric[] = [];
  const rows = partitions.map(({ role, season, prediction }, index) => {
    const targetFrom = `${season}-01-${role === 'train' ? '02' : '09'}`;
    const playerId = index < 2 ? 'afl-player:shared' : `afl-player:${index + 1}`;
    const clubId = `afl-club:${index + 1}`;
    const spellId = `acquisition-spell:${index + 1}`;
    const rowDigest = (index + 1).toString(16).repeat(64);
    const featureDigest = (index + 5).toString(16).repeat(64);
    const spellVersionId = `acquisition-spell-version:${rowDigest}`;
    const recordedAt = `${season + 1}-01-01T00:00:00.000Z`;
    const rowMetrics = outcomeMetricCodes.map((metricCode, metricIndex) =>
      spellMetricFixture({
        environment,
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
    const featureSpellVersionId = `acquisition-spell-version:${featureDigest}`;
    const featureMetrics = outcomeMetricCodes.map((metricCode, metricIndex) =>
      spellMetricFixture({
        environment,
        index: index + 25 + metricIndex * 25,
        season: season - 1,
        playerId,
        clubId,
        spellId: `feature-spell:${index + 1}`,
        spellVersionId: featureSpellVersionId,
        metricCode,
        numericValue:
          metricCode === 'goals'
            ? predictiveFeatures
              ? String(index + 1)
              : '0'
            : metricCode === 'games'
              ? '1'
              : '0',
        recordedAt: prediction,
      })
    );
    spellMetrics.push(...featureMetrics, ...rowMetrics);
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
        playerResolutionDecisionId: `provider-resolution-decision:${rowDigest}`,
        playerAssignmentRevision: 1,
        clubId,
        clubResolutionDecisionId: `provider-resolution-decision:${featureDigest}`,
        clubAssignmentRevision: 1,
      },
      lineage: {
        eventId: `event:${index + 1}`,
        eventVersionId: `event-version:${index + 1}`,
        acquisitionSpellId: spellId,
        acquisitionSpellVersionId: spellVersionId,
        lineageEdgeIds: [],
      },
      featureInputs: featureMetrics
        .map((metric) => ({
          kind: 'acquisition_spell_metric' as const,
          memberId: metric.spellMetricVersionId,
          recordSha256: metric.factSha256,
          headRevision: 1,
          effectiveFrom: `${season - 1}-01-01`,
          effectiveThrough: metric.content.effectiveThrough,
          recordedAt: metric.content.recordedAt,
          state: 'complete' as const,
          playerId,
          clubId,
          spellVersionId: metric.content.spell.spellVersionId,
          metricCode: metric.content.rule.metricCode,
        }))
        .sort((left, right) => left.memberId.localeCompare(right.memberId)),
      targetInputs,
    });
  });
  const specification = createAflTradeValuationDatasetSpecification({
    schemaVersion: 'afl-trade-valuation-dataset-specification/v1',
    environment,
    scopeKey: factualParentOverride?.scopeKey ?? 'public-afl-draft-trade-outcomes',
    competition: 'AFLM',
    modelKind: 'player_contribution_and_availability',
    createdAt: datasetCreatedAt,
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
    environment,
    scopeKey: factualParentOverride?.scopeKey ?? 'public-afl-draft-trade-outcomes',
    competition: 'AFLM',
    createdAt: datasetCreatedAt,
    knowledgeCutoffAt,
    factualParent: {
      corpusId: factualParentOverride?.corpusId ?? `corpus:${digest('1')}`,
      corpusToCandidateLineageId:
        factualParentOverride?.corpusToCandidateLineageId ??
        `corpus-factual-lineage:${digest('2')}`,
      factualReleaseId: factualParentOverride?.factualReleaseId ?? `outcome-release:${digest('3')}`,
      factualCandidateId:
        factualParentOverride?.factualCandidateId ?? `factual-release-candidate:${digest('4')}`,
      sourceMemberSetSha256: factualParentOverride?.sourceMemberSetSha256 ?? digest('5'),
      archiveDatasetId: factualParentOverride?.archiveDatasetId ?? `archive-dataset:${digest('6')}`,
      sourceSnapshotSetId:
        factualParentOverride?.sourceSnapshotSetId ?? `source-snapshot-set:${digest('7')}`,
      metricRegistryVersion: factualParentOverride?.metricRegistryVersion ?? 'fixture-v1',
      acquisitionSpellRuleId:
        factualParentOverride?.acquisitionSpellRuleId ?? `acquisition-spell-rule:${digest('8')}`,
      factualEffectiveThrough:
        factualParentOverride?.factualEffectiveThrough ?? '2025-12-31T00:00:00.000Z',
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

export function protocolContent(environment: FixtureEnvironment = 'test_fixture') {
  return {
    schemaVersion: AFL_TRADE_PLAYER_MODEL_PROTOCOL_SCHEMA_VERSION_V2,
    environment,
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

export function runContent(
  protocol = createAflTradePlayerContributionModelProtocolV2(protocolContent())
) {
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
      initiatedBy:
        protocol.content.environment === 'non_production'
          ? AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID
          : 'fixture-model-owner',
      workerIdentity:
        protocol.content.environment === 'non_production'
          ? AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID
          : 'fixture-model-worker',
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

function admittedRunTimeline(hasFactualParentOverride: boolean) {
  return hasFactualParentOverride
    ? {
        datasetCreatedAt: '2026-08-12T00:08:00.000Z',
        admittedAt: '2026-08-12T00:09:00.000Z',
        protocolPreparedAt: '2026-08-12T00:10:00.000Z',
        runStartedAt: '2026-08-12T00:11:00.000Z',
        authorizationValidThrough: '2026-08-12T00:11:30.000Z',
      }
    : {
        datasetCreatedAt: '2026-08-10T00:00:00.000Z',
        admittedAt: '2026-08-10T00:01:00.000Z',
        protocolPreparedAt: '2026-08-10T00:02:00.000Z',
        runStartedAt: '2026-08-10T00:03:00.000Z',
        authorizationValidThrough: '2026-08-10T00:03:30.000Z',
      };
}

function admittedRunJob(environment: FixtureEnvironment) {
  const automated = environment === 'non_production';
  return {
    jobId: 'fixture-model-job',
    attempt: 1,
    initiatedBy: automated ? AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID : 'fixture-model-owner',
    workerIdentity: automated ? AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID : 'fixture-model-worker',
  };
}

export function admittedRunFixture(
  environment: FixtureEnvironment = 'test_fixture',
  factualParentOverride?: AdmittedPlayerFactualParentOverride,
  options: { additionalFinalRows?: number; predictiveFeatures?: boolean } = {}
) {
  const {
    datasetCreatedAt,
    admittedAt,
    protocolPreparedAt,
    runStartedAt,
    authorizationValidThrough,
  } = admittedRunTimeline(factualParentOverride !== undefined);
  const { candidate: datasetCandidate, spellMetrics } = valuationDatasetFixture(
    environment,
    factualParentOverride,
    options.additionalFinalRows,
    options.predictiveFeatures
  );
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
  const fixtureRights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const rights = factualParentOverride?.sourceAuthority?.rights ?? fixtureRights;
  const decisionKey = 'fixture-admitted-model-rights';
  const fixtureGate = createAflTradeGateDecisionFixture({
    gate: 'gate_0a_permission_to_evaluate',
    environment,
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
  const gate = factualParentOverride?.sourceAuthority
    ? { ledger: factualParentOverride.sourceAuthority.ledger }
    : fixtureGate;
  const gate2DecisionKey = 'fixture-admitted-model-corpus';
  const gate2 = createAflTradeGateDecisionFixture({
    gate: 'gate_2_corpus_lineage',
    environment,
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
  const fixtureRequest = {
    decisionKey,
    environment,
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
  const request = factualParentOverride?.sourceAuthority?.request ?? fixtureRequest;
  const derivationReceipt = createAflTradeGate0AReceipt(
    gate.ledger,
    rights,
    { ...request, evaluatedAt: datasetCreatedAt },
    datasetCreatedAt
  );
  const admissionEvaluationReceipt = createAflTradeGate0AReceipt(
    gate.ledger,
    rights,
    { ...request, evaluatedAt: admittedAt },
    admittedAt
  );
  const runStartEvaluationReceipt = createAflTradeGate0AReceipt(
    gate.ledger,
    rights,
    { ...request, evaluatedAt: runStartedAt },
    runStartedAt
  );
  const datasetId = datasetCandidate.datasetId;
  const admission = createAflTradeValuationDatasetAdmissionReceipt({
    schemaVersion: 'afl-trade-dataset-admission/v3',
    authorityBoundary: 'dataset_admission_only_no_model_fit_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment,
    admittedAt,
    datasetCreatedAt,
    datasetId,
    datasetSha256: datasetId.slice('dataset:'.length),
    factualReleaseId: datasetCandidate.content.factualParent.factualReleaseId,
    factualCandidateId: datasetCandidate.content.factualParent.factualCandidateId,
    sourceMemberSetSha256: datasetCandidate.content.factualParent.sourceMemberSetSha256,
    corpusId: datasetCandidate.content.factualParent.corpusId,
    corpusToCandidateLineageId: datasetCandidate.content.factualParent.corpusToCandidateLineageId,
    gate2Decision: {
      decisionId:
        factualParentOverride?.gate2Decision?.decisionId ?? gate2.ledger.decisions[0]!.decisionId,
      state: 'approved',
      effectiveAt: factualParentOverride?.gate2Decision?.effectiveAt ?? '2026-08-10T00:00:00.000Z',
      evaluatedAt: admittedAt,
      revalidateAt:
        factualParentOverride?.gate2Decision?.revalidateAt ?? '2027-08-01T00:00:00.000Z',
      pinnedCorpusId: datasetCandidate.content.factualParent.corpusId,
      pinnedCorpusToCandidateLineageId:
        datasetCandidate.content.factualParent.corpusToCandidateLineageId,
      pinnedFactualReleaseId: datasetCandidate.content.factualParent.factualReleaseId,
      pinnedFactualCandidateId: datasetCandidate.content.factualParent.factualCandidateId,
    },
    sourceRightsEvaluations: [
      {
        captureId: factualParentOverride?.sourceAuthority?.captureId ?? 'fixture-capture',
        sourceSnapshotId:
          factualParentOverride?.sourceAuthority?.sourceSnapshotId ??
          `source-snapshot:${digest('b')}`,
        consumedFieldSetId:
          factualParentOverride?.sourceAuthority?.consumedFieldSetId ??
          `consumed-field-set:${digest('c')}`,
        proposalId: rights.rightsArtifactId,
        derivationDecisionId: derivationReceipt.content.result.decisionId!,
        derivationEvaluationReceiptId: derivationReceipt.receiptId,
        derivationEvaluatedAt: derivationReceipt.content.request.evaluatedAt,
        admissionDecisionId: admissionEvaluationReceipt.content.result.decisionId!,
        admissionEvaluationReceiptId: admissionEvaluationReceipt.receiptId,
        admissionEvaluatedAt: admissionEvaluationReceipt.content.request.evaluatedAt,
        consumedFieldSetSha256:
          factualParentOverride?.sourceAuthority?.consumedFieldSetSha256 ?? digest('d'),
        operations: ['derived_feature_creation', 'model_training'],
        fieldUses: ['derived_feature', 'model_training'],
        status: 'approved',
        termsValidThrough: '2027-08-01T00:00:00.000Z',
      },
    ],
    analyticalAuthorityReceiptId:
      factualParentOverride?.analyticalAuthorityReceiptId ??
      `architecture-operation-receipt:${digest('e')}`,
    operationalAuthorizationReceiptId:
      factualParentOverride?.operationalAuthorizationReceiptId ??
      `architecture-operation-receipt:${digest('f')}`,
  });
  const scalarTransform = {
    schemaVersion: 'afl-trade-player-scalar-transform/v1' as const,
    valueUnitId: 'fixture-contribution-unit',
    weights: { brownlow_votes: 2, coaches_votes: 1.5, games: 1, goals: 0.5 },
  };
  const protocolTemplate = protocolContent(environment);
  const pointInTimeFeatures = {
    schemaVersion: 'afl-trade-player-point-in-time-feature-set/v1' as const,
    datasetId,
    createdAt: datasetCreatedAt,
    roleTaxonomyArtifactId: protocolTemplate.footballContext.roleTaxonomyArtifact.artifactId,
    eraDefinitionArtifactId: protocolTemplate.footballContext.eraDefinitionArtifact.artifactId,
    rows: datasetCandidate.content.rows.map(({ rowId, content }) => ({
      datasetRowId: rowId,
      featureKnownThrough: content.featureKnownThrough,
      role: 'unknown',
      roleKnownAt: content.featureKnownThrough,
      era: 'modern',
      values: content.featureInputs.map(({ memberId, recordSha256 }) => {
        const metric = spellMetrics.find(
          ({ spellMetricVersionId }) => spellMetricVersionId === memberId
        )!;
        return {
          memberId,
          recordSha256,
          numericValue: metric.content.availability.numericValue!,
        };
      }),
    })),
  };
  const candidateConfig = {
    schemaVersion: 'afl-trade-admitted-player-candidate-config/v1' as const,
    baseline: {
      schemaVersion: 'afl-trade-player-baseline-config/v1' as const,
      replacementQuantile: 0.5,
      minimumGamesForReplacementFit: 1,
      minimumTrainingObservationsPerGroup: 2,
      weighting: 'games_played' as const,
      replacementStratification: 'role_and_era' as const,
      unavailableAndZeroTreatment: 'distinct' as const,
      activeCareerTreatment: 'right_censored' as const,
    },
    validation: {
      schemaVersion: 'afl-trade-player-validation-config/v1' as const,
      minimumComparableObservations: 1,
      acceptanceRule: 'candidate_improves_both_mae_and_rmse' as const,
      minimumRelativeMaeImprovement: 0.01,
      minimumRelativeRmseImprovement: 0.01,
      incompletePredictionCoverage: 'fail_closed' as const,
      governanceEffect: 'evidence_only_no_gate_or_source_approval' as const,
    },
    ridgeLambda: 1,
    intervalCoverageLevel: 0.8,
  };
  const scalarTransformArtifact = jsonArtifact(scalarTransform);
  const pointInTimeFeatureValuesArtifact = jsonArtifact(pointInTimeFeatures);
  const configurationArtifact = jsonArtifact(candidateConfig);
  const protocol = createAflTradePlayerContributionModelProtocolV2({
    ...protocolTemplate,
    datasetId,
    preparedAt: protocolPreparedAt,
    valueUnit: {
      ...protocolTemplate.valueUnit,
      valueUnitId: scalarTransform.valueUnitId,
    },
    scalarValueTransformArtifact: scalarTransformArtifact,
    pointInTimeFeatureValuesArtifact,
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
  const dependencyLockArtifact = artifact('2');
  const runtimeArtifact = artifact('3');
  const containerArtifact = artifact('4');
  const environmentArtifact = artifact('6');
  const sourceCodeArtifact = jsonArtifact({
    schemaVersion: 'afl-trade-admitted-player-executor-build/v1',
    implementationId: 'statly-admitted-player-contribution-candidate',
    candidateSchemaVersion: 'afl-trade-admitted-player-candidate/v1',
    codeCommitSha: digest('a'),
    cleanWorktree: true,
    dependencyLockArtifactId: dependencyLockArtifact.artifactId,
    runtimeArtifactId: runtimeArtifact.artifactId,
    containerArtifactId: containerArtifact.artifactId,
    environmentArtifactId: environmentArtifact.artifactId,
  });
  const intent = createAflTradeModelRunIntent({
    environment,
    modelId: 'fixture-player-model',
    modelVersion: 'fixture-v1',
    datasetId,
    datasetAdmissionId: admission.admissionId,
    modelProtocolId: protocol.protocolId,
    observationSetId: observationSet.observationSetId,
    codeCommitSha: digest('a'),
    cleanWorktree: true,
    seed: 17,
    job: admittedRunJob(environment),
    startedAt: runStartedAt,
    windows: windows(),
    sourceCodeArtifact,
    dependencyLockArtifact,
    runtimeArtifact,
    containerArtifact,
    configurationArtifact,
    environmentArtifact,
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
    validThrough: authorizationValidThrough,
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
    protocol.content.pointInTimeFeatureValuesArtifact!,
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
    derivationReceipt,
    evidence,
    intent,
    observationSet,
    operationalAuthorization,
    protocol,
    runStartEvaluationReceipt,
    spellMetrics,
  };
}
