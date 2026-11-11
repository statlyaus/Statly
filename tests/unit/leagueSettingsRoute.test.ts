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
  findDraft: vi.fn(),
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
    draft: { findUnique: mocks.findDraft },
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
  categoriesJson: REAL_DATA_NINE_CATEGORY_PRESET,
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
    mocks.findDraft.mockResolvedValue(null);
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
      where: {
        leagueId: 'league-1',
        season: { activeForLeague: { is: { id: 'league-1' } } },
        actionType: 'WAIVER_CLAIM',
      },
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

  it.each([
    ['an unknown category key', { scoring: { categories: ['goals', 'tackles', 'goalz'] } }],
    ['too few categories', { scoring: { categories: ['goals', 'tackles'] } }],
    [
      'too many categories',
      {
        scoring: {
          categories: [
            'goals',
            'tackles',
            'inside50s',
            'intercepts',
            'contestedMarks',
            'rebound50s',
            'contestedPossessions',
            'effectiveDisposals',
            'scoreInvolvements',
            'kicks',
            'handballs',
          ],
        },
      },
    ],
    ['categories that are not a list', { scoring: { categories: 'goals' } }],
    [
      'time on ground %, which is not a scoring category',
      { scoring: { categories: ['goals', 'tackles', 'timeOnGroundPct'] } },
    ],
    ['a league name over 50 characters', { league: { name: 'L'.repeat(51) } }],
    ['a league name under 3 characters', { league: { name: 'AB' } }],
    ['an unknown time zone', { draft: { timeZone: 'Mars/Base' } }],
    ['an empty time zone', { draft: { timeZone: '' } }],
  ])('rejects %s without writing settings', async (_label, body) => {
    const response = await PUT(settingsRequest(body), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.updateLeague).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it('saves valid categories, name and time zone', async () => {
    const response = await PUT(
      settingsRequest({
        league: { name: 'Statly Premier League' },
        scoring: { categories: ['goals', 'tackles', 'intercepts'] },
        draft: { timeZone: 'Australia/Perth' },
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.updateLeague).toHaveBeenCalledWith({
      where: { id: 'league-1' },
      data: { name: 'Statly Premier League', categoriesJson: ['goals', 'tackles', 'intercepts'] },
    });
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: expect.objectContaining({ timeZone: 'Australia/Perth' }),
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

describe('league settings route locks', () => {
  const publishedAt = new Date('2026-03-01T00:00:00.000Z');
  const publishedLeague = {
    ...league,
    settings: { ...league.settings, scoringSettingsLockedAt: publishedAt },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue('owner-user');
    mocks.getAccess.mockResolvedValue({ isMember: true, canManage: true });
    mocks.findLeague.mockResolvedValue(league);
    mocks.transaction.mockResolvedValue([]);
    mocks.convergeDraftSetup.mockResolvedValue(undefined);
    mocks.countActions.mockResolvedValue(0);
    mocks.findDraft.mockResolvedValue(null);
  });

  it.each([
    ['categories', { scoring: { categories: ['goals', 'tackles', 'intercepts'] } }],
    ['category directions', { scoring: { categoryDirections: { goals: 'LOW_WINS' } } }],
    ['scoring mode', { scoring: { scoringMode: 'H2H_MOST_CATEGORIES' } }],
  ])('refuses to change %s once the competition is published', async (_label, body) => {
    mocks.findLeague.mockResolvedValue(publishedLeague);

    const response = await PUT(settingsRequest(body), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'SCORING_SETTINGS_LOCKED',
      error: expect.stringContaining('competition was published'),
    });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it('treats a league published before the lock column was written as locked', async () => {
    mocks.findLeague.mockResolvedValue({
      ...league,
      settings: { ...league.settings, competitionPublishedAt: publishedAt },
    });

    const response = await PUT(
      settingsRequest({ scoring: { scoringMode: 'H2H_MOST_CATEGORIES' } }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );

    expect(response.status).toBe(409);
  });

  it('saves the whole form after publication when the locked scoring values are unchanged', async () => {
    mocks.findLeague.mockResolvedValue(publishedLeague);

    const response = await PUT(
      settingsRequest({
        scoring: {
          categories: REAL_DATA_NINE_CATEGORY_PRESET,
          scoringMode: 'H2H_EACH_CATEGORY',
          categoryDirections: {},
        },
        trade: { tradeLimit: 5 },
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: expect.objectContaining({ tradeLimit: 5 }),
    });
  });

  it.each(['LIVE', 'PAUSED', 'COMPLETED'])(
    'refuses to change draft structure once the draft is %s',
    async (status) => {
      mocks.findDraft.mockResolvedValue({ status });

      for (const body of [
        { draft: { draftType: 'linear' } },
        { draft: { pickOrder: 'manual' } },
        { roster: { positionLimits: { DEF: 6, MID: 6, RUC: 1, FWD: 6, BENCH: 4 } } },
      ]) {
        const response = await PUT(settingsRequest(body), {
          params: Promise.resolve({ id: 'league-1' }),
        });

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
          code: 'DRAFT_STRUCTURE_LOCKED',
          error: expect.stringContaining('draft has started'),
        });
      }
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    }
  );

  it('lets the commissioner change draft structure while the draft is scheduled', async () => {
    mocks.findDraft.mockResolvedValue({ status: 'SCHEDULED' });

    const response = await PUT(settingsRequest({ draft: { draftType: 'linear' } }), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: expect.objectContaining({ draftType: 'LINEAR' }),
    });
  });

  it('saves other settings after the draft starts when draft structure is unchanged', async () => {
    mocks.findDraft.mockResolvedValue({ status: 'LIVE' });

    const response = await PUT(
      settingsRequest({
        draft: { draftType: 'snake', pickOrder: 'random' },
        trade: { tradeLimit: 4 },
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );

    expect(response.status).toBe(200);
  });

  it('reports both locks and their reasons in the settings response', async () => {
    mocks.findLeague.mockResolvedValue(publishedLeague);
    mocks.findDraft.mockResolvedValue({ status: 'COMPLETED' });

    const response = await PUT(settingsRequest({ trade: { tradeLimit: 4 } }), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    const payload = await response.json();
    expect(payload.data.scoring.scoringSettingsLockedAt).toBe(publishedAt.toISOString());
    expect(payload.data.locks).toEqual({
      scoring: expect.stringContaining('competition was published'),
      draftStructure: expect.stringContaining('draft has started'),
    });
  });
});

function settingsRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/leagues/league-1/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}
