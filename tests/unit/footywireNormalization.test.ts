import { describe, expect, it } from 'vitest';

import { normalizePlayerRow } from '../../etl/normalizePlayerRow';

describe('Footywire row normalization', () => {
  it('converts numeric strings before identifiers, checksums, and persistence use the row', () => {
    const row = normalizePlayerRow({
      season: '2026',
      round: '7',
      team: 'Carlton',
      opposition: 'Richmond',
      player_name: 'Test Player',
      kicks: '14',
      disposals: '27',
      tog_pct: '81.5',
      goals: null,
      behinds: 0,
    });

    expect(row).toMatchObject({
      season: 2026,
      round: 7,
      kicks: 14,
      disposals: 27,
      tog_pct: 81.5,
      behinds: 0,
    });
    expect(row.goals).toBeUndefined();
    expect(row).not.toHaveProperty('goals');
    expect(row).toHaveProperty('behinds', 0);
  });

  it('rejects invalid required and numeric fields', () => {
    expect(() =>
      normalizePlayerRow({ season: ' ', round: 1, team: 'Carlton', player_name: 'Player' })
    ).toThrow('season is required');
    expect(() =>
      normalizePlayerRow({ season: 'unknown', round: 1, team: 'Carlton', player_name: 'Player' })
    ).toThrow('season must be a finite number');
    expect(() =>
      normalizePlayerRow({ season: 2026, round: 1, team: '', player_name: 'Player' })
    ).toThrow('team is required');
    expect(() =>
      normalizePlayerRow({
        season: 2026,
        round: 1,
        team: 'Carlton',
        player_name: 'Player',
        kicks: 'many',
      })
    ).toThrow('kicks must be a finite number');
  });
});
