import { describe, expect, it } from 'vitest';

import { transformToLegacyPlayerStats, type ETLPlayerStats } from '@/lib/etlIntegration';

const row = (stats: ETLPlayerStats['stats']): ETLPlayerStats => ({
  match_uid: 'm-1',
  player_uid: 'ply_nick_daicos',
  player_name: 'Nick Daicos',
  team: 'Collingwood',
  season: 2026,
  round_number: 3,
  source: 'footywire',
  last_seen_at: '2026-04-01T00:00:00Z',
  stats,
});

describe('Match Centre player stats', () => {
  it('reads the nine categories from the keys the ETL writes', () => {
    const [player] = transformToLegacyPlayerStats([
      row({
        goals: 2,
        tackles: 5,
        inside_50s: 4,
        intercepts: 3,
        contested_marks: 1,
        rebound_50s: 2,
        contested_possessions: 12,
        effective_disposals: 25,
        score_involvements: 7,
        hit_outs: 9,
      }),
    ]);

    expect(player.categories).toEqual({
      goals: 2,
      tackles: 5,
      inside50s: 4,
      intercepts: 3,
      contestedMarks: 1,
      rebound50s: 2,
      contestedPossessions: 12,
      effectiveDisposals: 25,
      scoreInvolvements: 7,
    });
    expect(player.hitouts).toBe(9);
  });

  it('keeps an unreported stat as null, not 0, and computes no points score', () => {
    const [player] = transformToLegacyPlayerStats([row({ goals: 0, tackles: null })]);

    expect(player.categories.goals).toBe(0);
    expect(player.categories.tackles).toBeNull();
    expect(player.categories.intercepts).toBeNull();
    expect(player.hitouts).toBeNull();
    expect(player).not.toHaveProperty('fantasyScore');
  });
});
