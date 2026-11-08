/**
 * The Footywire identity provider end to end on PostgreSQL: a reviewed manifest links an ETL
 * player id to a Statly player, and that player's ingested stats then reach the round's live
 * totals. Conflicts write nothing. Firestore is never contacted: the ETL round readers are mocked
 * with documents in the shape etl/processFootywireData.ts and etl/fixtureIngest.ts write.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const etl = vi.hoisted(() => ({
  stats: [] as Record<string, unknown>[],
  matches: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/etl/etlRoundData', () => ({
  getRoundPlayerStatsResult: () => Promise.resolve({ ok: true, stats: etl.stats }),
  getRoundMatchesResult: () => Promise.resolve({ ok: true, matches: etl.matches }),
  getRoundMatches: () => Promise.resolve(etl.matches),
}));

import { prisma } from '@/lib/prisma';
import {
  applyFootywireIdentityManifest,
  FOOTYWIRE_STATS_PROVIDER,
  FootywireIdentityBlockedError,
} from '@/server/players/footywireIdentity';
import { loadLivePlayerTotalsForRound } from '@/server/leagues/matchupReadModel';

const MAPPED = 'int-fw-identity-mapped';
const OTHER = 'int-fw-identity-other';
const EXTERNAL = 'ply_intfwidentity_mapped';
const UNMAPPED_EXTERNAL = 'ply_intfwidentity_unmapped';

const reviewed = (mappings: { externalId: string; playerId: string }[]) => ({
  schemaVersion: 1 as const,
  provider: FOOTYWIRE_STATS_PROVIDER,
  reviewed: true as const,
  reviewedBy: 'integration-test',
  reviewedAt: '2026-11-08T00:00:00.000Z',
  mappings,
});

async function cleanup() {
  await prisma.playerExternalIdentity.deleteMany({ where: { playerId: { in: [MAPPED, OTHER] } } });
  await prisma.player.deleteMany({ where: { id: { in: [MAPPED, OTHER] } } });
}

beforeEach(async () => {
  await cleanup();
  await prisma.player.createMany({
    data: [
      { id: MAPPED, name: 'Intfwidentity Mapped', club: 'Carlton', position: 'MID' },
      { id: OTHER, name: 'Intfwidentity Other', club: 'Carlton', position: 'FWD' },
    ],
  });
  etl.stats = [];
  etl.matches = [];
});

afterAll(cleanup);

describe('Footywire identity provider', () => {
  it('links reviewed mappings with the review time and reports what it did', async () => {
    const result = await applyFootywireIdentityManifest(
      prisma,
      reviewed([{ externalId: EXTERNAL, playerId: MAPPED }])
    );
    expect(result).toEqual({ created: 1, unchanged: 0 });

    const identity = await prisma.playerExternalIdentity.findUnique({
      where: {
        provider_externalId: { provider: FOOTYWIRE_STATS_PROVIDER, externalId: EXTERNAL },
      },
    });
    expect(identity).toMatchObject({
      playerId: MAPPED,
      verifiedAt: new Date('2026-11-08T00:00:00.000Z'),
    });

    // Re-applying the same reviewed manifest changes nothing.
    await expect(
      applyFootywireIdentityManifest(prisma, reviewed([{ externalId: EXTERNAL, playerId: MAPPED }]))
    ).resolves.toEqual({ created: 0, unchanged: 1 });
  });

  it('writes nothing when any mapping conflicts, and never moves an existing link', async () => {
    await applyFootywireIdentityManifest(
      prisma,
      reviewed([{ externalId: EXTERNAL, playerId: MAPPED }])
    );

    await expect(
      applyFootywireIdentityManifest(
        prisma,
        reviewed([
          { externalId: UNMAPPED_EXTERNAL, playerId: OTHER },
          { externalId: EXTERNAL, playerId: OTHER },
        ])
      )
    ).rejects.toBeInstanceOf(FootywireIdentityBlockedError);

    const links = await prisma.playerExternalIdentity.findMany({
      where: { provider: FOOTYWIRE_STATS_PROVIDER, playerId: { in: [MAPPED, OTHER] } },
      select: { externalId: true, playerId: true },
    });
    expect(links).toEqual([{ externalId: EXTERNAL, playerId: MAPPED }]);
  });

  it("puts a mapped player's ingested stats in the round's live totals", async () => {
    await applyFootywireIdentityManifest(
      prisma,
      reviewed([{ externalId: EXTERNAL, playerId: MAPPED }])
    );
    etl.matches = [
      {
        match_uid: '2026-R7-CAR-COL',
        season: 2026,
        round_number: 7,
        home_team: 'Carlton',
        away_team: 'Collingwood',
        start_time_utc: '2026-04-25T09:30:00.000Z',
        status: 'final',
        confirmed_bye_teams: [],
      },
    ];
    etl.stats = [
      {
        match_uid: '2026-R7-CAR-COL',
        player_uid: EXTERNAL,
        season: 2026,
        round: 7,
        team: 'Carlton',
        player_name: 'Intfwidentity Mapped',
        stats: { goals: 3, tackles: 6, inside_50s: 4, minutes: 80 },
        data_source: 'footywire_fitzroy',
      },
      {
        match_uid: '2026-R7-CAR-COL',
        player_uid: UNMAPPED_EXTERNAL,
        season: 2026,
        round: 7,
        team: 'Carlton',
        player_name: 'Intfwidentity Other',
        stats: { goals: 1, minutes: 80 },
        data_source: 'footywire_fitzroy',
      },
    ];

    const live = await loadLivePlayerTotalsForRound(2026, 7, [
      { playerId: MAPPED, club: 'Carlton' },
    ]);

    expect(live.available).toBe(true);
    expect(live.totalsByPlayerId.get(MAPPED)).toMatchObject({
      goals: 3,
      tackles: 6,
      inside50s: 4,
    });
    // The unreviewed player's stats stay under the ETL id: no name guess links them to OTHER.
    expect(live.totalsByPlayerId.has(OTHER)).toBe(false);

    // His stats may be the unlinked Carlton row, so he is not inferred unselected: the round waits.
    const unmappedLive = await loadLivePlayerTotalsForRound(2026, 7, [
      { playerId: OTHER, club: 'Carlton' },
    ]);
    expect(unmappedLive.available).toBe(false);
  });
});
