import { describe, expect, it } from 'vitest';

import {
  LocalPlayerMetricConservationError,
  conserveLocalPlayerMatchMetrics,
} from '@/server/aflTradeIntelligence/development/localPlayerMetricConservation';

const match = {
  matchId: 'local-afl-match:reviewed-match',
  matchCompletionSourceFactId: 'local-fact:match-completed',
  seasonYear: 2024,
  matchDate: '2024-05-04',
  scope: 'home_and_away' as const,
  homeClubId: 'afl-club:home',
  awayClubId: 'afl-club:away',
  clubGoalTotals: [
    { clubId: 'afl-club:home', goals: 2, sourceFactId: 'local-fact:score-home' },
    { clubId: 'afl-club:away', goals: 1, sourceFactId: 'local-fact:score-away' },
  ],
  appearances: [
    {
      playerId: 'afl-player:home-one',
      clubId: 'afl-club:home',
      sourceFactId: 'local-fact:appearance-home-one',
    },
    {
      playerId: 'afl-player:home-two',
      clubId: 'afl-club:home',
      sourceFactId: 'local-fact:appearance-home-two',
    },
    {
      playerId: 'afl-player:away-one',
      clubId: 'afl-club:away',
      sourceFactId: 'local-fact:appearance-away-one',
    },
    {
      playerId: 'afl-player:away-two',
      clubId: 'afl-club:away',
      sourceFactId: 'local-fact:appearance-away-two',
    },
  ],
  positiveMetrics: [
    {
      playerId: 'afl-player:home-one',
      clubId: 'afl-club:home',
      metricCode: 'goals' as const,
      value: 2,
      sourceFactId: 'local-fact:goal-home-one',
    },
    {
      playerId: 'afl-player:away-one',
      clubId: 'afl-club:away',
      metricCode: 'goals' as const,
      value: 1,
      sourceFactId: 'local-fact:goal-away-one',
    },
    {
      playerId: 'afl-player:home-one',
      clubId: 'afl-club:home',
      metricCode: 'brownlow_votes' as const,
      value: 3,
      sourceFactId: 'local-fact:brownlow-home-one',
    },
    {
      playerId: 'afl-player:away-one',
      clubId: 'afl-club:away',
      metricCode: 'brownlow_votes' as const,
      value: 2,
      sourceFactId: 'local-fact:brownlow-away-one',
    },
    {
      playerId: 'afl-player:home-two',
      clubId: 'afl-club:home',
      metricCode: 'brownlow_votes' as const,
      value: 1,
      sourceFactId: 'local-fact:brownlow-home-two',
    },
    {
      playerId: 'afl-player:home-one',
      clubId: 'afl-club:home',
      metricCode: 'coaches_votes' as const,
      value: 10,
      sourceFactId: 'local-fact:coaches-home-one',
    },
    {
      playerId: 'afl-player:away-one',
      clubId: 'afl-club:away',
      metricCode: 'coaches_votes' as const,
      value: 8,
      sourceFactId: 'local-fact:coaches-away-one',
    },
    {
      playerId: 'afl-player:home-two',
      clubId: 'afl-club:home',
      metricCode: 'coaches_votes' as const,
      value: 7,
      sourceFactId: 'local-fact:coaches-home-two',
    },
    {
      playerId: 'afl-player:away-two',
      clubId: 'afl-club:away',
      metricCode: 'coaches_votes' as const,
      value: 5,
      sourceFactId: 'local-fact:coaches-away-two',
    },
  ],
};

describe('local player metric conservation', () => {
  it('derives measured zeros only after every match total conserves', () => {
    const result = conserveLocalPlayerMatchMetrics(match);

    expect(result.policyVersion).toBe('local-genuine-player-match-conservation/v1');
    expect(result.rows).toEqual([
      expect.objectContaining({
        playerId: 'afl-player:away-one',
        metrics: { games: 1, goals: 1, brownlow_votes: 2, coaches_votes: 8 },
      }),
      expect.objectContaining({
        playerId: 'afl-player:away-two',
        metrics: { games: 1, goals: 0, brownlow_votes: 0, coaches_votes: 5 },
      }),
      expect.objectContaining({
        playerId: 'afl-player:home-one',
        metrics: { games: 1, goals: 2, brownlow_votes: 3, coaches_votes: 10 },
      }),
      expect.objectContaining({
        playerId: 'afl-player:home-two',
        metrics: { games: 1, goals: 0, brownlow_votes: 1, coaches_votes: 7 },
      }),
    ]);
    expect(result.rows[1]?.provenance.goals).toEqual({
      kind: 'conservation_derived_zero',
      sourceFactIds: expect.arrayContaining([
        'local-fact:appearance-away-two',
        'local-fact:match-completed',
        'local-fact:score-away',
        'local-fact:goal-away-one',
      ]),
    });
    expect(result.rows[1]?.provenance.brownlow_votes).toEqual({
      kind: 'conservation_derived_zero',
      sourceFactIds: expect.arrayContaining([
        'local-fact:brownlow-away-one',
        'local-fact:brownlow-home-one',
        'local-fact:brownlow-home-two',
      ]),
    });
    expect(result.rows[1]?.provenance.games.sourceFactIds).toEqual([
      'local-fact:appearance-away-two',
      'local-fact:match-completed',
    ]);
    expect(result.rows[1]?.provenance.coaches_votes).toEqual({
      kind: 'measured_positive',
      sourceFactIds: ['local-fact:coaches-away-two'],
    });
    expect(result.conservationSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(conserveLocalPlayerMatchMetrics(match)).toEqual(result);
  });

  it('derives a selected-player zero from a conserved positive-row preimage without resolving other recipients', () => {
    const selectedPlayerId = 'afl-player:away-two';
    const unresolvedPositiveMetrics = match.positiveMetrics.map((metric, index) => ({
      ...metric,
      playerId: null,
      sourceIdentityId: `afl-tables-player-row:${index}`,
    }));
    const result = conserveLocalPlayerMatchMetrics({
      ...match,
      appearances: match.appearances.filter(({ playerId }) => playerId === selectedPlayerId),
      positiveMetrics: unresolvedPositiveMetrics,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      playerId: selectedPlayerId,
      metrics: { games: 1, goals: 0, brownlow_votes: 0, coaches_votes: 0 },
    });
    expect(result.rows[0]?.provenance.coaches_votes.sourceFactIds).toContain(
      'local-fact:coaches-home-one'
    );
  });

  it('rejects an incomplete unresolved positive-row preimage', () => {
    expect(() =>
      conserveLocalPlayerMatchMetrics({
        ...match,
        appearances: match.appearances.slice(-1),
        positiveMetrics: match.positiveMetrics
          .filter(({ sourceFactId }) => sourceFactId !== 'local-fact:coaches-away-two')
          .map((metric, index) => ({
            ...metric,
            playerId: null,
            sourceIdentityId: `afl-tables-player-row:${index}`,
          })),
      })
    ).toThrowError(
      expect.objectContaining<Partial<LocalPlayerMetricConservationError>>({
        code: 'COACHES_TOTAL_MISMATCH',
      })
    );
  });

  it('rejects unresolved positive rows without a source-native identity', () => {
    expect(() =>
      conserveLocalPlayerMatchMetrics({
        ...match,
        positiveMetrics: [{ ...match.positiveMetrics[0]!, playerId: null }],
      })
    ).toThrowError(
      expect.objectContaining<Partial<LocalPlayerMetricConservationError>>({
        code: 'INVALID_MATCH_EVIDENCE',
      })
    );
  });

  it.each([
    {
      name: 'club goals',
      mutate: () => ({
        ...match,
        clubGoalTotals: [
          { clubId: 'afl-club:home', goals: 3, sourceFactId: 'local-fact:score-home' },
          { clubId: 'afl-club:away', goals: 1, sourceFactId: 'local-fact:score-away' },
        ],
      }),
      code: 'GOAL_TOTAL_MISMATCH',
    },
    {
      name: 'Brownlow votes',
      mutate: () => ({
        ...match,
        positiveMetrics: match.positiveMetrics.filter(
          ({ sourceFactId }) => sourceFactId !== 'local-fact:brownlow-home-two'
        ),
      }),
      code: 'BROWNLOW_TOTAL_MISMATCH',
    },
    {
      name: 'coaches votes',
      mutate: () => ({
        ...match,
        positiveMetrics: match.positiveMetrics.filter(
          ({ sourceFactId }) => sourceFactId !== 'local-fact:coaches-away-two'
        ),
      }),
      code: 'COACHES_TOTAL_MISMATCH',
    },
  ] as const)('fails closed when $name do not conserve', ({ mutate, code }) => {
    expect(() => conserveLocalPlayerMatchMetrics(mutate())).toThrowError(
      expect.objectContaining<Partial<LocalPlayerMetricConservationError>>({ code })
    );
  });

  it('rejects a metric recipient outside the exact reviewed appearance set', () => {
    expect(() =>
      conserveLocalPlayerMatchMetrics({
        ...match,
        positiveMetrics: [
          ...match.positiveMetrics,
          {
            playerId: 'afl-player:unknown',
            clubId: 'afl-club:home',
            metricCode: 'goals',
            value: 1,
            sourceFactId: 'local-fact:unknown-player',
          },
        ],
      })
    ).toThrowError(
      expect.objectContaining<Partial<LocalPlayerMetricConservationError>>({
        code: 'UNKNOWN_METRIC_RECIPIENT',
      })
    );
  });

  it('rejects duplicate player/metric facts rather than summing ambiguous evidence', () => {
    expect(() =>
      conserveLocalPlayerMatchMetrics({
        ...match,
        positiveMetrics: [...match.positiveMetrics, match.positiveMetrics[0]!],
      })
    ).toThrowError(
      expect.objectContaining<Partial<LocalPlayerMetricConservationError>>({
        code: 'DUPLICATE_METRIC_FACT',
      })
    );
  });
});
