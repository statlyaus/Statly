// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { fakeIngestPrisma, fakeProvider } from './__fixtures__/fakes';
import type { NbaProviderGame, NbaProviderTeam } from './nbaStatsProvider';
import { NbaIngestRejected } from './nbaStatsProvider';
import { syncNbaSchedule } from './syncNbaSchedule';

const teams: NbaProviderTeam[] = Array.from({ length: 30 }, (_, index) => ({
  externalId: String(index + 1),
  code: `T${String(index).padStart(2, '0')}`,
  name: `Team ${index}`,
}));

function game(externalId: string, season = 2027): NbaProviderGame {
  return {
    externalId,
    season,
    startsAt: new Date('2026-11-06T02:00:00Z'),
    gameDate: '2026-11-05',
    homeTeamCode: 'T00',
    awayTeamCode: 'T01',
    status: 'SCHEDULED',
    homeScore: null,
    awayScore: null,
  };
}

/** Each team lists `perTeam` games; consecutive teams share them, as home and away do. */
function schedules(perTeam: number, season = 2027) {
  return async (teamId: string) => {
    const pair = Math.floor((Number(teamId) - 1) / 2);
    return Array.from({ length: perTeam }, (_, index) => game(`${pair}-${index}`, season));
  };
}

async function rejected(run: Promise<unknown>) {
  const error = await run.then(
    () => undefined,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(NbaIngestRejected);
  return error as NbaIngestRejected;
}

describe('syncNbaSchedule', () => {
  it.each([
    ['too few games', 60],
    ['too many games', 90],
  ])('rejects %s as out_of_bounds and writes only the run row', async (_label, perTeam) => {
    const { prisma, runs, forbiddenWrites } = fakeIngestPrisma();
    const provider = fakeProvider({
      fetchTeams: async () => teams,
      fetchTeamSchedule: schedules(perTeam),
    });

    const error = await rejected(syncNbaSchedule({ prisma, provider, season: 2027 }));

    expect(error.reason).toBe('out_of_bounds');
    expect(forbiddenWrites).toEqual([]);
    expect(runs).toEqual([expect.objectContaining({ job: 'SCHEDULE', outcome: 'REJECTED' })]);
  });

  it('counts only the requested season', async () => {
    const { prisma, forbiddenWrites } = fakeIngestPrisma();
    const provider = fakeProvider({
      fetchTeams: async () => teams,
      fetchTeamSchedule: schedules(82, 2026),
    });

    const error = await rejected(syncNbaSchedule({ prisma, provider, season: 2027 }));

    expect(error.message).toMatch(/got 0/);
    expect(forbiddenWrites).toEqual([]);
  });

  it('rejects a schedule fetch failure before writing', async () => {
    const { prisma, forbiddenWrites } = fakeIngestPrisma();
    const provider = fakeProvider({
      fetchTeams: async () => teams,
      fetchTeamSchedule: async () => {
        throw new NbaIngestRejected('parse_failed', 'unknown team');
      },
    });

    const error = await rejected(syncNbaSchedule({ prisma, provider, season: 2027 }));

    expect(error.reason).toBe('parse_failed');
    expect(forbiddenWrites).toEqual([]);
  });
});
