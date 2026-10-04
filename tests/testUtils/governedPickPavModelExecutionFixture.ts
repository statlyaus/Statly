import { createHash } from 'node:crypto';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createGovernedAflTradePickPavModelExecution } from '@/server/aflTradeIntelligence/modeling/governedPickPavModelExecution';
import { createAflTradePickPavPolicy } from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';
import { computeAflTradePickPavModelExecutionOutputs } from '@/server/aflTradeIntelligence/modeling/pickPavModelExecution';
import { materializeAflTradePickPavObservationSet } from '@/server/aflTradeIntelligence/modeling/pickPavObservationService';

const RETAINED_AT = '2015-01-03T00:00:00.000Z';
const COMPLETED_AT = '2015-01-03T00:00:01.000Z';
const years = [2000, 2001, 2002, 2003, 2006, 2009, 2012] as const;

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) =>
  createAflTradeContentAddress(prefix, { fixture: value });
const decision = (value: string) => ({
  id: `review-decision:${sha(value)}`,
  sha256: sha(value),
});

function createObservationSet() {
  const releaseId = addressed('outcome-release', 'governed-pick-execution-release');
  const methodId = addressed('hpn-pav-method', 'governed-pick-execution-method');
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
    approvalDecision: decision('governed-pick-execution-policy'),
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
      decision: decision(`access:${draftYear}`),
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

export function createGovernedPickPavModelExecutionFixture() {
  const observationSet = createObservationSet();
  const datasetId = addressed('dataset', 'governed-pick-dataset');
  const datasetAdmissionId = addressed(
    'dataset-admission',
    'governed-pick-dataset-admission'
  );
  const datasetDocument = {
    content: { factualParent: { factualReleaseId: observationSet.content.releaseId } },
  } as const;
  const datasetAdmissionDocument = {
    content: { factualReleaseId: observationSet.content.releaseId },
  } as const;
  const protocolContent = {
    environment: 'non_production',
    datasetId,
    datasetAdmission: { admissionId: datasetAdmissionId },
  } as const;
  const protocolId = createAflTradeContentAddress('model-protocol', protocolContent);
  const protocolDocument = { protocolId, content: protocolContent } as const;
  const execution = createGovernedAflTradePickPavModelExecution({
    outputs: computeAflTradePickPavModelExecutionOutputs({
      observationSet,
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
        evaluatedAt: RETAINED_AT,
        minimumEligibleObservations: 3,
        minimumPartitionObservations: 1,
        nominalIntervalCoverage: 0.8,
      },
    }),
    completedAt: COMPLETED_AT,
    authority: {
      datasetId,
      datasetArtifact: createAflTradeCanonicalJsonArtifactRef(
        datasetDocument,
        RETAINED_AT
      ),
      datasetAdmissionId,
      datasetAdmissionArtifact: createAflTradeCanonicalJsonArtifactRef(
        datasetAdmissionDocument,
        RETAINED_AT
      ),
      datasetAdmissionGateLedgerRevision: 7,
      protocolId,
      protocolArtifact: createAflTradeCanonicalJsonArtifactRef(
        protocolDocument,
        RETAINED_AT
      ),
    },
  });
  return {
    execution,
    authorityDocuments: [datasetDocument, datasetAdmissionDocument, protocolDocument],
  };
}
