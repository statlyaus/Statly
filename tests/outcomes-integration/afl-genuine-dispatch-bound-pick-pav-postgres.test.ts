import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_PICK_MODEL_SUBGROUPS,
  aflTradePickDistributionModelProtocolSchema,
} from '@/server/aflTradeIntelligence/artifacts/modelProtocol';
import {
  AFL_TRADE_VALUATION_DATASET_CANDIDATE_SCHEMA_VERSION,
  AFL_TRADE_VALUATION_DATASET_ROW_SCHEMA_VERSION,
  createAflTradeValuationDatasetAdmissionReceipt,
  createAflTradeValuationDatasetCandidate,
  createAflTradeValuationDatasetRow,
  createAflTradeValuationDatasetSpecification,
} from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
import { createLocalAflTradePrivateDerivedArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import {
  AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
  aflTradeFinalizedHpnPavCalculationSchema,
} from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';
import { createAflTradePickPavPolicy } from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradePrivateValuationModelOperation } from '@/server/aflTradeIntelligence/valuation/privateValuationModelPair';
import { createAflTradePrivateValuationFactualOutput } from '@/server/aflTradeIntelligence/valuation/privateValuationFactualOutput';
import {
  createPostgresGenuineDispatchBoundPickPavExecutor,
  PostgresGenuineDispatchBoundPickPavMaterializer,
} from '@/server/aflTradeIntelligence/valuation/postgresGenuineDispatchBoundPickPav';
import { PostgresAflTradePrivateValuationModelPairRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationModelPair';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationStagingRepository';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_genuine_pick_pav_${process.pid}_${Date.now()}`;
const runtimeRoleName = `afl_genuine_pick_pav_runtime_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(pool);
const years = [2000, 2001, 2002, 2003, 2006, 2009, 2012] as const;
const retainedAt = '2026-08-24T00:00:00.000Z';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${digest(value)}`;

let artifactRoot = '';
let restrictedPool: Pool | undefined;

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

function reference(value: string) {
  return createAflTradeByteArtifactRef(
    new TextEncoder().encode(value),
    'application/json',
    retainedAt
  );
}

function policy(methodId: string) {
  return createAflTradePickPavPolicy({
    schemaVersion: 'afl-trade-pick-pav-policy/v1',
    authorityBoundary:
      'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'non_production',
    competition: 'AFLM',
    policyVersion: 'dispatch-tracer-v1',
    supportedPathway: 'national',
    supportedAccess: 'open',
    firstOutcomeSeasonOffset: 1,
    fixedHorizonSeasons: 1,
    methodId,
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    categoryMinimums: {
      replacementLevel: 10,
      regularContributor: 30,
      highQuality: 60,
      elite: 90,
    },
    partitions: [
      { role: 'train', fromDraftYear: 2000, throughDraftYear: 2003 },
      { role: 'calibration', fromDraftYear: 2006, throughDraftYear: 2006 },
      { role: 'validation', fromDraftYear: 2009, throughDraftYear: 2009 },
      { role: 'final_test', fromDraftYear: 2012, throughDraftYear: 2012 },
    ],
    approvalDecision: {
      id: addressed('review-decision', 'pick-policy'),
      sha256: digest('pick-policy'),
    },
    createdAt: '1999-01-01T00:00:00.000Z',
  });
}

function calculation(draftYear: number, methodId: string, factualRunId: string) {
  const seasonYear = draftYear + 1;
  const players = [
    {
      spellVersionId: addressed('acquisition-spell-version', `selected:${draftYear}`),
      playerId: `player:${draftYear}`,
      sourceRowIds: Array.from({ length: 18 }, (_, index) => `row:${draftYear}:${index}`),
    },
    {
      spellVersionId: addressed('acquisition-spell-version', `filler:${draftYear}`),
      playerId: `player:filler:${draftYear}`,
      sourceRowIds: Array.from({ length: 20 }, (_, index) => `row:filler:${draftYear}:${index}`),
    },
  ] as const;
  const stats = {
    totalPoints: 10,
    hitOuts: 1,
    goalAssists: 1,
    inside50s: 2,
    marks: 3,
    marksInside50: 1,
    freeKicksFor: 2,
    freeKicksAgainst: 1,
    rebound50s: 1,
    onePercenters: 1,
    clearances: 2,
    tackles: 3,
  };
  const core = calculateAflTradeHpnPavCore([
    {
      teamId: `club:${draftYear}`,
      pointsFor: 100,
      pointsAgainst: 80,
      inside50sFor: 50,
      inside50sAgainst: 40,
      players: [{ ...players[0], ...stats }],
    },
    {
      teamId: `club:filler:${draftYear}`,
      pointsFor: 80,
      pointsAgainst: 100,
      inside50sFor: 40,
      inside50sAgainst: 50,
      players: [{ ...players[1], ...stats }],
    },
  ]);
  const content = {
    schemaVersion: AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
    authorityBoundary:
      'private_finalized_hpn_input_exact_method_bytes_no_publication_or_fantasy_ownership' as const,
    publicationEligible: false as const,
    environment: 'non_production' as const,
    competition: 'AFLM' as const,
    seasonYear,
    effectiveThrough: `${seasonYear}-12-31T23:59:59.000Z`,
    calculatedAt: `${seasonYear + 1}-01-01T00:00:00.000Z`,
    methodId,
    inputSetId: addressed('hpn-pav-input-set', `input:${draftYear}`),
    inputSetSha256: digest(`input:${draftYear}`),
    factualRunId,
    factualInputSetSha256: digest(`facts:${draftYear}`),
    primaryProviders: ['afl_tables'],
    corroboratingProviders: ['footywire'],
    resultSourceRowIds: [`row:result:${draftYear}`],
    valueUnit: 'season_pav' as const,
    ...core,
    players: core.players.map((player) => ({
      ...player,
      source: {
        ...player.source,
        gamesPlayed: player.playerId === `player:${draftYear}` ? 18 : 20,
      },
    })),
  };
  return aflTradeFinalizedHpnPavCalculationSchema.parse({
    calculationId: createAflTradeContentAddress('hpn-pav-season', content),
    content,
  });
}

function substantiveHpnValuesSha256(value: ReturnType<typeof calculation>): string {
  const nonSubstantiveCalculationKeys = new Set([
    'effectiveThrough',
    'calculatedAt',
    'inputSetId',
    'inputSetSha256',
    'factualRunId',
    'factualInputSetSha256',
    'primaryProviders',
    'corroboratingProviders',
    'resultSourceRowIds',
    'players',
  ]);
  return sha256AflTradeCanonicalJson({
    ...Object.fromEntries(
      Object.entries(value.content).filter(([key]) => !nonSubstantiveCalculationKeys.has(key))
    ),
    players: value.content.players.map((player) => ({
      ...Object.fromEntries(
        Object.entries(player).filter(([key]) => key !== 'spellVersionId' && key !== 'source')
      ),
      source: Object.fromEntries(
        Object.entries(player.source).filter(([key]) => key !== 'sourceRowIds')
      ),
    })),
  });
}

function datasetAuthority(input: {
  factualReleaseId: string;
  factualCandidateId: string;
  memberSetSha256: string;
}) {
  const feature = {
    kind: 'acquisition_spell_metric' as const,
    memberId: addressed('acquisition-spell-metric-version', 'feature'),
    recordSha256: digest('feature'),
    headRevision: 1,
    effectiveFrom: '1999-01-01',
    effectiveThrough: '1999-12-31',
    recordedAt: '2000-01-01T00:00:00.000Z',
    state: 'complete' as const,
    playerId: 'player:dataset',
    clubId: 'club:dataset',
    spellVersionId: addressed('acquisition-spell-version', 'dataset-spell'),
    metricCode: 'games',
  };
  const row = createAflTradeValuationDatasetRow({
    schemaVersion: AFL_TRADE_VALUATION_DATASET_ROW_SCHEMA_VERSION,
    ordinal: 1,
    rowKey: 'row:dataset',
    competition: 'AFLM',
    seasonYear: 2001,
    cohortIds: ['era:historical'],
    predictionOriginAt: '2000-01-01T00:00:00.000Z',
    featureKnownThrough: '2000-01-01T00:00:00.000Z',
    targetFrom: '2001-01-01T00:00:00.000Z',
    targetThrough: '2001-12-31T00:00:00.000Z',
    splitRole: 'train',
    leakageGroups: {
      acquisition_spell: 'acquisition-spell:dataset',
      event: 'event:dataset',
      player: 'player:dataset',
    },
    identity: {
      playerId: 'player:dataset',
      playerResolutionDecisionId: addressed('provider-resolution-decision', 'player'),
      playerAssignmentRevision: 1,
      clubId: 'club:dataset',
      clubResolutionDecisionId: addressed('provider-resolution-decision', 'club'),
      clubAssignmentRevision: 1,
    },
    lineage: {
      eventId: 'event:dataset',
      eventVersionId: 'event-version:dataset',
      acquisitionSpellId: 'acquisition-spell:dataset',
      acquisitionSpellVersionId: feature.spellVersionId,
      lineageEdgeIds: [],
    },
    featureInputs: [feature],
    targetInputs: [
      {
        ...feature,
        memberId: addressed('acquisition-spell-metric-version', 'target'),
        recordSha256: digest('target'),
        effectiveFrom: '2001-01-01',
        effectiveThrough: '2001-12-31',
        recordedAt: '2002-01-01T00:00:00.000Z',
      },
    ],
  });
  const specification = createAflTradeValuationDatasetSpecification({
    schemaVersion: 'afl-trade-valuation-dataset-specification/v1',
    environment: 'non_production',
    scopeKey: 'afl-men:2025-trades',
    competition: 'AFLM',
    modelKind: 'player_contribution_and_availability',
    createdAt: '2026-08-23T00:00:00.000Z',
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
      { role: 'train', from: '1999-01-01', to: '2002-01-01' },
      { role: 'calibration', from: '2002-01-08', to: '2003-01-01' },
      { role: 'validation', from: '2003-01-08', to: '2004-01-01' },
      { role: 'final_test', from: '2004-01-08', to: '2005-01-01' },
    ],
    embargoDays: 7,
    leakageGroupKinds: ['acquisition_spell', 'event', 'player'],
    featureDefinitions: [reference('feature-definition')],
    targetDefinition: reference('target-definition'),
    valueUnitDefinition: reference('value-unit'),
    roleTaxonomy: reference('role-taxonomy'),
    eraDefinition: reference('era-definition'),
    censoringDefinition: reference('censoring-definition'),
    inclusionPolicy: reference('inclusion-policy'),
  });
  const corpusId = addressed('corpus', 'pick-corpus');
  const lineageId = addressed('corpus-factual-lineage', 'pick-lineage');
  const dataset = createAflTradeValuationDatasetCandidate({
    schemaVersion: AFL_TRADE_VALUATION_DATASET_CANDIDATE_SCHEMA_VERSION,
    authorityBoundary:
      'private_factual_feature_dataset_no_model_fit_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'non_production',
    scopeKey: 'afl-men:2025-trades',
    competition: 'AFLM',
    createdAt: '2026-08-23T00:00:00.000Z',
    knowledgeCutoffAt: '2026-08-22T00:00:00.000Z',
    factualParent: {
      corpusId,
      corpusToCandidateLineageId: lineageId,
      factualReleaseId: input.factualReleaseId,
      factualCandidateId: input.factualCandidateId,
      sourceMemberSetSha256: input.memberSetSha256,
      archiveDatasetId: addressed('archive-dataset', 'archive'),
      sourceSnapshotSetId: addressed('source-snapshot-set', 'snapshots'),
      metricRegistryVersion: 'tracer-v1',
      acquisitionSpellRuleId: addressed('acquisition-spell-rule', 'rule'),
      factualEffectiveThrough: '2001-12-31T00:00:00.000Z',
      releaseRecordStateId: addressed('outcome-release-record-state', 'state'),
      releaseApprovalEventId: addressed('outcome-release-event', 'approval'),
      releaseRegistryRevision: 1,
    },
    specification,
    requiredSourceUses: {
      operations: ['derived_feature_creation', 'model_training'],
      fieldUses: ['derived_feature', 'model_training'],
      publicDerivedOutput: 'not_authorized_by_dataset_admission',
      revalidateAtModelRunStart: true,
    },
    includedCohorts: ['era:historical'],
    excludedCohorts: [],
    rows: [row],
    exclusionReport: reference('exclusion-report'),
    datasetArtifact: reference('dataset-artifact'),
    extractor: {
      codeArtifact: reference('extractor-code'),
      configurationArtifact: reference('extractor-config'),
    },
  });
  const admission = createAflTradeValuationDatasetAdmissionReceipt({
    schemaVersion: 'afl-trade-dataset-admission/v3',
    authorityBoundary: 'dataset_admission_only_no_model_fit_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'non_production',
    admittedAt: '2026-08-23T00:01:00.000Z',
    datasetCreatedAt: dataset.content.createdAt,
    datasetId: dataset.datasetId,
    datasetSha256: dataset.datasetId.slice('dataset:'.length),
    factualReleaseId: input.factualReleaseId,
    factualCandidateId: input.factualCandidateId,
    sourceMemberSetSha256: input.memberSetSha256,
    corpusId,
    corpusToCandidateLineageId: lineageId,
    gate2Decision: {
      decisionId: addressed('gate-decision', 'dataset-gate'),
      state: 'approved',
      effectiveAt: dataset.content.createdAt,
      evaluatedAt: '2026-08-23T00:01:00.000Z',
      revalidateAt: '2027-08-23T00:01:00.000Z',
      pinnedCorpusId: corpusId,
      pinnedCorpusToCandidateLineageId: lineageId,
      pinnedFactualReleaseId: input.factualReleaseId,
      pinnedFactualCandidateId: input.factualCandidateId,
    },
    sourceRightsEvaluations: [
      {
        captureId: 'capture:pick-tracer',
        sourceSnapshotId: addressed('source-snapshot', 'snapshot'),
        consumedFieldSetId: addressed('consumed-field-set', 'fields'),
        proposalId: addressed('source-rights', 'rights'),
        derivationDecisionId: addressed('gate-decision', 'derive'),
        derivationEvaluationReceiptId: addressed('gate0a-evaluation', 'derive'),
        derivationEvaluatedAt: '2026-08-22T00:00:00.000Z',
        admissionDecisionId: addressed('gate-decision', 'admit'),
        admissionEvaluationReceiptId: addressed('gate0a-evaluation', 'admit'),
        admissionEvaluatedAt: '2026-08-23T00:01:00.000Z',
        consumedFieldSetSha256: digest('fields'),
        operations: ['derived_feature_creation', 'model_training'],
        fieldUses: ['derived_feature', 'model_training'],
        status: 'approved',
        termsValidThrough: null,
      },
    ],
    analyticalAuthorityReceiptId: addressed('architecture-operation-receipt', 'analytical'),
    operationalAuthorizationReceiptId: addressed('architecture-operation-receipt', 'operational'),
  });
  const protocolContent = {
    schemaVersion: 'afl-trade-model-protocol/v1' as const,
    environment: 'non_production' as const,
    protocolKey: 'dispatch-bound-pick-tracer',
    version: 1,
    modelKind: 'draft_pick_and_future_pick_distribution' as const,
    datasetId: dataset.datasetId,
    preparedAt: '2026-08-23T00:02:00.000Z',
    preparedBy: 'system:pick-tracer',
    proposalOrigin: 'agent_assisted' as const,
    publicAssetBoundary: 'source_native_afl_draft_entitlement_no_fantasy_ownership' as const,
    estimands: ['draft_pick_outcome_distribution', 'future_pick_landing_distribution'] as const,
    valueAlignment: {
      valueUnitId: 'season-pav',
      playerContributionAlignmentArtifact: reference('alignment'),
      aggregation: 'expected_additive_contribution' as const,
    },
    outcomeMixture: {
      hurdleOutcomeDefinitionArtifact: reference('hurdle'),
      regularOutcomeDefinitionArtifact: reference('regular'),
      eliteOutcomeDefinitionArtifact: reference('elite'),
      probabilityMass: 'mutually_exclusive_and_exhaustive' as const,
      activeCareerTreatment: 'right_censored' as const,
    },
    pickCurve: {
      domain: 'national_draft_selection_number' as const,
      smoother: 'constrained_monotonic' as const,
      expectedContributionDirection: 'non_increasing_with_pick_number' as const,
      monotonicViolations: 'prohibited' as const,
      uncertaintyTreatment: 'preserved_not_point_estimate_only' as const,
      extrapolationDefinitionArtifact: reference('extrapolation'),
    },
    cohortPolicy: {
      eraDefinitionArtifact: reference('era'),
      draftPathwayDefinitionArtifact: reference('pathway'),
      incompleteCareerTreatmentArtifact: reference('career'),
      delistedAndInactiveDefinitionArtifact: reference('inactive'),
    },
    futurePickSimulation: {
      landingPositionModelArtifact: reference('landing'),
      selectionOrderRulesArtifact: reference('selection-order'),
      ruleVintage: 'as_known_at_valuation_cutoff' as const,
      timeDelayDefinitionArtifact: reference('delay'),
      correlatedLadderOutcomeArtifact: reference('ladder'),
      simulationDraws: 10_000,
      randomSeedPolicy: 'model_run_manifest_seed' as const,
      landingCalibration: 'held_out_temporal_seasons' as const,
      scenarioSensitivityArtifacts: [reference('scenario')],
    },
    featurePolicy: {
      knowledgeJoin: 'point_in_time_as_known_at_valuation_cutoff' as const,
      correctionAvailability: 'only_after_known_from' as const,
      unknownAndZero: 'distinct' as const,
      postOutcomeFeatures: 'prohibited' as const,
      featureAvailabilityArtifact: reference('availability'),
    },
    windows: {
      train: { from: '2000-01-01T00:00:00.000Z', to: '2005-01-01T00:00:00.000Z' },
      calibration: { from: '2005-01-08T00:00:00.000Z', to: '2008-01-01T00:00:00.000Z' },
      validation: { from: '2008-01-08T00:00:00.000Z', to: '2011-01-01T00:00:00.000Z' },
      finalTest: { from: '2011-01-08T00:00:00.000Z', to: '2014-01-01T00:00:00.000Z' },
      embargoDays: 7,
    },
    modelSelectionPolicy: {
      candidateSelectionData: 'train_calibration_validation_only' as const,
      finalTestUse: 'single_evaluation_after_candidate_lock' as const,
      finalTestRetuning: 'prohibited' as const,
    },
    validationPlan: {
      baselineDefinitionArtifacts: [reference('baseline')],
      metricDefinitionArtifacts: [reference('metric')],
      probabilityCalibrationArtifact: reference('probability'),
      intervalCoverageArtifact: reference('interval'),
      monotonicityAuditArtifact: reference('monotonicity'),
      subgroupDimensions: [...AFL_TRADE_PICK_MODEL_SUBGROUPS],
      sensitivityAnalysisArtifacts: [reference('sensitivity')],
      acceptanceCriteriaArtifact: reference('acceptance'),
    },
    limitations: ['Non-production dispatch tracer authority.'],
  };
  const protocol = aflTradePickDistributionModelProtocolSchema.parse({
    protocolId: createAflTradeContentAddress('model-protocol', protocolContent),
    content: protocolContent,
  });
  return { dataset, admission, protocol };
}

beforeAll(async () => {
  artifactRoot = await mkdtemp(join(tmpdir(), 'statly-genuine-pick-pav-'));
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
  await expect(
    adminPool.query(
      `SELECT has_table_privilege(
         'afl_trade_private_evaluation_coordinator',$1,'SELECT'
       ) AS can_read_policy`,
      [`${schemaName}.outcome_pick_pav_policy`]
    )
  ).resolves.toMatchObject({ rows: [{ can_read_policy: true }] });
  await adminPool.query(`CREATE ROLE "${runtimeRoleName}" NOLOGIN NOINHERIT`);
  await adminPool.query(`GRANT afl_trade_private_evaluation_coordinator TO "${runtimeRoleName}"`);
});

afterAll(async () => {
  await restrictedPool?.end();
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.query(`DROP ROLE IF EXISTS "${runtimeRoleName}"`);
  await adminPool.end();
  await rm(artifactRoot, { recursive: true, force: true });
});

describe.sequential('genuine dispatch-bound pick-PAV PostgreSQL tracer', () => {
  it('materializes, fits, validates, retains, and fences one exact component run', async () => {
    const requestId = addressed('private-valuation-dispatch', 'pick-request');
    const claimId = addressed('private-valuation-dispatch-claim', 'pick-claim');
    const leaseToken = digest('pick-lease-token');
    const factualRunId = addressed('factual-reconciliation-run', 'pick-factual-run');
    const memberSetSha256 = digest('pick-factual-members');
    const factualCandidateId = addressed('factual-release-candidate', 'pick-candidate');
    const factualReleaseId = addressed('outcome-release', 'pick-release');
    const factual = createAflTradePrivateValuationFactualOutput({
      requestId,
      valuationScopeKey: 'afl-men:2025-trades',
      captureBindingId: addressed('private-valuation-capture-binding', 'capture'),
      sourceAdmissionId: addressed('private-valuation-source-admission', 'source-admission'),
      normalizationRunId: addressed('provider-normalization-run', 'normalization'),
      factBatch: {
        batchId: addressed('source-fact-batch', 'batch'),
        batchSha256: digest('batch'),
      },
      reconciliation: {
        factualRunId,
        runSha256: factualRunId.slice('factual-reconciliation-run:'.length),
        outputSetSha256: digest('output-set'),
        finalizedAt: '2026-08-23T23:59:00.000Z',
      },
      spellMetricBatches: [
        {
          batchId: addressed('acquisition-spell-metric-batch', 'metrics'),
          batchSha256: digest('metrics'),
        },
      ],
      candidate: {
        candidateId: factualCandidateId,
        candidateSha256: factualCandidateId.slice('factual-release-candidate:'.length),
        memberSetSha256,
      },
      factualRelease: {
        releaseId: factualReleaseId,
        releaseSha256: factualReleaseId.slice('outcome-release:'.length),
      },
      preparedAt: retainedAt,
    });
    const methodId = addressed('hpn-pav-method', 'pick-method');
    const calculations = years.map((year) => calculation(year, methodId, factualRunId));
    const reviewedPolicy = policy(methodId);
    const authority = datasetAuthority({
      factualReleaseId,
      factualCandidateId,
      memberSetSha256,
    });
    const exactCalculation = calculations.at(-1)!;
    const hpnValuesSha256 = substantiveHpnValuesSha256(exactCalculation);
    const operation = createAflTradePrivateValuationModelOperation({
      scopeKey: 'afl-men:2025-trades',
      factualValuesSha256: memberSetSha256,
      hpnValuesSha256,
      hpnMethodId: methodId,
      player: {
        modelId: addressed('development-grade-model', 'player'),
        modelVersion: 'player-v1',
        protocolId: addressed('model-protocol', 'player'),
        datasetId: addressed('dataset', 'player'),
        datasetAdmissionId: addressed('dataset-admission', 'player'),
      },
      pick: {
        protocolId: authority.protocol.protocolId,
        datasetId: authority.dataset.datasetId,
        datasetAdmissionId: authority.admission.admissionId,
        policyId: reviewedPolicy.policyId,
      },
      qualificationPolicyId: addressed('model-qualification-policy', 'qualification'),
    });
    const exactInput = {
      requestId,
      scopeKey: operation.content.scopeKey,
      factualOutputId: factual.outputId,
      hpnCalculationId: exactCalculation.calculationId,
      substantive: {
        factualValuesSha256: memberSetSha256,
        hpnValuesSha256,
        hpnMethodId: methodId,
        player: operation.content.player,
        pick: operation.content.pick,
        qualificationPolicyId: operation.content.qualificationPolicyId,
      },
    };
    const now = new Date();
    const seed = await pool.connect();
    try {
      await seed.query('BEGIN');
      await seed.query(`SET LOCAL session_replication_role='replica'`);
      await seed.query(
        `INSERT INTO outcome_private_valuation_dispatch_request
          (request_id,scope_key,trigger_kind,scheduled_for,authority_key,status,available_at,
           claim_id,lease_token_sha256,lease_expires_at,claimed_at,request_json,claim_sequence)
         VALUES ($1,$2,'ad_hoc',$3,'pick-tracer','claimed',$3,$4,$5,$6,$3,'{}'::jsonb,1)`,
        [
          requestId,
          operation.content.scopeKey,
          now,
          claimId,
          digest(leaseToken),
          new Date(now.getTime() + 300_000),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_private_valuation_dispatch_attempt
          (claim_id,request_id,attempt_sequence,attempt_number,worker_id,lease_token_sha256,
           claimed_at,lease_expires_at,heartbeat_at)
         VALUES ($1,$2,1,1,'system:pick-tracer',$3,$4,$5,$4)`,
        [claimId, requestId, digest(leaseToken), now, new Date(now.getTime() + 300_000)]
      );
      await seed.query(
        `INSERT INTO outcome_private_valuation_factual_output
          (output_id,request_id,capture_binding_id,source_admission_id,normalization_run_id,
           fact_batch_id,factual_run_id,candidate_id,factual_release_id,prepared_at,output_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [
          factual.outputId,
          requestId,
          factual.content.captureBindingId,
          factual.content.sourceAdmissionId,
          factual.content.normalizationRunId,
          factual.content.factBatch.batchId,
          factualRunId,
          factualCandidateId,
          factualReleaseId,
          factual.content.preparedAt,
          canonicalizeAflTradeJson(factual),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_hpn_pav_method
          (method_id,method_sha256,environment,source_artifact_id,captured_at,registered_at,
           method_canonical_json,method_json)
         VALUES ($1,$2,'non_production',$3,$4,$4,'{}','{}'::jsonb)`,
        [
          methodId,
          methodId.slice('hpn-pav-method:'.length),
          addressed('artifact', 'method'),
          retainedAt,
        ]
      );
      await seed.query(
        `INSERT INTO outcome_release_manifest
          (release_id,scope_key,environment,created_at,effective_through,manifest_json)
         VALUES ($1,'pick-tracer','non_production',$2,$3,'{}'::jsonb)`,
        [factualReleaseId, retainedAt, '2013-12-31T23:59:59.000Z']
      );
      await seed.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,
           evidence_json,decided_by,decided_at)
         VALUES ($1,'pick_pav_policy','AFLM:dispatch-tracer-v1','approved',NULL,'tracer',
           $2::jsonb,'system:pick-tracer',$3)`,
        [
          reviewedPolicy.content.approvalDecision.id,
          canonicalizeAflTradeJson(
            Object.fromEntries(
              Object.entries(reviewedPolicy.content).filter(([key]) => key !== 'approvalDecision')
            )
          ),
          reviewedPolicy.content.createdAt,
        ]
      );
      await seed.query(
        `INSERT INTO outcome_pick_pav_policy
          (policy_id,policy_sha256,environment,competition,policy_version,method_id,
           approval_decision_id,created_at,policy_canonical_json,policy_json)
         VALUES ($1,$2,'non_production','AFLM',$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          reviewedPolicy.policyId,
          reviewedPolicy.policyId.slice('pick-pav-policy:'.length),
          reviewedPolicy.content.policyVersion,
          methodId,
          reviewedPolicy.content.approvalDecision.id,
          reviewedPolicy.content.createdAt,
          canonicalizeAflTradeJson(reviewedPolicy.content),
          canonicalizeAflTradeJson(reviewedPolicy),
        ]
      );
      for (const [ordinal, draftYear] of years.entries()) {
        const selectionNumber = ordinal < 4 ? [10, 14, 14, 20][ordinal]! : 14;
        const eventId = `draft:${draftYear}:national`;
        const eventVersionId = addressed('event-version', eventId);
        const selectionId = addressed('draft-selection', `${draftYear}:${selectionNumber}`);
        const pickId = `pick:${draftYear}:national:${selectionNumber}`;
        const access = {
          state: 'open' as const,
          decision: {
            id: addressed('review-decision', `access:${draftYear}`),
            sha256: digest(`access:${draftYear}`),
          },
          recordedAt: `${draftYear}-11-22T00:00:00.000Z`,
        };
        await seed.query(`INSERT INTO outcome_event VALUES ($1,'AFLM',$2,$1)`, [
          eventId,
          draftYear,
        ]);
        await seed.query(
          `INSERT INTO outcome_event_version
            (event_version_id,event_id,version,kind,acquisition_mechanism,event_date,
             official_name,status,source_import_row_id,recorded_at)
           VALUES ($1,$2,1,'national_draft','national_draft',$3,$2,'approved',$2,$4)`,
          [eventVersionId, eventId, `${draftYear}-11-20`, `${draftYear}-11-21T00:00:00.000Z`]
        );
        await seed.query(
          `INSERT INTO outcome_draft_pick
            (pick_id,draft_season_year,draft_kind,nominal_round,nominal_pick,status)
           VALUES ($1,$2,'national_draft',1,$3,'approved')`,
          [pickId, draftYear, selectionNumber]
        );
        await seed.query(
          `INSERT INTO outcome_draft_selection
            (selection_id,event_version_id,selection_number,pick_id,player_id,player_identity_id,
             club_id,source_import_row_id,status)
           VALUES ($1,$2,$3,$4,$5,$5,$6,$1,'approved')`,
          [
            selectionId,
            eventVersionId,
            selectionNumber,
            pickId,
            `player:${draftYear}`,
            `club:${draftYear}`,
          ]
        );
        await seed.query(
          `INSERT INTO outcome_release_draft_selection
            (release_id,selection_id,ordinal,record_sha256,record_canonical_json,membership_json)
           VALUES ($1,$2,$3,$4,'{}','{}'::jsonb)`,
          [factualReleaseId, selectionId, ordinal + 1, digest(`member:${draftYear}`)]
        );
        const { decision: _decision, ...accessEvidence } = access;
        await seed.query(
          `INSERT INTO outcome_review_decision
            (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,
             evidence_json,decided_by,decided_at)
           VALUES ($1,'pick_pav_selection_access',$2,'approved',NULL,'tracer',$3::jsonb,
             'system:pick-tracer',$4)`,
          [
            access.decision.id,
            selectionId,
            canonicalizeAflTradeJson(accessEvidence),
            access.recordedAt,
          ]
        );
        await seed.query(
          `INSERT INTO outcome_pick_pav_selection_access
            (decision_id,selection_id,access_state,restriction,bid_selection_number,recorded_at,
             access_canonical_json,access_json)
           VALUES ($1,$2,'open',NULL,NULL,$3,$4,$5::jsonb)`,
          [
            access.decision.id,
            selectionId,
            access.recordedAt,
            canonicalizeAflTradeJson(access),
            canonicalizeAflTradeJson(access),
          ]
        );
      }
      for (const value of calculations) {
        await seed.query(
          `INSERT INTO outcome_hpn_pav_calculation
            (calculation_id,calculation_sha256,schema_version,input_set_id,method_id,environment,
             competition,season_year,effective_through,calculated_at,value_unit,status,team_count,
             player_count,calculation_canonical_json,calculation_json,finalized_at)
           VALUES ($1,$2,$3,$4,$5,'non_production','AFLM',$6,$7,$8,'season_pav','finalized',
             $9,$10,$11,$12::jsonb,$8)`,
          [
            value.calculationId,
            value.calculationId.slice('hpn-pav-season:'.length),
            value.content.schemaVersion,
            value.content.inputSetId,
            methodId,
            value.content.seasonYear,
            value.content.effectiveThrough,
            value.content.calculatedAt,
            value.content.teams.length,
            value.content.players.length,
            canonicalizeAflTradeJson(value.content),
            canonicalizeAflTradeJson(value),
          ]
        );
        for (const [ordinal, team] of value.content.teams.entries()) {
          await seed.query(
            `INSERT INTO outcome_hpn_pav_calculation_team
              (calculation_id,team_id,ordinal,team_sha256,offensive_pav,midfield_pav,
               defensive_pav,total_pav,team_canonical_json)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              value.calculationId,
              team.teamId,
              ordinal,
              sha256AflTradeCanonicalJson(team),
              team.offensivePav,
              team.midfieldPav,
              team.defensivePav,
              team.totalPav,
              canonicalizeAflTradeJson(team),
            ]
          );
        }
        for (const [ordinal, player] of value.content.players.entries()) {
          await seed.query(
            `INSERT INTO outcome_hpn_pav_calculation_player
              (calculation_id,spell_version_id,player_id,team_id,ordinal,player_sha256,
               offensive_pav,midfield_pav,defensive_pav,total_pav,player_canonical_json)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              value.calculationId,
              player.spellVersionId,
              player.playerId,
              player.teamId,
              ordinal,
              sha256AflTradeCanonicalJson(player),
              player.offensivePav,
              player.midfieldPav,
              player.defensivePav,
              player.totalPav,
              canonicalizeAflTradeJson(player),
            ]
          );
        }
        await seed.query(
          `INSERT INTO outcome_hpn_pav_calculation_head
            (environment,competition,season_year,method_id,calculation_id,revision,updated_at)
           VALUES ('non_production','AFLM',$1,$2,$3,1,$4)`,
          [value.content.seasonYear, methodId, value.calculationId, value.content.calculatedAt]
        );
      }
      await seed.query(
        `INSERT INTO outcome_valuation_dataset_candidate
          (dataset_id,environment,scope_key,competition,created_at,knowledge_cutoff_at,
           factual_release_id,factual_candidate_id,corpus_id,lineage_id,source_member_set_sha256,
           row_count,row_set_sha256,row_set_canonical_json,artifact_count,status,
           dataset_canonical_json,dataset_json,finalized_at)
         VALUES ($1,'non_production',$2,'AFLM',$3,$4,$5,$6,$7,$8,$9,$10,$11,'[]',10,
           'finalized',$12,$13::jsonb,$3)`,
        [
          authority.dataset.datasetId,
          authority.dataset.content.scopeKey,
          authority.dataset.content.createdAt,
          authority.dataset.content.knowledgeCutoffAt,
          factualReleaseId,
          factualCandidateId,
          authority.dataset.content.factualParent.corpusId,
          authority.dataset.content.factualParent.corpusToCandidateLineageId,
          memberSetSha256,
          authority.dataset.content.rowCount,
          authority.dataset.content.rowSetSha256,
          canonicalizeAflTradeJson(authority.dataset.content),
          canonicalizeAflTradeJson(authority.dataset),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_valuation_dataset_admission
          (admission_id,dataset_id,environment,admitted_at,gate2_decision_id,
           gate_ledger_revision,analytical_authority_receipt_id,
           operational_authorization_receipt_id,source_count,status,
           admission_canonical_json,admission_json,finalized_at)
         VALUES ($1,$2,'non_production',$3,$4,1,$5,$6,1,'finalized',$7,$8::jsonb,$3)`,
        [
          authority.admission.admissionId,
          authority.dataset.datasetId,
          authority.admission.content.admittedAt,
          authority.admission.content.gate2Decision.decisionId,
          authority.admission.content.analyticalAuthorityReceiptId,
          authority.admission.content.operationalAuthorizationReceiptId,
          canonicalizeAflTradeJson(authority.admission.content),
          canonicalizeAflTradeJson(authority.admission),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_valuation_model_protocol
          (protocol_id,environment,dataset_id,admission_id,analytical_authority_receipt_id,
           prepared_at,protocol_canonical_json,protocol_json)
         VALUES ($1,'non_production',$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          authority.protocol.protocolId,
          authority.dataset.datasetId,
          authority.admission.admissionId,
          authority.admission.content.analyticalAuthorityReceiptId,
          authority.protocol.content.preparedAt,
          canonicalizeAflTradeJson(authority.protocol.content),
          canonicalizeAflTradeJson(authority.protocol),
        ]
      );
      await seed.query('COMMIT');
    } catch (error) {
      await seed.query('ROLLBACK');
      throw error;
    } finally {
      seed.release();
    }

    const pairRepository = new PostgresAflTradePrivateValuationModelPairRepository(client);
    await pairRepository.bindInput({ exactInput, claim: { claimId, leaseToken } });
    restrictedPool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schemaName} -c role=${runtimeRoleName}`,
      max: 1,
    });
    const restrictedClient = createPgAflOutcomeSqlClient(restrictedPool);
    const restrictedMaterializer = new PostgresGenuineDispatchBoundPickPavMaterializer(
      restrictedClient
    );
    await expect(
      restrictedMaterializer.materialize({
        exactInput,
        operation,
        attemptNumber: 1,
        claim: { claimId, leaseToken },
      })
    ).resolves.toMatchObject({
      observationSet: { content: { releaseId: factualReleaseId } },
      factual: { outputId: factual.outputId },
    });

    const artifactRepository = createLocalAflTradePrivateDerivedArtifactRepository({
      rootDirectory: artifactRoot,
      repositoryId: 'genuine-pick-pav-postgres-tracer',
      maximumObjectBytes: 4 * 1024 * 1024,
    });
    const staging = createPostgresGovernedPrivateEvaluationStagingRepository({
      client,
      artifactRepository,
      maximumArtifactBytes: 4 * 1024 * 1024,
    });
    const retainArtifact = async ({
      document,
      createdAt,
    }: {
      document: unknown;
      createdAt: string;
    }) => {
      const reference = createAflTradeCanonicalJsonArtifactRef(document, createdAt);
      await staging.retainArtifact({
        reference,
        bytes: new TextEncoder().encode(canonicalizeAflTradeJson(document)),
      });
      return reference;
    };
    let modelTimestamp: string | undefined;
    let successfulWorkRetentions = 0;
    const executor = createPostgresGenuineDispatchBoundPickPavExecutor({
      client: restrictedClient,
      artifactRepository,
      maximumArtifactBytes: 4 * 1024 * 1024,
      retainArtifact: async (value) => {
        successfulWorkRetentions += 1;
        return retainArtifact(value);
      },
      clock: { now: () => (modelTimestamp ??= new Date().toISOString()) },
    });
    const execution = {
      exactInput,
      operation,
      attemptNumber: 1,
      claim: { claimId, leaseToken },
    };

    const setClaimLease = async (leaseExpiresAtSql: string) => {
      const lease = await pool.connect();
      try {
        await lease.query('BEGIN');
        await lease.query(`SET LOCAL session_replication_role='replica'`);
        await lease.query(
          `UPDATE outcome_private_valuation_dispatch_request
              SET lease_expires_at=${leaseExpiresAtSql}
            WHERE request_id=$1`,
          [requestId]
        );
        await lease.query(
          `UPDATE outcome_private_valuation_dispatch_attempt
              SET lease_expires_at=${leaseExpiresAtSql}
            WHERE claim_id=$1`,
          [claimId]
        );
        await lease.query('COMMIT');
      } catch (error) {
        await lease.query('ROLLBACK');
        throw error;
      } finally {
        lease.release();
      }
    };
    let expireAfterMaterialization = true;
    const expiringClient: typeof client = {
      query: (sql, parameters) => client.query(sql, parameters),
      async transaction(work) {
        const result = await client.transaction(work);
        if (expireAfterMaterialization) {
          expireAfterMaterialization = false;
          await setClaimLease(`clock_timestamp()-interval '1 millisecond'`);
        }
        return result;
      },
    };
    let staleAuthorityArtifactRetentions = 0;
    const staleExecutor = createPostgresGenuineDispatchBoundPickPavExecutor({
      client: expiringClient,
      artifactRepository,
      maximumArtifactBytes: 4 * 1024 * 1024,
      retainArtifact: async (value) => {
        staleAuthorityArtifactRetentions += 1;
        return retainArtifact(value);
      },
    });
    await expect(staleExecutor.execute(execution)).resolves.toMatchObject({
      state: 'stale_authority',
    });
    expect(staleAuthorityArtifactRetentions).toBe(0);
    await setClaimLease(`clock_timestamp()+interval '5 minutes'`);

    const completed = await executor.execute(execution);
    if (completed.state !== 'completed') throw new Error(completed.reason);
    expect(completed).toMatchObject({ state: 'completed' });
    await expect(
      pool.query(
        `SELECT component.run_id,component.native_execution_kind,execution.execution_json
           FROM outcome_governed_valuation_component_run component
           JOIN outcome_governed_pick_pav_model_execution execution
             ON execution.execution_id=component.native_execution_id
          WHERE component.run_id=$1`,
        [completed.runId]
      )
    ).resolves.toMatchObject({
      rows: [
        {
          run_id: completed.runId,
          native_execution_kind: 'governed_pick_pav_model_execution',
          execution_json: {
            content: {
              schemaVersion: 'afl-trade-pick-pav-model-execution/v4',
              privateInput: {
                requestId,
                operationId: operation.operationId,
                claimId,
                attemptNumber: 1,
                factualOutputId: factual.outputId,
                hpnCalculationId: exactCalculation.calculationId,
              },
            },
          },
        },
      ],
    });
    await expect(
      pool.query(
        `SELECT
           (SELECT count(*)::integer FROM outcome_active_release) AS active_release_count,
           (SELECT count(*)::integer FROM outcome_pick_pav_observation_set) AS observation_set_count,
           (SELECT count(*)::integer FROM outcome_governed_pick_pav_model_execution) AS execution_count,
           (SELECT count(*)::integer FROM outcome_governed_valuation_component_run) AS component_count`
      )
    ).resolves.toMatchObject({
      rows: [
        {
          active_release_count: 0,
          observation_set_count: 1,
          execution_count: 1,
          component_count: 1,
        },
      ],
    });

    const successfulWorkRetentionsBeforeReplay = successfulWorkRetentions;
    const replayed = await executor.execute(execution);
    expect(replayed).toEqual(completed);
    expect(successfulWorkRetentions).toBe(successfulWorkRetentionsBeforeReplay);
    await expect(
      pool.query(
        `SELECT
           (SELECT count(*)::integer FROM outcome_pick_pav_observation_set) AS observation_set_count,
           (SELECT count(*)::integer FROM outcome_governed_pick_pav_model_execution) AS execution_count,
           (SELECT count(*)::integer FROM outcome_governed_valuation_component_run) AS component_count`
      )
    ).resolves.toMatchObject({
      rows: [{ observation_set_count: 1, execution_count: 1, component_count: 1 }],
    });
    await expect(
      pairRepository.acceptComponent({
        operationId: operation.operationId,
        role: 'pick',
        runId: completed.runId,
        claim: { claimId, leaseToken },
      })
    ).resolves.toMatchObject({ pickRunId: completed.runId });
    await expect(
      pairRepository.bindInput({ exactInput, claim: { claimId, leaseToken } })
    ).resolves.toMatchObject({ pickRunId: completed.runId });

    const expiry = await pool.connect();
    try {
      await expiry.query('BEGIN');
      await expiry.query(`SET LOCAL session_replication_role='replica'`);
      await expiry.query(
        `UPDATE outcome_private_valuation_dispatch_request
            SET lease_expires_at=clock_timestamp()-interval '1 millisecond'
          WHERE request_id=$1`,
        [requestId]
      );
      await expiry.query(
        `UPDATE outcome_private_valuation_dispatch_attempt
            SET lease_expires_at=clock_timestamp()-interval '1 millisecond'
          WHERE claim_id=$1`,
        [claimId]
      );
      await expiry.query('COMMIT');
    } catch (error) {
      await expiry.query('ROLLBACK');
      throw error;
    } finally {
      expiry.release();
    }
    await expect(executor.execute(execution)).resolves.toMatchObject({ state: 'stale_authority' });
    await expect(
      pool.query(
        `SELECT
           (SELECT count(*)::integer FROM outcome_governed_pick_pav_model_execution) AS execution_count,
           (SELECT count(*)::integer FROM outcome_governed_valuation_component_run) AS component_count`
      )
    ).resolves.toMatchObject({ rows: [{ execution_count: 1, component_count: 1 }] });
  });
});
