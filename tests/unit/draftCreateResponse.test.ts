import { describe, expect, it, vi } from 'vitest';

const member = (id: string, teamName: string, displayName: string) => ({
  id,
  userId: `user-${id}`,
  teamName,
  draftSlot: null,
  joinedAt: new Date('2026-01-01T00:00:00Z'),
  isActive: true,
  user: { id: `user-${id}`, email: '', displayName, timeZone: null },
});

const tx = vi.hoisted(() => ({
  league: { findUnique: vi.fn(), update: vi.fn() },
  leagueSettings: { update: vi.fn() },
  draft: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: { count: vi.fn().mockResolvedValue(600) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: vi.fn().mockResolvedValue('user-a') }));
vi.mock('@/server/leagues/membership', () => ({ canManageLeague: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: { collection: vi.fn() } }));
vi.mock('@/server/queue/draftQueue', () => ({ scheduleDraftStart: vi.fn() }));
vi.mock('@/lib/reminders', () => ({ createDraftReminders: vi.fn() }));
vi.mock('@/server/draft/draftOrderWriter', () => ({ writeDraftOrder: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

describe('league draft create response', () => {
  it("lists the league's teams by slot, with no standalone-draft leftovers", async () => {
    const members = [
      member('a', 'Alpha FC', 'Ann'),
      member('b', 'Beta FC', 'Ben'),
      member('c', 'Gamma FC', 'Cat'),
      member('d', 'Delta FC', 'Dan'),
    ];
    tx.league.findUnique.mockResolvedValue({
      id: 'league-1',
      name: 'League',
      categoriesJson: ['goals'],
      settings: { id: 'settings-1', leagueFormat: 'STANDARD' },
      members,
    });
    tx.leagueSettings.update.mockResolvedValue({ startAt: null });
    tx.draft.create.mockResolvedValue({
      id: 'draft-1',
      status: 'SCHEDULED',
      createdAt: new Date('2026-01-02T00:00:00Z'),
      currentPick: 1,
      round: 1,
    });
    const { POST } = await import('@/app/api/drafts/route');

    const response = await POST({
      json: vi.fn().mockResolvedValue({
        leagueId: 'league-1',
        name: 'League draft',
        leagueSize: 12,
        draftType: 'snake',
        timePerPick: 60,
        pickOrder: 'manual',
      }),
    } as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.teamCount).toBe(4);
    expect(body.data.participants).toHaveLength(4);
    expect(body.data.participants[0]).toEqual(
      expect.objectContaining({ slot: 1, teamName: expect.any(String) })
    );
    const text = JSON.stringify(body);
    expect(text).not.toContain('You (Admin)');
    expect(text).not.toContain('CPU Team');
    expect(body.data).not.toHaveProperty('yourSlot');
    expect(body.data).not.toHaveProperty('adminPrivileges');
  });
});
