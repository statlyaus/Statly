import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getAccess: vi.fn(),
  findLeague: vi.fn(),
  updateLeague: vi.fn(),
  updateSettings: vi.fn(),
  transaction: vi.fn(),
  convergeDraftSetup: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: mocks.authenticate,
}));
vi.mock('@/server/leagues/membership', () => ({
  getLeagueMembershipAccess: mocks.getAccess,
}));
vi.mock('@/server/draft/services/DraftSetupConvergenceService', () => ({
  ensureLeagueDraftSetupConverged: mocks.convergeDraftSetup,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: mocks.findLeague,
      update: mocks.updateLeague,
    },
    leagueSettings: { update: mocks.updateSettings },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));
vi.mock('@/lib/leagueMembership', () => ({ listActiveLeagueMembers: vi.fn() }));

import { PUT } from '@/app/api/leagues/[id]/settings/route';

const league = {
  id: 'league-1',
  name: 'Statly Premier League',
  inviteCode: 'CODE1234',
  categoriesJson: JSON.stringify(REAL_DATA_NINE_CATEGORY_PRESET),
  _count: { members: 1 },
  settings: {
    id: 'settings-1',
    maxTeams: 12,
    rosterSize: 18,
    benchSize: 4,
    pickSeconds: 120,
    allowAutoPick: true,
    positionLimitsJson: null,
    autoPickRulesJson: null,
    draftType: 'SNAKE',
    pickOrder: 'RANDOM',
    waiverRule: 'WEEKLY',
    startAt: new Date('2026-08-15T09:00:00.000Z'),
    timeZone: 'Australia/Melbourne',
    locked: false,
    scoringMode: 'H2H_EACH_CATEGORY',
    fixtureGenerationMode: 'AUTOMATIC',
    lineupSlotsJson: null,
    categoryDirectionsJson: null,
    scoringSettingsLockedAt: null,
    competitionRulesVersion: 0,
    tradeLimit: 10,
    tradeReviewMode: 'NONE',
    tradeDeadline: null,
    tradeOfferExpiryHours: 72,
    tradeReviewHours: 24,
    tradeVetoThreshold: 3,
  },
};

describe('league settings route draft scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue('owner-user');
    mocks.getAccess.mockResolvedValue({ isMember: true, canManage: true });
    mocks.findLeague.mockResolvedValue(league);
    mocks.updateLeague.mockResolvedValue(league);
    mocks.updateSettings.mockResolvedValue(league.settings);
    mocks.transaction.mockResolvedValue([]);
    mocks.convergeDraftSetup.mockResolvedValue(undefined);
  });

  it('clears a scheduled draft when the request explicitly sends null', async () => {
    const response = await PUT(
      new NextRequest('http://localhost/api/leagues/league-1/settings', {
        method: 'PUT',
        body: JSON.stringify({ draft: { draftDate: null } }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: expect.objectContaining({ startAt: null }),
    });
  });

  it('rejects malformed draft dates without writing settings', async () => {
    const response = await PUT(
      new NextRequest('http://localhost/api/leagues/league-1/settings', {
        method: 'PUT',
        body: JSON.stringify({ draft: { draftDate: 'not-a-date' } }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );

    await expect(response.json()).resolves.toEqual({ error: 'Invalid draft date' });
    expect(response.status).toBe(400);
    expect(mocks.findLeague).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});
