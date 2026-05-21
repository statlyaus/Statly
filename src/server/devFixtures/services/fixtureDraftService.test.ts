// @vitest-environment node
import { DraftStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DevFixtureScenarioManifest } from '../core/types';

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  transaction: vi.fn(),
  syncFromLeagueSettings: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: mocks.leagueFindUnique,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/server/draft/services/LeagueDraftProvisioningService', () => ({
  leagueDraftProvisioningService: {
    syncFromLeagueSettings: mocks.syncFromLeagueSettings,
  },
}));

import { ensureFixtureDrafts } from './fixtureDraftService';

const manifest: DevFixtureScenarioManifest = {
  id: 'full-leagues',
  description: 'Full league fixtures',
  leagueNamePrefix: 'Statly Fixture Full League',
  leagueCount: 3,
  teamsPerLeague: 4,
  botTeamsPerLeague: 3,
  botUserIdPrefix: 'statly-fixture-full-league-',
  rosterSize: 17,
  benchSize: 4,
  categories: ['KICKS'],
};

const members = [1, 2, 3, 4].map((slot) => ({
  id: `member-${slot}`,
  draftSlot: slot,
}));

function buildLeagueDraft(overrides?: {
  status?: DraftStatus;
  totalPicks?: number;
  orders?: Array<{ memberId: string; slot: number }>;
}) {
  return {
    id: 'league-1',
    members,
    drafts: [
      {
        id: 'draft-1',
        status: overrides?.status ?? DraftStatus.LIVE,
        totalPicks: overrides?.totalPicks ?? 84,
        orders:
          overrides?.orders ??
          members.map((member) => ({
            memberId: member.id,
            slot: member.draftSlot,
          })),
      },
    ],
  };
}

describe('ensureFixtureDrafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        draftEvent: { deleteMany: vi.fn() },
        draftWatchlist: { deleteMany: vi.fn() },
        preDraftQueue: { deleteMany: vi.fn() },
        lobbyActivity: { deleteMany: vi.fn() },
        pick: { deleteMany: vi.fn() },
        draftOrder: { deleteMany: vi.fn() },
        draft: { delete: vi.fn() },
      })
    );
    mocks.syncFromLeagueSettings.mockResolvedValue({
      status: 'updated',
      draft: {
        id: 'draft-2',
        status: DraftStatus.SCHEDULED,
        startAt: '2026-05-20T00:00:00.000Z',
        createdAt: '2026-05-18T00:00:00.000Z',
      },
    });
  });

  it('does not reset a healthy locked fixture draft before provisioning sync', async () => {
    mocks.leagueFindUnique.mockResolvedValue(buildLeagueDraft());

    const steps = await ensureFixtureDrafts({ manifest, leagueIds: ['league-1'] });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.syncFromLeagueSettings).toHaveBeenCalledWith('league-1');
    expect(steps).toEqual([
      {
        name: 'draft league-1',
        status: 'updated',
        detail: 'updated draft draft-2 (SCHEDULED).',
      },
    ]);
  });

  it('resets corrupt locked fixture draft order before provisioning sync', async () => {
    mocks.leagueFindUnique.mockResolvedValue(
      buildLeagueDraft({
        orders: [
          { memberId: 'member-1', slot: 1 },
          { memberId: 'member-3', slot: 3 },
        ],
      })
    );

    const steps = await ensureFixtureDrafts({ manifest, leagueIds: ['league-1'] });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.syncFromLeagueSettings).toHaveBeenCalledWith('league-1');
    expect(steps).toEqual([
      {
        name: 'draft league-1 repair',
        status: 'updated',
        detail: 'Reset corrupt locked fixture draft draft-1 before reprovisioning.',
      },
      {
        name: 'draft league-1',
        status: 'updated',
        detail: 'updated draft draft-2 (SCHEDULED).',
      },
    ]);
  });
});
