import { createHash } from 'node:crypto';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalSyntheticValuationScenario } from '@/server/aflTradeIntelligence/development/localSyntheticValuationScenario';
import { createAflTradePickPavPolicy } from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';
import { fitAflTradePickPavDistributionBenchmark } from '@/server/aflTradeIntelligence/modeling/pickPavDistributionBenchmark';
import { materializeAflTradePickPavObservationSet } from '@/server/aflTradeIntelligence/modeling/pickPavObservationService';
import { createAflTradeComponentDrawSet } from '@/server/aflTradeIntelligence/valuation/componentDrawSet';
import { createGovernedPrivateEvaluationExplanationPolicy } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationExplanationPolicy';
import { createGovernedPrivateEvaluationInputTrace } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationInputTrace';
import { createGovernedPrivateEvaluationMaterializationManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationMaterializationManifest';
import { createAflTradePackagePolicy } from '@/server/aflTradeIntelligence/valuation/packagePolicy';
import { createAflTradeRealizedContributionLedger } from '@/server/aflTradeIntelligence/valuation/realizedContributionLedger';
import { createAflTradeValuationCalculationInputPackage } from '@/server/aflTradeIntelligence/valuation/valuationCalculationInputPackage';
import {
  createAflTradeLineageGraphId,
  createAflTradeValuationCase,
} from '@/server/aflTradeIntelligence/valuation/valuationCaseContracts';

const CREATED_AT = '2026-08-19T09:00:00.000Z';
const DERIVED_AT = '2026-08-19T10:00:00.000Z';
const benchmarkYears = [2000, 2001, 2002, 2003, 2006, 2009, 2012] as const;
const benchmarkSelections = new Map<number, number>([
  [2000, 10],
  [2001, 14],
  [2002, 20],
  [2003, 25],
  [2006, 10],
  [2009, 14],
  [2012, 20],
]);
const benchmarkContributions = new Map<number, number>([
  [2000, 20.8],
  [2001, 10.4],
  [2002, 7.8],
  [2003, 5.2],
  [2006, 18],
  [2009, 9],
  [2012, 6],
]);

function artifact(label: string) {
  const contentSha256 = createAflTradeContentAddress('artifact', label).split(':')[1]!;
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt: CREATED_AT,
  };
}

function addressed(prefix: string, label: string) {
  return createAflTradeContentAddress(prefix, { fixture: label });
}

function sha(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function createPickBenchmark() {
  const releaseId = addressed('outcome-release', 'authenticated-calculation');
  const methodId = addressed('hpn-pav-method', 'authenticated-calculation');
  const policy = createAflTradePickPavPolicy({
    schemaVersion: 'afl-trade-pick-pav-policy/v1',
    authorityBoundary:
      'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    policyVersion: 'authenticated-calculation-fixture-v1',
    supportedPathway: 'national',
    supportedAccess: 'open',
    firstOutcomeSeasonOffset: 1,
    fixedHorizonSeasons: 1,
    methodId,
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    categoryMinimums: {
      replacementLevel: 5,
      regularContributor: 10,
      highQuality: 15,
      elite: 20,
    },
    partitions: [
      { role: 'train', fromDraftYear: 2000, throughDraftYear: 2003 },
      { role: 'calibration', fromDraftYear: 2006, throughDraftYear: 2006 },
      { role: 'validation', fromDraftYear: 2009, throughDraftYear: 2009 },
      { role: 'final_test', fromDraftYear: 2012, throughDraftYear: 2012 },
    ],
    approvalDecision: {
      id: `review-decision:${sha('authenticated-calculation')}`,
      sha256: sha('authenticated-calculation'),
    },
    createdAt: '1999-01-01T00:00:00.000Z',
  });
  const selections = benchmarkYears.map((draftYear) => {
    const selectionNumber = benchmarkSelections.get(draftYear)!;
    return {
      releaseId,
      selectionId: addressed('draft-selection', `${draftYear}:${selectionNumber}`),
      eventId: `draft:${draftYear}:national`,
      eventVersionId: addressed('event-version', `draft:${draftYear}:national`),
      eventDate: `${draftYear}-11-20`,
      recordedAt: `${draftYear}-11-21T00:00:00.000Z`,
      draftYear,
      pathway: 'national' as const,
      actualSelectionNumber: selectionNumber,
      nominalSelectionNumber: selectionNumber,
      draftRound: selectionNumber <= 20 ? 1 : 2,
      pickId: `pick:${draftYear}:national:${selectionNumber}`,
      playerId: `player:${draftYear}`,
      clubId: `club:${draftYear}`,
      access: {
        state: 'open' as const,
        decision: {
          id: `review-decision:${sha(`access:${draftYear}`)}`,
          sha256: sha(`access:${draftYear}`),
        },
        recordedAt: `${draftYear}-11-22T00:00:00.000Z`,
      },
    };
  });
  const calculations = benchmarkYears.map((draftYear) => {
    const seasonYear = draftYear + 1;
    const calculationSha256 = sha(`calculation:${draftYear}`);
    const sourceRowIds = Array.from(
      { length: 10 },
      (_, index) => `decoded-row:${draftYear}:${index + 1}`
    );
    return {
      calculation: {
        calculationId: `hpn-pav-season:${calculationSha256}`,
        calculationSha256,
        inputSetId: addressed('hpn-pav-input-set', `input:${draftYear}`),
        methodId,
        seasonYear,
        effectiveThrough: `${seasonYear}-12-31T23:59:59.000Z`,
        calculatedAt: `${seasonYear + 1}-01-01T00:00:00.000Z`,
      },
      playerValues: [
        {
          calculationId: `hpn-pav-season:${calculationSha256}`,
          calculationSha256,
          seasonYear,
          spellVersionId: addressed('acquisition-spell-version', `spell:${draftYear}`),
          playerId: `player:${draftYear}`,
          playerSha256: sha(`player:${draftYear}`),
          clubId: `club:${draftYear}`,
          sourceRowIds,
          gamesPlayed: sourceRowIds.length,
          totalPav: benchmarkContributions.get(draftYear)!,
        },
      ],
    };
  });
  const observationSet = materializeAflTradePickPavObservationSet({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2015-01-02T00:00:00.000Z',
    knowledgeCutoffAt: '2015-01-01T00:00:00.000Z',
    releaseId,
    policy,
    selections,
    calculations,
  });
  return fitAflTradePickPavDistributionBenchmark(observationSet, {
    schemaVersion: 'afl-trade-pick-pav-distribution-benchmark-config/v1',
    minimumBlockObservations: 1,
    eligibility: 'mature_open_access_national_draft_training_observations',
    informationWeight: 'eligible_selection_count',
    smoother: 'weighted_non_increasing_isotonic',
    sparseBlockMergePolicy: 'nearest_adjacent_fitted_mean_left_tie_break',
    interpolation: 'left_block_carry_forward_within_training_domain',
    extrapolation: 'prohibited',
    estimatorStatus: 'benchmark_only_requires_temporal_validation_and_approval',
  });
}

export function createGovernedPrivateEvaluationAuthenticatedCalculationFixture() {
  const definition = {
    schemaVersion: 'local-synthetic-trade-definition/v1' as const,
    basis: { kind: 'private_workbook' as const, basisId: 'authenticated-contract-fixture' },
    tradeId: 'trade:authenticated-three-club',
    effectiveAt: '2023-10-18T00:00:00.000Z',
    effectiveThrough: '2026-08-19T00:00:00.000Z',
    parties: [
      { aflClubId: 'club:alpha', clubName: 'Alpha' },
      { aflClubId: 'club:bravo', clubName: 'Bravo' },
      { aflClubId: 'club:charlie', clubName: 'Charlie' },
    ],
    transfers: [
      {
        transferId: 'transfer:01',
        fromClubId: 'club:alpha',
        toClubId: 'club:bravo',
        assetId: 'asset:01',
        assetKind: 'current_pick' as const,
        displayLabel: 'Pick 25',
        directionBasis: 'archive_recorded_transfer' as const,
      },
      {
        transferId: 'transfer:02',
        fromClubId: 'club:alpha',
        toClubId: 'club:charlie',
        assetId: 'asset:02',
        assetKind: 'current_pick' as const,
        displayLabel: 'Pick 14',
        directionBasis: 'archive_recorded_transfer' as const,
      },
      {
        transferId: 'transfer:03',
        fromClubId: 'club:bravo',
        toClubId: 'club:alpha',
        assetId: 'asset:03',
        assetKind: 'future_pick' as const,
        displayLabel: 'Future pick resolved as Pick 20',
        directionBasis: 'archive_recorded_transfer' as const,
      },
      {
        transferId: 'transfer:04',
        fromClubId: 'club:charlie',
        toClubId: 'club:alpha',
        assetId: 'asset:04',
        assetKind: 'future_pick' as const,
        displayLabel: 'Future pick resolved as Pick 10',
        directionBasis: 'archive_recorded_transfer' as const,
      },
    ],
  };
  const scenario = createLocalSyntheticValuationScenario({
    environment: 'test_fixture',
    definition,
    valuationBundleId: addressed('valuation-bundle', 'authenticated-calculation'),
    scenario: 'baseline',
    assessedAt: CREATED_AT,
  });
  const valuationInputBundleId = addressed('valuation-input-bundle', 'authenticated-calculation');
  const componentDrawSet = createAflTradeComponentDrawSet({
    ...scenario.componentDrawSet.content,
    valuationInputBundleId,
    valueUnitId: 'fixed_horizon_pav',
  });
  const realizedContributionLedger = createAflTradeRealizedContributionLedger({
    ...scenario.realizedContributionLedger.content,
    valuationInputBundleId,
    valueUnitId: 'fixed_horizon_pav',
  });
  const packagePolicy = createAflTradePackagePolicy({
    ...scenario.packagePolicy.content,
    valuationInputBundleId,
    valueUnitId: 'fixed_horizon_pav',
  });
  const valuationCase = createAflTradeValuationCase({
    ...scenario.valuationCase.content,
    valuationInputBundleId,
    valueUnitId: 'fixed_horizon_pav',
    componentDrawSetId: componentDrawSet.componentDrawSetId,
    realizedContributionLedgerId: realizedContributionLedger.realizedContributionLedgerId,
    packagePolicyId: packagePolicy.packagePolicyId,
  });
  const traceComponents = componentDrawSet.content.components.map((component, index) => ({
    role: component.role,
    runId: component.runId,
    protocolId: component.protocolId,
    datasetId: component.datasetId,
    datasetAdmissionId: addressed('dataset-admission', `component-${index}`),
    gate3DecisionId: component.gate3DecisionId,
    evidence: {
      runManifest: artifact(`run-${index}`),
      protocol: artifact(`protocol-${index}`),
      datasetAdmission: artifact(`admission-${index}`),
      gate3Decision: artifact(`gate-${index}`),
    },
  }));
  const pickBenchmark = createPickBenchmark();
  const pickBenchmarkArtifact = createAflTradeCanonicalJsonArtifactRef(
    pickBenchmark,
    CREATED_AT
  );
  const selectionByAssetId = new Map([
    ['asset:01', 25],
    ['asset:02', 14],
    ['asset:03', 20],
    ['asset:04', 10],
  ]);
  const lineageLabel = (assetId: string, rootAssetId: string) => {
    const selectionNumber = selectionByAssetId.get(rootAssetId)!;
    if (assetId === rootAssetId) {
      return definition.transfers.find((transfer) => transfer.assetId === rootAssetId)!
        .displayLabel;
    }
    const assetType = scenario.lineageGraph.assets.find((asset) => asset.assetId === assetId)!
      .assetType;
    if (assetType === 'current_pick_entitlement') return `Pick ${selectionNumber}`;
    if (assetType === 'draft_selection') return `Pick ${selectionNumber} draft selection`;
    return `Player selected with Pick ${selectionNumber}`;
  };
  const transformationsFor = (rootAssetId: string) => {
    const transformations = [];
    let sourceAssetId = rootAssetId;
    for (let ordinal = 0; ordinal < 3; ordinal += 1) {
      const edge = scenario.lineageGraph.edges.find(
        (candidate) => candidate.sourceAssetId === sourceAssetId
      );
      if (edge === undefined) break;
      const ids = [edge.sourceAssetId, edge.targetAssetId].sort();
      transformations.push({
        ordinal,
        kind:
          scenario.lineageGraph.assets.find(({ assetId }) => assetId === edge.targetAssetId)!
            .assetType === 'current_pick_entitlement'
            ? ('renumbered' as const)
            : ('selected_player' as const),
        fromAssetIds: [edge.sourceAssetId],
        toAssetIds: [edge.targetAssetId],
        effectiveAt: edge.effectiveAt,
        economicAllocationDecisionId: null,
        assetLabels: ids.map((assetId) => ({
          assetId,
          displayLabel: lineageLabel(assetId, rootAssetId),
        })),
        evidenceRef: artifact(`lineage-${edge.edgeId}`),
      });
      sourceAssetId = edge.targetAssetId;
    }
    return transformations;
  };
  const trace = createGovernedPrivateEvaluationInputTrace({
    schemaVersion: 'private-evaluation-input-trace/v1',
    environment: 'non_production',
    selector: {
      valuationScopeKey: 'afl-men:authenticated-contract-fixture',
      tradeId: definition.tradeId,
    },
    factualReleaseId: addressed('outcome-release', 'authenticated-calculation'),
    valuationInputBundleId,
    components: traceComponents,
    transaction: {
      effectiveAt: definition.effectiveAt,
      clubs: definition.parties,
      transfers: definition.transfers.map((transfer) => ({
        transferId: transfer.transferId,
        assetId: transfer.assetId,
        assetKind:
          transfer.assetKind === 'current_pick'
            ? ('current_pick_entitlement' as const)
            : ('future_pick_entitlement' as const),
        fromClubId: transfer.fromClubId,
        toClubId: transfer.toClubId,
        displayLabel: transfer.displayLabel,
        evidenceRef: artifact(transfer.transferId),
      })),
    },
    seasonUniverse: [
      {
        season: 2024,
        status: 'complete',
        startsAt: '2024-03-01T00:00:00.000Z',
        endsAt: '2024-09-30T23:59:59.999Z',
        evidenceRef: artifact('season-2024'),
      },
      {
        season: 2025,
        status: 'complete',
        startsAt: '2025-03-01T00:00:00.000Z',
        endsAt: '2025-09-30T23:59:59.999Z',
        evidenceRef: artifact('season-2025'),
      },
      {
        season: 2026,
        status: 'right_censored',
        startsAt: '2026-03-01T00:00:00.000Z',
        endsAt: '2026-09-30T00:00:00.000Z',
        evidenceRef: artifact('season-2026'),
      },
    ],
    playerHorizons: [],
    pickLineages: definition.transfers.map((transfer) => ({
      rootAssetId: transfer.assetId,
      pickIdentityId: `pick-identity:${transfer.assetId.split(':')[1]}`,
      pickIdentityLabel: transfer.displayLabel,
      receivingClubId: transfer.toClubId,
      pickObservationSetId: pickBenchmark.content.observationSetId,
      pickModelExecutionId: addressed('pick-pav-model-execution', transfer.assetId),
      pickBenchmarkId: pickBenchmark.benchmarkId,
      pickBenchmarkArtifact,
      resolvedSelectionNumber: selectionByAssetId.get(transfer.assetId)!,
      custody: [
        {
          ordinal: 0,
          clubId: transfer.toClubId,
          clubName: definition.parties.find(({ aflClubId }) => aflClubId === transfer.toClubId)!
            .clubName,
          heldFrom: definition.effectiveAt,
          heldThrough: null,
          evidenceRef: artifact(`custody-${transfer.assetId}`),
        },
      ],
      transformations: transformationsFor(transfer.assetId),
    })),
    derivedAt: DERIVED_AT,
    publicationEligible: false,
    limitation:
      'Authenticated calculation-input trace only; contains no caller-supplied values, grades, publication approval, or activation authority.',
  });
  const explanationPolicy = createGovernedPrivateEvaluationExplanationPolicy({
    schemaVersion: 'private-evaluation-explanation-policy/v1',
    environment: 'non_production',
    valueUnitId: valuationCase.content.valueUnitId,
    selectedLayer: 'scarcityAdjusted',
    practicalEquivalence: {
      basis: `absolute club package net difference in ${valuationCase.content.valueUnitId}`,
      bandByView: [
        { view: 'at_trade', maximumDifference: 0 },
        { view: 'realized', maximumDifference: 0 },
        { view: 'remaining', maximumDifference: 0 },
        { view: 'current', maximumDifference: 0 },
      ],
    },
    createdAt: CREATED_AT,
    publicationEligible: false,
    limitation:
      'Private calculation explanation policy only; not model, grade, publication, or activation authority.',
  });
  const calculationInputPackage = createAflTradeValuationCalculationInputPackage({
    schemaVersion: 'afl-trade-valuation-calculation-input-package/v2',
    authority: {
      kind: 'authenticated_non_production',
      inputTraceId: trace.inputTraceId,
      publicationProhibited: true,
    },
    tradeId: definition.tradeId,
    valuationInputBundleId,
    valuationCase,
    componentDrawSet,
    realizedContributionLedger,
    packagePolicy,
    createdAt: DERIVED_AT,
    publicationEligible: false,
    limitation:
      'Calculation input only; not a result, model approval, publication approval, or activation authority.',
  });
  const materializationManifest = createGovernedPrivateEvaluationMaterializationManifest({
    schemaVersion: 'private-evaluation-materialization-manifest/v1',
    environment: 'non_production',
    selector: trace.content.selector,
    calculationInputPackageId: calculationInputPackage.calculationInputPackageId,
    calculationInputArtifact: createAflTradeCanonicalJsonArtifactRef(
      calculationInputPackage,
      DERIVED_AT
    ),
    inputTraceId: trace.inputTraceId,
    inputTraceArtifact: createAflTradeCanonicalJsonArtifactRef(trace, DERIVED_AT),
    explanationPolicyId: explanationPolicy.policyId,
    explanationPolicyArtifact: createAflTradeCanonicalJsonArtifactRef(
      explanationPolicy,
      CREATED_AT
    ),
    lineageGraphId: createAflTradeLineageGraphId(scenario.lineageGraph),
    lineageGraphArtifact: createAflTradeCanonicalJsonArtifactRef(
      scenario.lineageGraph,
      DERIVED_AT
    ),
    pickBenchmarks: [
      { benchmarkId: pickBenchmark.benchmarkId, artifact: pickBenchmarkArtifact },
    ],
    playerObservations: [],
    createdAt: DERIVED_AT,
    publicationEligible: false,
    limitation:
      'Private materialization inputs only; not model, grade, activation, production, or publication authority.',
  });
  return {
    trace,
    explanationPolicy,
    calculationInputPackage,
    pickBenchmarks: [pickBenchmark],
    lineageGraph: scenario.lineageGraph,
    materializationManifest,
  };
}
