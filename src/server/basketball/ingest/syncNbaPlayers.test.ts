// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { fakeIngestPrisma, fakeProvider } from './__fixtures__/fakes';
import type { NbaProviderPlayer, NbaProviderTeam } from './nbaStatsProvider';
import { NbaIngestRejected } from './nbaStatsProvider';
import { syncNbaPlayers } from './syncNbaPlayers';

const teams: NbaProviderTeam[] = Array.from({ length: 30 }, (_, index) => ({
  externalId: String(index + 1),
  code: `T${String(index).padStart(2, '0')}`,
  name: `Team ${index}`,
}));

function rosterOf(size: number) {
  return async (teamId: string): Promise<NbaProviderPlayer[]> =>
    Array.from({ length: size }, (_, index) => ({
      externalId: `${teamId}-${index}`,
      fullName: `Player ${teamId}-${index}`,
      firstName: null,
      lastName: null,
      positions: ['G'],
      birthDate: null,
    }));
}

async function rejected(run: Promise<unknown>) {
  const error = await run.then(
    () => undefined,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(NbaIngestRejected);
  return error as NbaIngestRejected;
}

describe('syncNbaPlayers', () => {
  it.each([
    ['29 teams', teams.slice(1)],
    ['a repeated team code', [...teams.slice(1), { ...teams[1], externalId: '99' }]],
  ])('rejects %s as out_of_bounds and writes only the run row', async (_label, fetched) => {
    const { prisma, runs, forbiddenWrites } = fakeIngestPrisma();
    const provider = fakeProvider({
      fetchTeams: async () => fetched,
      fetchTeamRoster: rosterOf(15),
    });

    const error = await rejected(syncNbaPlayers({ prisma, provider, season: 2027 }));

    expect(error.reason).toBe('out_of_bounds');
    expect(forbiddenWrites).toEqual([]);
    expect(runs).toEqual([expect.objectContaining({ job: 'PLAYERS', outcome: 'REJECTED' })]);
  });

  it.each([
    ['too few players', 9],
    ['too many players', 24],
  ])('rejects %s across all rosters', async (_label, perTeam) => {
    const { prisma, forbiddenWrites } = fakeIngestPrisma();
    const provider = fakeProvider({
      fetchTeams: async () => teams,
      fetchTeamRoster: rosterOf(perTeam),
    });

    const error = await rejected(syncNbaPlayers({ prisma, provider, season: 2027 }));

    expect(error.reason).toBe('out_of_bounds');
    expect(forbiddenWrites).toEqual([]);
  });

  it('rejects a roster fetch failure before writing', async () => {
    const { prisma, forbiddenWrites } = fakeIngestPrisma();
    const provider = fakeProvider({
      fetchTeams: async () => teams,
      fetchTeamRoster: async (teamId) => {
        if (teamId === '7') throw new NbaIngestRejected('fetch_failed', 'roster 7 answered 503');
        return rosterOf(15)(teamId);
      },
    });

    const error = await rejected(syncNbaPlayers({ prisma, provider, season: 2027 }));

    expect(error.reason).toBe('fetch_failed');
    expect(forbiddenWrites).toEqual([]);
  });
});
