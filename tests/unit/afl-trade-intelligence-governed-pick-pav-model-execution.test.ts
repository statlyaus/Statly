import { createHash } from 'node:crypto';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePickPavPolicy } from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';
import { computeAflTradePickPavModelExecutionOutputs } from '@/server/aflTradeIntelligence/modeling/pickPavModelExecution';
import { materializeAflTradePickPavObservationSet } from '@/server/aflTradeIntelligence/modeling/pickPavObservationService';
import {
  createDispatchBoundGovernedAflTradePickPavModelExecution,
  createGovernedAflTradePickPavModelExecution,
  governedAflTradePickPavModelExecutionSchema,
} from '@/server/aflTradeIntelligence/modeling/governedPickPavModelExecution';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const releaseId = addressed('outcome-release', 'governed-pick-execution-release');
const methodId = addressed('hpn-pav-method', 'governed-pick-execution-method');
const years = [2000, 2001, 2002, 2003, 2006, 2009, 2012] as const;

function observationSet() {
  const policy = createAflTradePickPavPolicy({
    schemaVersion: 'afl-trade-pick-pav-policy/v1',
    authorityBoundary:
      'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'non_production',
    competition: 'AFLM',
    policyVersion: 'governed-pick-execution-v1',
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
      id: addressed('review-decision', 'governed-pick-execution-policy'),
      sha256: sha('governed-pick-execution-policy'),
    },
    createdAt: '1999-01-01T00:00:00.000Z',
  });
  const selections = years.map((draftYear, index) => ({
    releaseId,
    selectionId: addressed('draft-selection', `${draftYear}:${index}`),
    eventId: `draft:${draftYear}:national`,
    eventVersionId: addressed('event-version', `draft:${draftYear}:national`),
    eventDate: `${draftYear}-11-20`,
    recordedAt: `${draftYear}-11-21T00:00:00.000Z`,
    draftYear,
    pathway: 'national' as const,
    actualSelectionNumber: index < 4 ? [10, 14, 14, 20][index]! : 14,
    nominalSelectionNumber: index < 4 ? [10, 14, 14, 20][index]! : 14,
    draftRound: 1,
    pickId: `pick:${draftYear}:national:${index + 1}`,
    playerId: `player:${draftYear}`,
    clubId: `club:${draftYear}`,
    access: {
      state: 'open' as const,
      decision: {
        id: addressed('review-decision', `access:${draftYear}`),
        sha256: sha(`access:${draftYear}`),
      },
      recordedAt: `${draftYear}-11-22T00:00:00.000Z`,
    },
  }));
  const calculations = years.map((draftYear, index) => {
    const seasonYear = draftYear + 1;
    const calculationSha256 = sha(`calculation:${draftYear}`);
    const sourceRowIds = Array.from(
      { length: 10 },
      (_, rowIndex) => `decoded-row:${draftYear}:${rowIndex + 1}`
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
          totalPav: [100, 60, 80, 20, 70, 65, 75][index]!,
        },
      ],
    };
  });
  return materializeAflTradePickPavObservationSet({
    environment: 'non_production',
    competition: 'AFLM',
    createdAt: '2015-01-02T00:00:00.000Z',
    knowledgeCutoffAt: '2015-01-01T00:00:00.000Z',
    releaseId,
    policy,
    selections,
    calculations,
  });
}

describe('governed pick-PAV model execution', () => {
  it('creates a non-production Gate 3 candidate bound to admitted dataset authority', () => {
    const set = observationSet();
    const retainedAt = '2015-01-03T00:00:00.000Z';
    const datasetId = addressed('dataset', 'governed-pick-dataset');
    const datasetAdmissionId = addressed('dataset-admission', 'governed-pick-dataset-admission');
    const protocolId = addressed('model-protocol', 'governed-pick-protocol');
    const outputs = computeAflTradePickPavModelExecutionOutputs({
      observationSet: set,
      benchmarkConfig: {
        schemaVersion: 'afl-trade-pick-pav-distribution-benchmark-config/v1',
        minimumBlockObservations: 1,
        eligibility: 'mature_open_access_national_draft_training_observations',
        informationWeight: 'eligible_selection_count',
        smoother: 'weighted_non_increasing_isotonic',
        sparseBlockMergePolicy: 'nearest_adjacent_fitted_mean_left_tie_break',
        interpolation: 'left_block_carry_forward_within_training_domain',
        extrapolation: 'prohibited',
        estimatorStatus: 'benchmark_only_requires_temporal_validation_and_approval',
      },
      validationConfig: {
        schemaVersion: 'afl-trade-pick-pav-validation-config/v1',
        evaluatedAt: retainedAt,
        minimumEligibleObservations: 3,
        minimumPartitionObservations: 1,
        nominalIntervalCoverage: 0.8,
      },
    });
    const execution = createGovernedAflTradePickPavModelExecution({
      outputs,
      completedAt: '2015-01-03T00:00:01.000Z',
      authority: {
        datasetId,
        datasetArtifact: createAflTradeCanonicalJsonArtifactRef(
          { kind: 'dataset', datasetId },
          retainedAt
        ),
        datasetAdmissionId,
        datasetAdmissionArtifact: createAflTradeCanonicalJsonArtifactRef(
          { kind: 'dataset_admission', datasetAdmissionId },
          retainedAt
        ),
        datasetAdmissionGateLedgerRevision: 7,
        protocolId,
        protocolArtifact: createAflTradeCanonicalJsonArtifactRef(
          { kind: 'pick_protocol', protocolId },
          retainedAt
        ),
      },
    });

    expect(execution.content).toMatchObject({
      schemaVersion: 'afl-trade-pick-pav-model-execution/v3',
      environment: 'non_production',
      qualificationStatus: 'automated_qualification_pending',
      publicationEligible: false,
      datasetId,
      datasetAdmissionId,
      datasetAdmissionGateLedgerRevision: 7,
      protocolId,
    });
    expect(execution.content).not.toHaveProperty('grade');

    const dispatchExecution = createDispatchBoundGovernedAflTradePickPavModelExecution({
      outputs,
      completedAt: '2015-01-03T00:00:01.000Z',
      authority: {
        datasetId,
        datasetArtifact: execution.content.datasetArtifact,
        datasetAdmissionId,
        datasetAdmissionArtifact: execution.content.datasetAdmissionArtifact,
        datasetAdmissionGateLedgerRevision: 7,
        protocolId,
        protocolArtifact: execution.content.protocolArtifact,
      },
      privateInput: {
        requestId: addressed('private-valuation-dispatch', 'request'),
        operationId: addressed('private-valuation-model-operation', 'operation'),
        claimId: addressed('private-valuation-dispatch-claim', 'claim'),
        attemptNumber: 2,
        leaseTokenSha256: sha('lease'),
        factualOutputId: addressed('private-valuation-factual-output', 'factual'),
        hpnCalculationId: addressed('hpn-pav-season', 'calculation'),
        factualValuesSha256: sha('factual-values'),
        hpnValuesSha256: sha('hpn-values'),
      },
    });
    expect(dispatchExecution.content).toMatchObject({
      schemaVersion: 'afl-trade-pick-pav-model-execution/v4',
      privateInput: { attemptNumber: 2 },
    });

    if (execution.content.schemaVersion !== 'afl-trade-pick-pav-model-execution/v3') {
      throw new Error('Expected a successor governed pick-PAV execution.');
    }
    const { qualificationStatus: _qualificationStatus, ...successorWithoutQualificationStatus } =
      execution.content;
    const legacyContent = {
      ...successorWithoutQualificationStatus,
      schemaVersion: 'afl-trade-pick-pav-model-execution/v2' as const,
      authorityBoundary:
        'authenticated_non_production_pick_model_candidate_no_gate_3_approval_grade_publication_or_fantasy_ownership' as const,
      approvalStatus: 'gate_3_review_required' as const,
      limitation:
        'This retained non-production execution is eligible for independent Gate 3 review only; it is not an approval, trade grade, or public numerical authority.' as const,
    };
    const legacy = governedAflTradePickPavModelExecutionSchema.parse({
      executionId: createAflTradeContentAddress('pick-pav-model-execution', legacyContent),
      content: legacyContent,
    });
    expect(legacy.content).toMatchObject({
      schemaVersion: 'afl-trade-pick-pav-model-execution/v2',
      approvalStatus: 'gate_3_review_required',
    });
    expect(legacy.content).not.toHaveProperty('qualificationStatus');
  });
});
