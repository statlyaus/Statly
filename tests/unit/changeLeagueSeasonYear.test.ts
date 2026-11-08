import { describe, expect, it, vi } from 'vitest';

import { changeLeagueSeasonYear } from '@/server/leagues/changeSeasonYear';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

function buildClient(league: unknown) {
  const client = {
    league: { findUnique: vi.fn().mockResolvedValue(league) },
    leagueSeason: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((work: (tx: unknown) => unknown) => work(client));
  return client;
}

const setupLeague = {
  id: 'league-1',
  activeSeasonId: 'season-1',
  settings: { competitionStatus: 'SETUP' },
};

describe('changeLeagueSeasonYear', () => {
  it('moves the active season to the chosen year while the competition is in setup', async () => {
    const client = buildClient(setupLeague);

    const result = await changeLeagueSeasonYear(
      { leagueId: 'league-1', year: 2027 },
      client as never
    );

    expect(result).toEqual({ ok: true, year: 2027 });
    expect(client.leagueSeason.update).toHaveBeenCalledWith({
      where: { id: 'season-1' },
      data: {
        label: '2027 season',
        year: 2027,
        startsAt: new Date('2027-01-01T00:00:00.000Z'),
        endsAt: new Date('2027-12-31T23:59:59.999Z'),
      },
    });
  });

  it.each(['PUBLISHED', 'PENDING', 'ACTIVE', 'COMPLETE'])(
    'refuses once the competition is %s',
    async (competitionStatus) => {
      const client = buildClient({ ...setupLeague, settings: { competitionStatus } });

      const result = await changeLeagueSeasonYear(
        { leagueId: 'league-1', year: 2027 },
        client as never
      );

      expect(result).toEqual({
        ok: false,
        status: 409,
        error: 'The season can only change while the competition is in setup.',
      });
      expect(client.leagueSeason.update).not.toHaveBeenCalled();
    }
  );

  it('reports a missing league', async () => {
    const client = buildClient(null);

    const result = await changeLeagueSeasonYear(
      { leagueId: 'league-1', year: 2027 },
      client as never
    );

    expect(result).toEqual({ ok: false, status: 404, error: 'League not found' });
  });
});
