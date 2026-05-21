// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DevFixtureScenarioManifest } from '../core/types';
import { verifyFixtureLeagues } from './fixtureVerifier';

const mocks = vi.hoisted(() => ({
  leagueFindMany: vi.fn(),
  firestoreGet: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findMany: mocks.leagueFindMany,
    },
  },
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: vi.fn(() => firestoreChain()),
  },
}));

function firestoreChain() {
  return {
    doc: vi.fn(() => firestoreChain()),
    collection: vi.fn(() => firestoreChain()),
    where: vi.fn(() => firestoreChain()),
    get: mocks.firestoreGet,
  };
}

const manifest: DevFixtureScenarioManifest = {
  id: 'full-leagues',
  description: 'Full leagues',
  leagueNamePrefix: 'Statly Fixture Full League',
  leagueCount: 1,
  teamsPerLeague: 12,
  botTeamsPerLeague: 11,
  botUserIdPrefix: 'statly-fixture-full-league-',
  rosterSize: 18,
  benchSize: 4,
  categories: [],
};

function member(index: number) {
  return {
    id: `member-${index}`,
    botProfile: index === 1 ? null : { enabled: true },
    rosterPlayers: Array.from(
      { length: manifest.rosterSize + manifest.benchSize },
      (_, player) => ({
        id: `member-${index}-player-${player}`,
      })
    ),
  };
}

describe('verifyFixtureLeagues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.firestoreGet.mockResolvedValue({ size: 12 });
  });

  it('marks fixture leagues unready when draft order slots are incomplete', async () => {
    mocks.leagueFindMany.mockResolvedValue([
      {
        id: 'league-1',
        name: 'Statly Fixture Full League 1',
        inviteCode: 'ABC123',
        members: Array.from({ length: manifest.teamsPerLeague }, (_, index) => member(index + 1)),
        drafts: [
          {
            id: 'draft-1',
            status: 'LIVE',
            totalPicks: manifest.teamsPerLeague * (manifest.rosterSize + manifest.benchSize),
            orders: [{ slot: 1 }, { slot: 11 }, { slot: 12 }],
          },
        ],
      },
    ]);

    const [readiness] = await verifyFixtureLeagues({
      manifest,
      leagueIds: ['league-1'],
      season: 2026,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.issues).toEqual(
      expect.arrayContaining([
        'Expected 12 draft order slots, found 3.',
        'Draft order slots must be contiguous 1-12, found 1, 11, 12.',
      ])
    );
  });
});
