import { describe, expect, it } from 'vitest';

import {
  CATEGORY_STAT_PATHS,
  LINEUP_SIZES,
  buildHeadToHeadCategoryScores,
  mergeFirestorePlayerMatchStats,
  pickActiveLineup,
} from './leagueMatchup';

describe('leagueMatchup helpers', () => {
  it('mergeFirestorePlayerMatchStats pulls metres gained from raw_row and maps inside_50s', () => {
    const merged = mergeFirestorePlayerMatchStats({
      stats: { kicks: 12 },
      raw_row: { metres_gained: 412, inside_50s: 5 },
    });
    expect(merged.kicks).toBe(12);
    expect(merged.metresGained).toBe(412);
    expect(merged.inside50s).toBe(5);
  });

  it('mergeFirestorePlayerMatchStats coerces numeric strings from Firestore', () => {
    const merged = mergeFirestorePlayerMatchStats({
      stats: { kicks: '18', metres_gained: '428' },
    });
    expect(merged.kicks).toBe(18);
    expect(merged.metresGained).toBe(428);
  });

  it('mergeFirestorePlayerMatchStats prefers canonical_stats over legacy raw fields', () => {
    const merged = mergeFirestorePlayerMatchStats({
      stats: { kicks: 4 },
      raw_row: { kicks: 5, metres_gained: 99 },
      canonical_stats: {
        version: 1,
        source_name: 'fitzroy_merged',
        stats: { kicks: 12, metres_gained: 412 },
        availability: { kicks: true, metres_gained: true },
        provenance: { kicks: 'footywire_match', metres_gained: 'afltables' },
        source_priority: ['fitzroy_merged'],
        raw_source_rows: null,
      },
    });

    expect(merged.kicks).toBe(12);
    expect(merged.metresGained).toBe(412);
  });

  it('uses only starters and interchange for the active scoring lineup', () => {
    const allPlayers = Array.from({ length: 26 }, (_, index) => `ply_${index + 1}`);

    const active = pickActiveLineup(allPlayers);

    expect(active).toHaveLength(LINEUP_SIZES.starters + LINEUP_SIZES.interchange);
    expect(active).toEqual(allPlayers.slice(0, 22));
  });

  it('builds category totals and head-to-head results from selected league settings', () => {
    const matchup = buildHeadToHeadCategoryScores({
      categories: ['goals', 'tackles', 'inside50s'],
      homePlayerIds: ['ply_a', 'ply_b', 'ply_bench'],
      awayPlayerIds: ['ply_c', 'ply_d'],
      activePlayerLimit: 2,
      statsByPlayerId: new Map([
        [
          'ply_a',
          {
            playerId: 'ply_a',
            playerName: 'Player A',
            team: 'AAA',
            stats: {
              [CATEGORY_STAT_PATHS.goals]: 2,
              [CATEGORY_STAT_PATHS.tackles]: 3,
              [CATEGORY_STAT_PATHS.inside50s]: 4,
            },
          },
        ],
        [
          'ply_b',
          {
            playerId: 'ply_b',
            playerName: 'Player B',
            team: 'AAA',
            stats: {
              [CATEGORY_STAT_PATHS.goals]: 1,
              [CATEGORY_STAT_PATHS.tackles]: 5,
              [CATEGORY_STAT_PATHS.inside50s]: 2,
            },
          },
        ],
        [
          'ply_bench',
          {
            playerId: 'ply_bench',
            playerName: 'Bench Player',
            team: 'AAA',
            stats: {
              [CATEGORY_STAT_PATHS.goals]: 20,
              [CATEGORY_STAT_PATHS.tackles]: 20,
              [CATEGORY_STAT_PATHS.inside50s]: 20,
            },
          },
        ],
        [
          'ply_c',
          {
            playerId: 'ply_c',
            playerName: 'Player C',
            team: 'BBB',
            stats: {
              [CATEGORY_STAT_PATHS.goals]: 3,
              [CATEGORY_STAT_PATHS.tackles]: 2,
              [CATEGORY_STAT_PATHS.inside50s]: 4,
            },
          },
        ],
        [
          'ply_d',
          {
            playerId: 'ply_d',
            playerName: 'Player D',
            team: 'BBB',
            stats: {
              [CATEGORY_STAT_PATHS.goals]: 0,
              [CATEGORY_STAT_PATHS.tackles]: 6,
              [CATEGORY_STAT_PATHS.inside50s]: 1,
            },
          },
        ],
      ]),
    });

    expect(matchup.home.summary).toEqual({ wins: 1, losses: 0, ties: 2 });
    expect(matchup.away.summary).toEqual({ wins: 0, losses: 1, ties: 2 });
    expect(matchup.categories).toEqual([
      {
        key: 'goals',
        label: 'Goals',
        home: 3,
        away: 3,
        winner: 'tie',
      },
      {
        key: 'tackles',
        label: 'Tackles',
        home: 8,
        away: 8,
        winner: 'tie',
      },
      {
        key: 'inside50s',
        label: 'Inside 50s',
        home: 6,
        away: 5,
        winner: 'home',
      },
    ]);
  });
});
