import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  draft: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  leagueRoster: { count: vi.fn() },
  teamAction: { count: vi.fn() },
  leagueRosterPlayer: { count: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));

import { loadLobbySchemaDiagnostic } from '@/server/diagnostics/lobbySchemaDiagnostic';

describe('lobby schema diagnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.draft.count.mockResolvedValue(4);
    prismaMocks.leagueRoster.count.mockResolvedValue(3);
    prismaMocks.teamAction.count.mockResolvedValue(2);
    prismaMocks.leagueRosterPlayer.count.mockResolvedValue(66);
    prismaMocks.draft.findFirst.mockResolvedValue({
      id: 'draft-1',
      status: 'SCHEDULED',
      lobbyStatus: 'OPEN',
      lobbyOpenAt: null,
    });
  });

  it('reports migrated tables and lobby columns as ready', async () => {
    const result = await loadLobbySchemaDiagnostic();

    expect(result).toMatchObject({
      columnsReady: true,
      tablesReady: true,
      draftCount: 4,
      tableChecks: {
        leagueRoster: { ready: true, count: 3 },
        teamAction: { ready: true, count: 2 },
        leagueRosterPlayer: { ready: true, count: 66 },
      },
      lobbyTest: { success: true, draft: { id: 'draft-1' } },
    });
  });

  it('returns partial readiness details when one roster table is absent', async () => {
    prismaMocks.leagueRosterPlayer.count.mockRejectedValue(
      new Error('The table `LeagueRosterPlayer` does not exist')
    );

    const result = await loadLobbySchemaDiagnostic();

    expect(result).toMatchObject({
      columnsReady: true,
      tablesReady: false,
      draftCount: 4,
      tableChecks: {
        draft: { ready: true, count: 4 },
        leagueRoster: { ready: true, count: 3 },
        teamAction: { ready: true, count: 2 },
        leagueRosterPlayer: {
          ready: false,
          count: null,
          error: 'The table `LeagueRosterPlayer` does not exist',
        },
      },
      lobbyTest: { success: true, draft: { id: 'draft-1' } },
    });
  });
});
