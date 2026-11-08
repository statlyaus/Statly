// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { fakeIngestPrisma, fakeProvider } from './__fixtures__/fakes';
import type { NbaProviderInjury } from './nbaStatsProvider';
import { NbaIngestRejected } from './nbaStatsProvider';
import { syncNbaInjuries } from './syncNbaInjuries';

const NOW = new Date('2026-11-08T12:00:00Z');

function injuries(count: number): NbaProviderInjury[] {
  return Array.from({ length: count }, (_, index) => ({
    athleteExternalId: String(index),
    status: 'OUT',
    detail: 'Ankle',
    expectedReturnOn: null,
    reportedAt: null,
    comment: null,
    fantasyStatus: null,
    seasonEnding: false,
  }));
}

/** A season whose stored games run from `first` to `last` (Eastern dates). */
function seasonSpanning(first: string | null, last: string | null) {
  return fakeIngestPrisma({
    nbaGame: {
      aggregate: (async () => ({
        _min: { gameDate: first ? new Date(`${first}T00:00:00Z`) : null },
        _max: { gameDate: last ? new Date(`${last}T00:00:00Z`) : null },
      })) as never,
    },
  });
}

async function rejected(run: Promise<unknown>) {
  const error = await run.then(
    () => undefined,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(NbaIngestRejected);
  return error as NbaIngestRejected;
}

describe('syncNbaInjuries', () => {
  it('rejects more than 400 rows and writes only the run row', async () => {
    const { prisma, runs, forbiddenWrites } = seasonSpanning('2026-10-20', '2027-04-11');
    const provider = fakeProvider({ fetchInjuries: async () => injuries(401) });

    const error = await rejected(syncNbaInjuries({ prisma, provider, season: 2027, now: NOW }));

    expect(error.reason).toBe('out_of_bounds');
    expect(forbiddenWrites).toEqual([]);
    expect(runs).toEqual([expect.objectContaining({ job: 'INJURIES', outcome: 'REJECTED' })]);
  });

  it('rejects fewer than 20 rows in season', async () => {
    const { prisma, forbiddenWrites } = seasonSpanning('2026-10-20', '2027-04-11');
    const provider = fakeProvider({ fetchInjuries: async () => injuries(19) });

    const error = await rejected(syncNbaInjuries({ prisma, provider, season: 2027, now: NOW }));

    expect(error.reason).toBe('out_of_bounds');
    expect(forbiddenWrites).toEqual([]);
  });

  it.each([
    ['before the season', '2026-11-20', '2027-04-11'],
    ['with no stored schedule', null, null],
  ])('accepts a short list %s', async (_label, first, last) => {
    const { prisma, forbiddenWrites } = seasonSpanning(first, last);
    const provider = fakeProvider({ fetchInjuries: async () => injuries(3) });

    // The fake refuses the replace transaction, which proves the bound let the list through.
    await expect(syncNbaInjuries({ prisma, provider, season: 2027, now: NOW })).rejects.toThrow(
      'unexpected transaction'
    );
    expect(forbiddenWrites).toEqual(['$transaction']);
  });

  it('stores the note, fantasy status and season-ending flag with each row', async () => {
    const { prisma, transactionCalls } = fakeIngestPrisma(
      {
        nbaPlayerIdentity: {
          findMany: (async () => [{ externalId: '7', playerId: 'player-7' }]) as never,
        },
      },
      { transaction: () => undefined }
    );
    const provider = fakeProvider({
      fetchInjuries: async () => [
        {
          athleteExternalId: '7',
          status: 'OUT',
          detail: 'Right Achilles',
          expectedReturnOn: '2027-10-01',
          reportedAt: null,
          comment: 'Zed Example has sustained a season-ending Achilles injury.',
          fantasyStatus: 'OFS',
          seasonEnding: true,
        },
      ],
    });

    await syncNbaInjuries({ prisma, provider, season: 2027, now: NOW });

    const created = transactionCalls.find((call) => call.method === 'createMany');
    expect(created?.args).toEqual({
      data: [
        {
          playerId: 'player-7',
          status: 'OUT',
          detail: 'Right Achilles',
          expectedReturnOn: new Date('2027-10-01T00:00:00Z'),
          reportedAt: null,
          comment: 'Zed Example has sustained a season-ending Achilles injury.',
          fantasyStatus: 'OFS',
          seasonEnding: true,
          fetchedAt: NOW,
        },
      ],
    });
  });

  it('rejects a fetch failure before writing', async () => {
    const { prisma, forbiddenWrites } = seasonSpanning('2026-10-20', '2027-04-11');
    const provider = fakeProvider({
      fetchInjuries: async () => {
        throw new NbaIngestRejected('fetch_failed', 'injuries answered 502');
      },
    });

    const error = await rejected(syncNbaInjuries({ prisma, provider, season: 2027, now: NOW }));

    expect(error.reason).toBe('fetch_failed');
    expect(forbiddenWrites).toEqual([]);
  });
});
