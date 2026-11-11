import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

// League format and Bloodsucker settings (#1278, BR-01, BR-03, BR-04a, BR-05).

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getAccess: vi.fn(),
  findLeague: vi.fn(),
  updateLeague: vi.fn(),
  updateSettings: vi.fn(),
  createAudit: vi.fn(),
  findMember: vi.fn(),
  transaction: vi.fn(),
  countActions: vi.fn(),
  findDraft: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: mocks.authenticate }));
vi.mock('@/server/leagues/membership', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/leagues/membership')>()),
  getLeagueMembershipAccess: mocks.getAccess,
}));
vi.mock('@/server/draft/services/DraftSetupConvergenceService', () => ({
  ensureLeagueDraftSetupConverged: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.findLeague, update: mocks.updateLeague },
    leagueSettings: { update: mocks.updateSettings },
    leagueCompetitionAudit: { create: mocks.createAudit },
    leagueMember: { findFirst: mocks.findMember },
    teamAction: { count: mocks.countActions },
    draft: { findUnique: mocks.findDraft },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));
vi.mock('@/lib/leagueMembership', () => ({ listActiveLeagueMembers: vi.fn() }));

import { PUT } from '@/app/api/leagues/[id]/settings/route';

const baseSettings = {
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
  waiverRule: 'ROLLING',
  faabBudget: null as number | null,
  startAt: new Date('2026-08-15T09:00:00.000Z'),
  timeZone: 'Australia/Melbourne',
  locked: false,
  scoringMode: 'H2H_EACH_CATEGORY',
  fixtureGenerationMode: 'AUTOMATIC',
  leagueFormat: 'STANDARD',
  bloodsuckerMemberId: null as string | null,
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
};

let stored: typeof baseSettings;

function storedLeague() {
  return {
    id: 'league-1',
    name: 'Statly Premier League',
    inviteCode: 'CODE1234',
    categoriesJson: REAL_DATA_NINE_CATEGORY_PRESET,
    _count: { members: 8 },
    settings: stored,
    members: [
      { id: 'member-1', teamName: 'Owner Team', isActive: true, status: 'ACTIVE' },
      { id: 'member-2', teamName: 'Biters', isActive: true, status: 'ACTIVE' },
    ],
  };
}

async function put(body: unknown) {
  const response = await PUT(
    new NextRequest('http://localhost/api/leagues/league-1/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: 'league-1' }) }
  );
  return { status: response.status, json: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  stored = { ...baseSettings };
  mocks.authenticate.mockResolvedValue('owner-user');
  mocks.getAccess.mockResolvedValue({ isMember: true, canManage: true, memberId: 'member-1' });
  mocks.findLeague.mockImplementation(async () => storedLeague());
  // The route builds the writes, then runs them in one transaction; apply settings writes then.
  mocks.updateSettings.mockImplementation(({ data }) => ({
    apply: () => Object.assign(stored, data),
  }));
  mocks.transaction.mockImplementation(async (writes: Array<{ apply?: () => void }>) => {
    writes.forEach((write) => write?.apply?.());
    return writes;
  });
  mocks.createAudit.mockImplementation((args) => args);
  mocks.findMember.mockResolvedValue({ isActive: true, status: 'ACTIVE' });
  mocks.countActions.mockResolvedValue(0);
  mocks.findDraft.mockResolvedValue({ status: 'SCHEDULED' });
});

describe('league format settings', () => {
  it.each([
    ['STANDARD', 'H2H_EACH_CATEGORY'],
    ['STANDARD', 'H2H_MOST_CATEGORIES'],
    ['BLOODSUCKER', 'H2H_EACH_CATEGORY'],
    ['BLOODSUCKER', 'H2H_MOST_CATEGORIES'],
  ])('saves and reads back %s with %s unchanged (BR-01)', async (leagueFormat, scoringMode) => {
    const bloodsuckerMemberId = leagueFormat === 'BLOODSUCKER' ? 'member-2' : null;
    const { status, json } = await put({
      scoring: { scoringMode },
      format: { leagueFormat, bloodsuckerMemberId },
    });

    expect(status).toBe(200);
    expect(json.data.scoring.scoringMode).toBe(scoringMode);
    expect(json.data.format).toEqual({
      leagueFormat,
      bloodsuckerMemberId,
      candidates: [
        { memberId: 'member-1', teamName: 'Owner Team' },
        { memberId: 'member-2', teamName: 'Biters' },
      ],
    });
  });

  it.each([
    ['a FAAB budget', { waiver: { faabBudget: 100 } }],
    ['weekly waivers', { waiver: { waiverRule: 'weekly' } }],
  ])('refuses a Bloodsucker league with %s (BR-03)', async (_label, waiver) => {
    const { status, json } = await put({ ...waiver, format: { leagueFormat: 'BLOODSUCKER' } });

    expect(status).toBe(400);
    expect(json.code).toBe('BLOODSUCKER_REQUIRES_ROLLING');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('refuses turning FAAB on once the league is already Bloodsucker', async () => {
    stored.leagueFormat = 'BLOODSUCKER';

    const { status, json } = await put({ waiver: { faabBudget: 50 } });

    expect(status).toBe(400);
    expect(json.code).toBe('BLOODSUCKER_REQUIRES_ROLLING');
  });

  it('refuses a Bloodsucker who is not an active member of the league (BR-04a)', async () => {
    mocks.findMember.mockResolvedValue({ isActive: false, status: 'REMOVED' });

    const { status } = await put({
      format: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-9' },
    });

    expect(status).toBe(400);
    expect(mocks.findMember).toHaveBeenCalledWith({
      where: { id: 'member-9', leagueId: 'league-1' },
      select: { isActive: true, status: true },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('refuses resending a Bloodsucker who has since left, while the draft is editable', async () => {
    Object.assign(stored, { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' });
    mocks.findMember.mockResolvedValue({ isActive: false, status: 'REMOVED' });

    const { status } = await put({
      format: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' },
    });

    expect(status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('audits a format or Bloodsucker change with the actor, before and after', async () => {
    await put({ format: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' } });

    expect(mocks.createAudit).toHaveBeenCalledWith({
      data: {
        leagueId: 'league-1',
        actorMemberId: 'member-1',
        eventType: 'LEAGUE_FORMAT_CHANGED',
        payloadJson: {
          reason: 'SETTINGS_UPDATED',
          before: { leagueFormat: 'STANDARD', bloodsuckerMemberId: null },
          after: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' },
        },
      },
    });
  });

  it('writes no audit row when the format is resent unchanged', async () => {
    const { status } = await put({
      format: { leagueFormat: 'STANDARD', bloodsuckerMemberId: null },
    });

    expect(status).toBe(200);
    expect(mocks.createAudit).not.toHaveBeenCalled();
  });

  it('clears the Bloodsucker when the league goes back to standard', async () => {
    Object.assign(stored, { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' });

    const { json } = await put({ format: { leagueFormat: 'STANDARD' } });

    expect(json.data.format).toMatchObject({ leagueFormat: 'STANDARD', bloodsuckerMemberId: null });
  });

  describe('after the draft leaves SCHEDULED (BR-05)', () => {
    beforeEach(() => {
      Object.assign(stored, { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' });
      mocks.findDraft.mockResolvedValue({ status: 'LIVE' });
    });

    it.each([
      ['the format', { leagueFormat: 'STANDARD' }],
      ['the Bloodsucker', { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-1' }],
    ])('refuses a change to %s with 409 DRAFT_STRUCTURE_LOCKED', async (_label, format) => {
      const { status, json } = await put({ format });

      expect(status).toBe(409);
      expect(json.code).toBe('DRAFT_STRUCTURE_LOCKED');
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it('accepts the same values resent', async () => {
      const { status } = await put({
        format: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' },
      });

      expect(status).toBe(200);
      expect(mocks.createAudit).not.toHaveBeenCalled();
    });
  });
});
