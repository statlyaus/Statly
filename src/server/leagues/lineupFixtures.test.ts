import { describe, expect, it, vi } from 'vitest';

const etl = vi.hoisted(() => ({
  getRoundMatchesResult: vi.fn(),
  getRoundPlayerStatsResult: vi.fn(),
}));
vi.mock('@/server/etl/etlRoundData', () => etl);
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { loadRoundPlayerFixtures } from './lineupService';

describe('loadRoundPlayerFixtures', () => {
  it('maps each player to their AFL opponent, side and start, and flags confirmed byes', async () => {
    etl.getRoundMatchesResult.mockResolvedValue({
      ok: true,
      matches: [
        {
          match_uid: 'm1',
          season: 2026,
          round_number: 25,
          home_team: 'GWS Giants',
          away_team: 'Collingwood',
          start_time_utc: '2026-10-02T08:30:00.000Z',
          status: 'scheduled',
          confirmed_bye_teams: ['Sydney'],
        },
      ],
    });

    const result = await loadRoundPlayerFixtures({
      aflRound: 25,
      season: 2026,
      players: [
        { playerId: 'giant', club: 'GWS' },
        { playerId: 'magpie', club: 'Collingwood' },
        { playerId: 'swan', club: 'Sydney' },
        { playerId: 'unknown', club: 'Geelong' },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fixturesByPlayerId.get('giant')).toMatchObject({
      opponent: 'Collingwood',
      isHome: true,
      bye: false,
    });
    expect(result.fixturesByPlayerId.get('magpie')).toMatchObject({ isHome: false, bye: false });
    expect(result.fixturesByPlayerId.get('magpie')?.startsAt?.toISOString()).toBe(
      '2026-10-02T08:30:00.000Z'
    );
    expect(result.fixturesByPlayerId.get('swan')).toMatchObject({ bye: true, opponent: null });
    expect(result.fixturesByPlayerId.has('unknown')).toBe(false);
  });

  it('reports failure instead of guessing when the fixture source is unavailable', async () => {
    etl.getRoundMatchesResult.mockResolvedValue({ ok: false, error: new Error('down') });

    await expect(
      loadRoundPlayerFixtures({ aflRound: 25, players: [{ playerId: 'p', club: 'GWS' }] })
    ).resolves.toEqual({ ok: false });
  });
});
