import { describe, expect, it } from 'vitest';

import {
  fitAflTradePathwayPickDistributions,
  type AflTradePathwayPickDistributionConfig,
} from '@/server/aflTradeIntelligence/modeling/pathwayPickDistribution';
import {
  createAflTradePickOutcomeObservationSet,
  type AflTradePickOutcomeObservation,
  type AflTradePickOutcomeObservationSetContent,
} from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';

const digest = (character: string) => character.repeat(64);

function observation(
  id: string,
  draftYear: number,
  partition: AflTradePickOutcomeObservation['partition'],
  pathway: AflTradePickOutcomeObservation['selection']['pathway'],
  selectionNumber: number,
  contribution: number
): AflTradePickOutcomeObservation {
  return {
    observationId: `observation-${id}`,
    playerId: `player-${id}`,
    draftClassId: `draft-class-${draftYear}`,
    draftYear,
    partition,
    predictionCutoffAt: `${draftYear}-01-01T00:00:00.000Z`,
    selectionKnownAt: `${draftYear - 1}-12-31T00:00:00.000Z`,
    outcomeHorizonEndsAt: `${draftYear + 2}-12-31T00:00:00.000Z`,
    outcomeObservedAt: `${draftYear + 3}-01-01T00:00:00.000Z`,
    selection: {
      pathway,
      access: 'open',
      nominalSelectionNumber: selectionNumber,
      actualSelectionNumber: selectionNumber,
      bidSelectionNumber: null,
      draftRound: 1,
    },
    era: 'fixture-era',
    playerPosition: 'midfielder',
    ageAtDraft: 18.5,
    evidenceQuality: 'high',
    outcome: {
      state: 'mature_observed',
      contribution,
      gamesPlayed: contribution === 0 ? 0 : 40,
      category: contribution === 0 ? 'no_afl_game' : 'regular_contributor',
    },
  };
}

function content(): AflTradePickOutcomeObservationSetContent {
  return {
    schemaVersion: 'afl-trade-pick-observation-set/v1',
    publicAssetBoundary: 'source_native_afl_draft_selection_no_fantasy_ownership',
    datasetId: `dataset:${digest('1')}`,
    modelProtocolId: `model-protocol:${digest('2')}`,
    valueUnitId: 'statly-fixed-horizon-contribution-v1',
    fixedHorizonSeasons: 2,
    fixedHorizonDefinitionArtifactId: `artifact:${digest('3')}`,
    outcomeDefinitionArtifactId: `artifact:${digest('4')}`,
    curveEligibility: 'open_access_national_draft_actual_selection_only',
    observations: [
      observation('national-1', 1998, 'train', 'national', 1, 100),
      observation('national-2', 1998, 'train', 'national', 2, 80),
      observation('rookie-1', 1998, 'train', 'rookie', 1, 30),
      observation('rookie-2', 1998, 'train', 'rookie', 2, 20),
      observation('midseason-1', 1998, 'train', 'midseason', 1, 12),
      observation('midseason-2', 1998, 'train', 'midseason', 2, 6),
      observation('calibration', 2005, 'calibration', 'national', 1, 1_000),
      observation('validation', 2010, 'validation', 'national', 1, 2_000),
      observation('final-test', 2015, 'final_test', 'national', 1, 3_000),
    ],
  };
}

const config = {
  schemaVersion: 'afl-trade-pathway-pick-distribution-config/v1',
  minimumPathwayObservations: 2,
  minimumBlockObservations: 1,
  extrapolation: 'prohibited',
  estimatorStatus: 'candidate_requires_validation_and_approval',
} as const satisfies AflTradePathwayPickDistributionConfig;

describe('AFL pathway-specific pick distributions', () => {
  it('fits exact-pick curves independently within each draft pathway', () => {
    const fit = fitAflTradePathwayPickDistributions(
      createAflTradePickOutcomeObservationSet(content()),
      config
    );

    const national = fit.content.pathways.find(({ pathway }) => pathway === 'national');
    const rookie = fit.content.pathways.find(({ pathway }) => pathway === 'rookie');
    const midseason = fit.content.pathways.find(({ pathway }) => pathway === 'midseason');

    expect(national).toMatchObject({
      status: 'available',
      curve: [
        { selectionNumber: 1, expectedContribution: 100 },
        { selectionNumber: 2, expectedContribution: 80 },
      ],
    });
    expect(rookie).toMatchObject({
      status: 'available',
      curve: [
        { selectionNumber: 1, expectedContribution: 30 },
        { selectionNumber: 2, expectedContribution: 20 },
      ],
    });
    expect(midseason).toMatchObject({
      status: 'available',
      curve: [
        { selectionNumber: 1, expectedContribution: 12 },
        { selectionNumber: 2, expectedContribution: 6 },
      ],
    });
  });

  it('returns an explicit insufficient-data state instead of borrowing another pathway', () => {
    const fit = fitAflTradePathwayPickDistributions(
      createAflTradePickOutcomeObservationSet(content()),
      config
    );

    expect(fit.content.pathways).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pathway: 'preseason',
          status: 'insufficient_data',
          eligibleObservationCount: 0,
        }),
        expect.objectContaining({
          pathway: 'supplementary',
          status: 'insufficient_data',
          eligibleObservationCount: 0,
        }),
      ])
    );
    expect(fit.content.limitations).toContain(
      'Pathways are never pooled; unsupported selections remain unavailable.'
    );
  });

  it('is order invariant, excludes held-out labels, and never extrapolates', () => {
    const source = content();
    const forward = fitAflTradePathwayPickDistributions(
      createAflTradePickOutcomeObservationSet(source),
      config
    );
    const reversed = fitAflTradePathwayPickDistributions(
      createAflTradePickOutcomeObservationSet({
        ...source,
        observations: [...source.observations].reverse(),
      }),
      config
    );

    expect(forward).toEqual(reversed);
    expect(forward.distributionId).toMatch(/^pathway-pick-distribution:[a-f0-9]{64}$/);
    expect(forward.content.excludedObservations).toEqual(
      expect.arrayContaining([
        { observationId: 'observation-calibration', reason: 'held_out_partition' },
        { observationId: 'observation-validation', reason: 'held_out_partition' },
        { observationId: 'observation-final-test', reason: 'held_out_partition' },
      ])
    );
    const national = forward.content.pathways.find(({ pathway }) => pathway === 'national');
    expect(national).toMatchObject({ minimumSelectionNumber: 1, maximumSelectionNumber: 2 });
    expect(forward.content.publicationEligible).toBe(false);
  });
});
