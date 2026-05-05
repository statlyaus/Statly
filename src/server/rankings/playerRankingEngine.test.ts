import { describe, expect, it } from 'vitest';

import {
  buildPlayerRankingRows,
  PLAYER_RANKING_MIN_GAMES,
} from '@/server/rankings/playerRankingEngine';
import { CANONICAL_STAT_KEYS, type CanonicalStatKey } from '@/lib/stats/statColumns';

function buildEmptyStats(): Record<CanonicalStatKey, number> {
  const stats = {} as Record<CanonicalStatKey, number>;
  for (const key of CANONICAL_STAT_KEYS) {
    stats[key] = 0;
  }
  return stats;
}

function buildSummary(params: {
  playerId: string;
  playerName: string;
  position: string;
  gamesPlayed: number;
  goals?: number;
  tackles?: number;
}): {
  playerId: string;
  playerName: string;
  club: string;
  position: string;
  gamesPlayed: number;
  averageScore: number;
  totalValue: number;
  stats: Record<CanonicalStatKey, number>;
  totals: Record<CanonicalStatKey, number>;
} {
  const stats = buildEmptyStats();
  stats.goals = params.goals ?? 0;
  stats.tackles = params.tackles ?? 0;

  return {
    playerId: params.playerId,
    playerName: params.playerName,
    club: 'Test FC',
    position: params.position,
    gamesPlayed: params.gamesPlayed,
    averageScore: 0,
    totalValue: 0,
    stats,
    totals: stats,
  };
}

describe('buildPlayerRankingRows', () => {
  it('excludes players below the minimum games threshold', () => {
    const rows = buildPlayerRankingRows([
      buildSummary({
        playerId: 'eligible',
        playerName: 'Eligible Player',
        position: 'MID',
        gamesPlayed: PLAYER_RANKING_MIN_GAMES,
        goals: 2,
      }),
      buildSummary({
        playerId: 'ineligible',
        playerName: 'Ineligible Player',
        position: 'MID',
        gamesPlayed: PLAYER_RANKING_MIN_GAMES - 1,
        goals: 10,
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.playerId).toBe('eligible');
  });

  it('flags two and three game players as small sample', () => {
    const rows = buildPlayerRankingRows([
      buildSummary({
        playerId: 'two-game',
        playerName: 'Two Game Player',
        position: 'MID',
        gamesPlayed: 2,
        goals: 4,
      }),
      buildSummary({
        playerId: 'four-game',
        playerName: 'Four Game Player',
        position: 'MID',
        gamesPlayed: 4,
        goals: 2,
      }),
    ]);

    expect(rows.find((row) => row.playerId === 'two-game')?.isSmallSample).toBe(true);
    expect(rows.find((row) => row.playerId === 'four-game')?.isSmallSample).toBe(false);
  });

  it('uses the best eligible replacement position for dual-position players', () => {
    const rows = buildPlayerRankingRows([
      buildSummary({
        playerId: 'dual',
        playerName: 'Dual Position',
        position: 'DEF/MID',
        gamesPlayed: 4,
        goals: 10,
      }),
      buildSummary({
        playerId: 'def-two',
        playerName: 'Defender Two',
        position: 'DEF',
        gamesPlayed: 4,
        goals: 4,
      }),
      buildSummary({
        playerId: 'def-three',
        playerName: 'Defender Three',
        position: 'DEF',
        gamesPlayed: 4,
        goals: 1,
      }),
      buildSummary({
        playerId: 'mid-two',
        playerName: 'Midfielder Two',
        position: 'MID',
        gamesPlayed: 4,
        goals: 7,
      }),
      buildSummary({
        playerId: 'mid-three',
        playerName: 'Midfielder Three',
        position: 'MID',
        gamesPlayed: 4,
        goals: 6,
      }),
    ]);

    const dual = rows.find((row) => row.playerId === 'dual');

    expect(dual?.metadata.replacementPosition).toBe('DEF');
    expect(dual?.metadata.eligiblePositions).toEqual(['DEF', 'MID']);
    expect(dual?.rankingValue).toBeGreaterThan(0);
  });
});
