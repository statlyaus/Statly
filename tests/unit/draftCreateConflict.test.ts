import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({
  league: { findUnique: vi.fn(), update: vi.fn() },
  leagueSettings: { update: vi.fn() },
  draft: { findUnique: vi.fn(), create: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: { count: vi.fn().mockResolvedValue(600) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: vi.fn().mockResolvedValue('user-1'),
}));
vi.mock('@/server/leagues/membership', () => ({
  canManageLeague: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: { collection: vi.fn() } }));
vi.mock('@/server/queue/draftQueue', () => ({ scheduleDraftStart: vi.fn() }));
vi.mock('@/lib/reminders', () => ({ createDraftReminders: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

describe('creating a second draft for a league', () => {
  beforeEach(() => {
    tx.league.findUnique.mockResolvedValue({
      id: 'league-1',
      categoriesJson: ['goals'],
      settings: { id: 'settings-1' },
      members: [],
    });
    tx.draft.findUnique.mockResolvedValue({ id: 'draft-9' });
  });

  it('answers 409 with the existing draft instead of a generic 500', async () => {
    const { POST } = await import('@/app/api/drafts/route');

    const response = await POST({
      json: vi.fn().mockResolvedValue({
        leagueId: 'league-1',
        name: 'League draft',
        leagueSize: 4,
        draftType: 'snake',
        timePerPick: 60,
      }),
    } as never);

    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).toContain('draft-9');
    expect(tx.draft.create).not.toHaveBeenCalled();
  });
});
