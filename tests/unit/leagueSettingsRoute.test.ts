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
  countActions: vi.fn(),
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
    teamAction: { count: mocks.countActions },
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
    faabBudget: null,
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
    mocks.countActions.mockResolvedValue(0);
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

  it.each([100, null])('saves a FAAB budget of %s', async (faabBudget) => {
    const response = await PUT(settingsRequest({ waiver: { faabBudget } }), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: expect.objectContaining({ faabBudget }),
    });
  });

  it('refuses to change the FAAB budget once a waiver claim exists', async () => {
    mocks.countActions.mockResolvedValue(1);

    const response = await PUT(settingsRequest({ waiver: { faabBudget: 200 } }), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'FAAB budget is locked once waiver claims exist',
    });
    expect(mocks.countActions).toHaveBeenCalledWith({
      where: { leagueId: 'league-1', actionType: 'WAIVER_CLAIM' },
    });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it('saves an unchanged FAAB budget without checking for claims', async () => {
    mocks.countActions.mockResolvedValue(1);

    const response = await PUT(settingsRequest({ waiver: { faabBudget: null } }), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.countActions).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, '100'])(
    'rejects a FAAB budget of %s without writing settings',
    async (faabBudget) => {
      const response = await PUT(settingsRequest({ waiver: { faabBudget } }), {
        params: Promise.resolve({ id: 'league-1' }),
      });

      expect(response.status).toBe(400);
      expect(mocks.findLeague).not.toHaveBeenCalled();
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    }
  );

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

function settingsRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/leagues/league-1/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}
