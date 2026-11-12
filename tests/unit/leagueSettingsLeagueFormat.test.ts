import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

// League format and Bloodsucker settings (#1278, BR-01, BR-03, BR-04a, BR-05); No Losers (#1291).

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
  queryRaw: vi.fn(),
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

// The draft row as the settings locks read it (hasDraftStarted).
function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    status: 'SCHEDULED',
    startedAt: null,
    lobbyStatus: 'COUNTDOWN',
    _count: { picks: 0 },
    ...overrides,
  };
}
const liveDraft = draftRow({ status: 'LIVE', startedAt: new Date(), lobbyStatus: 'LIVE' });

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
  mocks.updateSettings.mockImplementation(async ({ data }) => Object.assign(stored, data));
  // The write transaction locks the League row and re-reads the locks before writing.
  mocks.queryRaw.mockImplementation(async () => [
    {
      scoringSettingsLockedAt: stored.scoringSettingsLockedAt,
      competitionPublishedAt: null,
    },
  ]);
  mocks.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) =>
    run({
      $queryRaw: mocks.queryRaw,
      league: { update: mocks.updateLeague },
      leagueSettings: { update: mocks.updateSettings },
      leagueCompetitionAudit: { create: mocks.createAudit },
      draft: { findUnique: mocks.findDraft },
    })
  );
  mocks.createAudit.mockImplementation((args) => args);
  mocks.findMember.mockResolvedValue({ isActive: true, status: 'ACTIVE' });
  mocks.countActions.mockResolvedValue(0);
  mocks.findDraft.mockResolvedValue(draftRow());
  vi.stubEnv('NEXT_PUBLIC_STATLY_ENABLE_BLOODSUCKER', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('league format settings', () => {
  it.each([
    ['STANDARD', 'H2H_EACH_CATEGORY'],
    ['STANDARD', 'H2H_MOST_CATEGORIES'],
    ['BLOODSUCKER', 'H2H_EACH_CATEGORY'],
    ['BLOODSUCKER', 'H2H_MOST_CATEGORIES'],
    ['NO_LOSERS', 'H2H_EACH_CATEGORY'],
    ['NO_LOSERS', 'H2H_MOST_CATEGORIES'],
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

  it('keeps weekly waivers and FAAB for a No Losers league (No Losers BR-03)', async () => {
    const { status, json } = await put({
      waiver: { waiverRule: 'weekly', faabBudget: 100 },
      format: { leagueFormat: 'NO_LOSERS' },
    });

    expect(status).toBe(200);
    expect(json.data.format.leagueFormat).toBe('NO_LOSERS');
    expect(stored).toMatchObject({ waiverRule: 'WEEKLY', faabBudget: 100 });
  });

  it('clears the Bloodsucker and audits the change when the league becomes No Losers', async () => {
    Object.assign(stored, { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' });

    const { json } = await put({
      format: { leagueFormat: 'NO_LOSERS', bloodsuckerMemberId: 'member-2' },
    });

    expect(json.data.format).toMatchObject({
      leagueFormat: 'NO_LOSERS',
      bloodsuckerMemberId: null,
    });
    expect(mocks.createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'LEAGUE_FORMAT_CHANGED',
        payloadJson: {
          reason: 'SETTINGS_UPDATED',
          before: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' },
          after: { leagueFormat: 'NO_LOSERS', bloodsuckerMemberId: null },
        },
      }),
    });
  });

  describe('a No Losers league after the draft leaves SCHEDULED (No Losers BR-02)', () => {
    beforeEach(() => {
      stored.leagueFormat = 'NO_LOSERS';
      mocks.findDraft.mockResolvedValue(liveDraft);
    });

    it.each(['STANDARD', 'BLOODSUCKER'])(
      'refuses a change to %s with 409 DRAFT_STRUCTURE_LOCKED',
      async (leagueFormat) => {
        const { status, json } = await put({ format: { leagueFormat } });

        expect(status).toBe(409);
        expect(json.code).toBe('DRAFT_STRUCTURE_LOCKED');
        expect(mocks.transaction).not.toHaveBeenCalled();
      }
    );

    it('accepts NO_LOSERS resent', async () => {
      const { status } = await put({ format: { leagueFormat: 'NO_LOSERS' } });

      expect(status).toBe(200);
      expect(mocks.createAudit).not.toHaveBeenCalled();
    });

    it('refuses a change from STANDARD to NO_LOSERS', async () => {
      stored.leagueFormat = 'STANDARD';

      const { status, json } = await put({ format: { leagueFormat: 'NO_LOSERS' } });

      expect(status).toBe(409);
      expect(json.code).toBe('DRAFT_STRUCTURE_LOCKED');
    });
  });

  describe('after the competition is published, before the draft starts', () => {
    beforeEach(() => {
      stored.scoringSettingsLockedAt = new Date('2026-08-01T00:00:00.000Z') as never;
    });

    it.each([
      ['STANDARD', 'NO_LOSERS'],
      ['NO_LOSERS', 'STANDARD'],
      ['NO_LOSERS', 'BLOODSUCKER'],
    ])(
      'refuses %s to %s with 409 SCORING_SETTINGS_LOCKED: No Losers changes scoring',
      async (from, to) => {
        stored.leagueFormat = from;
        const bloodsuckerMemberId = to === 'BLOODSUCKER' ? 'member-2' : null;

        const { status, json } = await put({ format: { leagueFormat: to, bloodsuckerMemberId } });

        expect(status).toBe(409);
        expect(json.code).toBe('SCORING_SETTINGS_LOCKED');
        expect(mocks.transaction).not.toHaveBeenCalled();
      }
    );

    it('still accepts STANDARD to BLOODSUCKER, which is draft structure only', async () => {
      const { status } = await put({
        format: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' },
      });

      expect(status).toBe(200);
      expect(stored.leagueFormat).toBe('BLOODSUCKER');
    });
  });

  describe('after the draft leaves SCHEDULED (BR-05)', () => {
    beforeEach(() => {
      Object.assign(stored, { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' });
      mocks.findDraft.mockResolvedValue(liveDraft);
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
  describe('a LIVE draft rescheduled back to SCHEDULED with its picks kept', () => {
    beforeEach(() => {
      Object.assign(stored, { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' });
      mocks.findDraft.mockResolvedValue(draftRow({ _count: { picks: 3 } }));
    });

    it.each([
      ['the format', { leagueFormat: 'STANDARD' }],
      ['the Bloodsucker', { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-1' }],
    ])('still refuses a change to %s with 409 DRAFT_STRUCTURE_LOCKED', async (_label, format) => {
      const { status, json } = await put({ format });

      expect(status).toBe(409);
      expect(json.code).toBe('DRAFT_STRUCTURE_LOCKED');
      expect(mocks.transaction).not.toHaveBeenCalled();
    });
  });

  describe('a draft that starts between the lock check and the write', () => {
    beforeEach(() => {
      // First read (before the transaction): not started. Re-read under the row lock: started.
      mocks.findDraft.mockResolvedValueOnce(draftRow()).mockResolvedValue(liveDraft);
    });

    it('re-checks under the League row lock and refuses the format change', async () => {
      const { status, json } = await put({
        format: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' },
      });

      expect(status).toBe(409);
      expect(json.code).toBe('DRAFT_STRUCTURE_LOCKED');
      expect(mocks.queryRaw).toHaveBeenCalled();
      expect(mocks.updateSettings).not.toHaveBeenCalled();
      expect(mocks.createAudit).not.toHaveBeenCalled();
      expect(stored.leagueFormat).toBe('STANDARD');
    });

    it('still saves a change that the draft lock does not cover', async () => {
      const { status, json } = await put({ league: { name: 'Renamed League' } });

      expect(status).toBe(200);
      expect(mocks.updateSettings).toHaveBeenCalled();
      expect(json.data.locks.draftStructure).toMatch(/draft has started/);
    });
  });

  describe('while Bloodsucker is held back (flag off)', () => {
    beforeEach(() => {
      vi.stubEnv('NEXT_PUBLIC_STATLY_ENABLE_BLOODSUCKER', '');
    });

    it('refuses switching a league to Bloodsucker with 400 BLOODSUCKER_UNAVAILABLE', async () => {
      const { status, json } = await put({
        format: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' },
      });

      expect(status).toBe(400);
      expect(json.code).toBe('BLOODSUCKER_UNAVAILABLE');
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it('lets a league already stored as Bloodsucker keep and edit it', async () => {
      Object.assign(stored, { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' });

      const { status, json } = await put({
        format: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-1' },
      });

      expect(status).toBe(200);
      expect(json.data.format).toMatchObject({
        leagueFormat: 'BLOODSUCKER',
        bloodsuckerMemberId: 'member-1',
      });
    });
  });
});
