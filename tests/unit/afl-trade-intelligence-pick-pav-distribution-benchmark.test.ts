import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createAflTradePickPavPolicy } from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';
import {
  aflTradePickPavDistributionBenchmarkSchema,
  fitAflTradePickPavDistributionBenchmark,
} from '@/server/aflTradeIntelligence/modeling/pickPavDistributionBenchmark';
import { materializeAflTradePickPavObservationSet } from '@/server/aflTradeIntelligence/modeling/pickPavObservationService';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const releaseId = addressed('outcome-release', 'benchmark-release');
const methodId = addressed('hpn-pav-method', 'benchmark-method');
const years = [2000, 2001, 2002, 2003, 2006, 2009, 2012] as const;
const selectionByYear = new Map<number, number>([
  [2000, 10],
  [2001, 14],
  [2002, 14],
  [2003, 20],
  [2006, 8],
  [2009, 14],
  [2012, 25],
]);
const contributionByYear = new Map<number, number>([
  [2000, 100],
  [2001, 60],
  [2002, 80],
  [2003, 20],
  [2006, 90],
  [2009, 50],
  [2012, 10],
]);

function policy() {
  return createAflTradePickPavPolicy({
    schemaVersion: 'afl-trade-pick-pav-policy/v1',
    authorityBoundary:
      'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    policyVersion: 'benchmark-v1',
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
      id: addressed('review-decision', 'benchmark-policy'),
      sha256: sha('benchmark-policy'),
    },
    createdAt: '1999-01-01T00:00:00.000Z',
  });
}

function selection(draftYear: number) {
  const selectionNumber = selectionByYear.get(draftYear)!;
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
        id: addressed('review-decision', `access:${draftYear}`),
        sha256: sha(`access:${draftYear}`),
      },
      recordedAt: `${draftYear}-11-22T00:00:00.000Z`,
    },
  };
}

function calculation(draftYear: number) {
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
        totalPav: contributionByYear.get(draftYear)!,
      },
    ],
  };
}

function observationSet(reverse = false) {
  const orderedYears = reverse ? [...years].reverse() : [...years];
  return materializeAflTradePickPavObservationSet({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2015-01-02T00:00:00.000Z',
    knowledgeCutoffAt: '2015-01-01T00:00:00.000Z',
    releaseId,
    policy: policy(),
    selections: orderedYears.map(selection),
    calculations: orderedYears.map(calculation),
  });
}

const config = {
  schemaVersion: 'afl-trade-pick-pav-distribution-benchmark-config/v1' as const,
  minimumBlockObservations: 1,
  eligibility: 'mature_open_access_national_draft_training_observations' as const,
  informationWeight: 'eligible_selection_count' as const,
  smoother: 'weighted_non_increasing_isotonic' as const,
  sparseBlockMergePolicy: 'nearest_adjacent_fitted_mean_left_tie_break' as const,
  interpolation: 'left_block_carry_forward_within_training_domain' as const,
  extrapolation: 'prohibited' as const,
  estimatorStatus: 'benchmark_only_requires_temporal_validation_and_approval' as const,
};

describe('exact-pick PAV distribution benchmark', () => {
  it('gives pick 14 its exact empirical distribution rather than a draft bucket', () => {
    const benchmark = fitAflTradePickPavDistributionBenchmark(observationSet(), config);
    const pick14 = benchmark.content.selectionCurve.find(
      ({ selectionNumber }) => selectionNumber === 14
    );

    expect(pick14?.observationCount).toBe(2);
    expect(pick14?.distribution).toMatchObject({
      expectedContribution: 70,
      p10Contribution: 60,
      p50Contribution: 60,
      p90Contribution: 80,
      expectedGames: 10,
    });
    expect(benchmark.content.selectionCurve.some(({ selectionNumber }) => selectionNumber === 9)).toBe(
      false
    );
    expect(
      benchmark.content.selectionCurve.some(({ selectionNumber }) => selectionNumber === 21)
    ).toBe(false);
  });

  it('is monotone, excludes every held-out cohort, and is input-order deterministic', () => {
    const forward = fitAflTradePickPavDistributionBenchmark(observationSet(), config);
    const reverse = fitAflTradePickPavDistributionBenchmark(observationSet(true), config);
    const expected = forward.content.selectionCurve.map(
      ({ distribution }) => distribution.expectedContribution
    );

    expect(expected.every((value, index) => index === 0 || value <= expected[index - 1]!)).toBe(
      true
    );
    expect(forward.content.trainingObservationIds).toHaveLength(4);
    expect(forward.content.excludedObservations).toHaveLength(3);
    expect(new Set(forward.content.excludedObservations.map(({ reason }) => reason))).toEqual(
      new Set(['held_out_partition'])
    );
    expect(reverse).toEqual(forward);
  });

  it('rejects a same-shape curve whose empirical distribution was substituted', () => {
    const benchmark = fitAflTradePickPavDistributionBenchmark(observationSet(), config);
    const tampered = structuredClone(benchmark);
    tampered.content.selectionCurve[0]!.distribution.expectedContribution += 1;

    expect(() => aflTradePickPavDistributionBenchmarkSchema.parse(tampered)).toThrow(
      /exact fitted empirical distribution|content-address/i
    );
  });
});
