// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  createAflTradeDevelopmentGradeDataset,
  eligibleAflTradeHistoricalOutcomes,
} from '@/server/aflTradeIntelligence/modeling/developmentTradeGradeDataset';

const PROVIDERS = ['afl_tables', 'footywire', 'fryzigg'] as const;

function acquisition(overrides: Record<string, unknown> = {}) {
  return {
    acquisitionId: 'acquisition:alpha:2018',
    effectiveAt: '2018-11-22T00:00:00.000Z',
    outcomeMaturedAt: '2021-10-01T00:00:00.000Z',
    outcomeObservedAt: '2026-08-07T00:00:00.000Z',
    seasonYear: 2018,
    mechanism: 'national_draft',
    receivingClubId: 'afl-club:alpha',
    player: {
      identityState: 'resolved',
      playerId: 'afl-player:alpha',
      playerName: 'Alpha Player',
    },
    selection: {
      nominalNumber: 12,
      actualNumber: 12,
      round: 1,
      originalClubId: null,
    },
    atTrade: { age: 18, heightCm: 188, weightKg: 82 },
    outcome: {
      games: { state: 'observed', value: 80 },
      goals: { state: 'observed', value: 25 },
      coachesVotes: { state: 'observed', value: 18 },
      brownlowVotes: { state: 'observed', value: 7 },
    },
    ...overrides,
  };
}

function providerSeason(overrides: Record<string, unknown> = {}) {
  return {
    observationId: 'provider-season:alpha:2017',
    playerId: 'afl-player:alpha',
    seasonYear: 2017,
    knownAt: '2017-10-01T00:00:00.000Z',
    state: 'reconciled',
    sourceProviders: [...PROVIDERS],
    stats: {
      games: 20,
      goals: 8,
      coachesVotes: 4,
      brownlowVotes: 1,
    },
    ...overrides,
  };
}

function datasetInput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'afl-trade-development-grade-dataset-input/v1',
    environment: 'test_fixture',
    createdAt: '2026-08-08T00:00:00.000Z',
    sourceBoundary: 'pinned_workbook_and_reconciled_fitzroy_no_fantasy_ownership',
    fixedOutcomeHorizonSeasons: 3,
    acquisitions: [acquisition()],
    providerSeasons: [providerSeason()],
    ...overrides,
  };
}

describe('development AFL trade grading dataset', () => {
  it('uses only provider observations known before the acquisition cutoff', () => {
    const dataset = createAflTradeDevelopmentGradeDataset(
      datasetInput({
        providerSeasons: [
          providerSeason(),
          providerSeason({
            observationId: 'provider-season:alpha:2018',
            seasonYear: 2018,
            knownAt: '2018-12-01T00:00:00.000Z',
            stats: { games: 22, goals: 9, coachesVotes: 5, brownlowVotes: 2 },
          }),
        ],
      })
    );

    expect(dataset.content.rows[0]?.atTradeProviderObservationIds).toEqual([
      'provider-season:alpha:2017',
    ]);
  });

  it('exposes historical outcomes only after their fixed horizon matured', () => {
    const dataset = createAflTradeDevelopmentGradeDataset(
      datasetInput({
        acquisitions: [
          acquisition(),
          acquisition({
            acquisitionId: 'acquisition:beta:2019',
            effectiveAt: '2019-11-20T00:00:00.000Z',
            outcomeMaturedAt: '2022-10-01T00:00:00.000Z',
            seasonYear: 2019,
            player: {
              identityState: 'resolved',
              playerId: 'afl-player:beta',
              playerName: 'Beta Player',
            },
          }),
        ],
      })
    );

    expect(
      eligibleAflTradeHistoricalOutcomes(dataset, '2022-01-01T00:00:00.000Z').map(
        ({ acquisitionId }) => acquisitionId
      )
    ).toEqual(['acquisition:alpha:2018']);
  });

  it('keeps true zero distinct from unavailable and partial observations', () => {
    const dataset = createAflTradeDevelopmentGradeDataset(
      datasetInput({
        acquisitions: [
          acquisition({
            outcome: {
              games: { state: 'observed', value: 0 },
              goals: { state: 'observed', value: 0 },
              coachesVotes: { state: 'unavailable', reason: 'source_missing' },
              brownlowVotes: {
                state: 'partial',
                observedValue: 0,
                reason: 'active_career_right_censored',
              },
            },
          }),
        ],
      })
    );

    expect(dataset.content.rows[0]?.outcome).toEqual({
      games: { state: 'observed', value: 0 },
      goals: { state: 'observed', value: 0 },
      coachesVotes: { state: 'unavailable', reason: 'source_missing' },
      brownlowVotes: {
        state: 'partial',
        observedValue: 0,
        reason: 'active_career_right_censored',
      },
    });
  });

  it('admits a right-censored recent outcome before maturity without using it as history', () => {
    const dataset = createAflTradeDevelopmentGradeDataset(
      datasetInput({
        acquisitions: [
          acquisition({
            acquisitionId: 'acquisition:alpha:2025',
            effectiveAt: '2025-10-15T00:00:00.000Z',
            outcomeMaturedAt: '2028-10-01T00:00:00.000Z',
            outcomeObservedAt: '2026-08-07T00:00:00.000Z',
            seasonYear: 2025,
            outcome: {
              games: {
                state: 'partial',
                observedValue: 8,
                reason: 'active_career_right_censored',
              },
              goals: {
                state: 'partial',
                observedValue: 2,
                reason: 'active_career_right_censored',
              },
              coachesVotes: {
                state: 'partial',
                observedValue: 0,
                reason: 'active_career_right_censored',
              },
              brownlowVotes: {
                state: 'partial',
                observedValue: 0,
                reason: 'active_career_right_censored',
              },
            },
          }),
        ],
      })
    );

    expect(dataset.content.rows[0]?.outcome.games.state).toBe('partial');
    expect(eligibleAflTradeHistoricalOutcomes(dataset, '2027-01-01T00:00:00.000Z')).toEqual([]);
  });

  it('does not promote conflicted provider observations into at-trade features', () => {
    const dataset = createAflTradeDevelopmentGradeDataset(
      datasetInput({
        providerSeasons: [providerSeason({ state: 'conflicting' })],
      })
    );

    expect(dataset.content.rows[0]?.atTradeProviderObservationIds).toEqual([]);
    expect(dataset.content.rows[0]?.eligibility).toEqual({
      state: 'insufficient_data',
      reasons: ['no_reconciled_pretrade_provider_history'],
    });
  });

  it('fails closed when the canonical player identity is unresolved', () => {
    const dataset = createAflTradeDevelopmentGradeDataset(
      datasetInput({
        acquisitions: [
          acquisition({
            player: {
              identityState: 'unresolved',
              playerId: null,
              playerName: 'Ambiguous Player',
            },
          }),
        ],
      })
    );

    expect(dataset.content.rows[0]?.eligibility).toEqual({
      state: 'identity_unresolved',
      reasons: ['canonical_player_identity_unresolved'],
    });
  });

  it('records exact contributing providers without claiming a missing provider contributed', () => {
    const dataset = createAflTradeDevelopmentGradeDataset(
      datasetInput({
        providerSeasons: [providerSeason({ sourceProviders: ['afl_tables', 'footywire'] })],
      })
    );

    expect(dataset.content.contributingProviders).toEqual(['afl_tables', 'footywire']);
  });

  it('rejects source-recorded grade and old expected/actual fields at admission', () => {
    const contaminated = acquisition({ grade: 'A+', expected: 92, actual: 97 });

    expect(() =>
      createAflTradeDevelopmentGradeDataset(datasetInput({ acquisitions: [contaminated] }))
    ).toThrow();
  });

  it('is content addressed and stable under input ordering', () => {
    const alpha = acquisition();
    const beta = acquisition({
      acquisitionId: 'acquisition:beta:2017',
      effectiveAt: '2017-11-20T00:00:00.000Z',
      outcomeMaturedAt: '2020-10-01T00:00:00.000Z',
      seasonYear: 2017,
      player: {
        identityState: 'resolved',
        playerId: 'afl-player:beta',
        playerName: 'Beta Player',
      },
    });
    const first = createAflTradeDevelopmentGradeDataset(
      datasetInput({ acquisitions: [alpha, beta] })
    );
    const second = createAflTradeDevelopmentGradeDataset(
      datasetInput({ acquisitions: [beta, alpha] })
    );

    expect(first.datasetId).toBe(second.datasetId);
    expect(first.content.rows.map(({ acquisitionId }) => acquisitionId)).toEqual([
      'acquisition:beta:2017',
      'acquisition:alpha:2018',
    ]);
  });
});
