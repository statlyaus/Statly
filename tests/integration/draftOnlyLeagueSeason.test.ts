import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const authMocks = vi.hoisted(() => ({ getAuthenticatedUserId: vi.fn() }));
vi.mock('@/lib/serverAuth', () => authMocks);
vi.mock('@/server/queue/draftQueue', () => ({ scheduleDraftStart: vi.fn() }));
vi.mock('@/lib/reminders', () => ({ createDraftReminders: vi.fn() }));

import { POST as createTestDraft } from '@/app/api/create-test-draft/route';
import { POST as createDraft } from '@/app/api/drafts/route';
import { prisma } from '@/lib/prisma';
import { requireActiveSeasonId } from '@/server/leagues/activeSeason';
import { defaultLeagueSeasonYear } from '@/server/leagues/seasonYear';

// A draft's final pick seeds waiver priority in the league's active season, so the leagues the test
// draft tool and the standalone draft path create need one, as league creation gives every league.
const createdLeagueIds: string[] = [];
const OWNER_USER_ID = 'integration-draft-only-owner';

async function removeLeague(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settingsId: true, members: { select: { userId: true } } },
  });
  if (!league) return;
  const memberUserIds = league.members.map((member) => member.userId);
  await prisma.$transaction(async (tx) => {
    await tx.draftOrder.deleteMany({ where: { draft: { leagueId } } });
    await tx.draft.deleteMany({ where: { leagueId } });
    await tx.leagueMember.deleteMany({ where: { leagueId } });
    await tx.league.update({ where: { id: leagueId }, data: { activeSeasonId: null } });
    await tx.league.delete({ where: { id: leagueId } });
    await tx.leagueSettings.deleteMany({ where: { id: league.settingsId } });
    await tx.user.deleteMany({
      where: { id: { in: memberUserIds }, leagues: { none: {} }, ownedLeagues: { none: {} } },
    });
  });
}

async function expectActiveSeason(leagueId: string, startAt: Date): Promise<void> {
  const seasonId = await requireActiveSeasonId(prisma, leagueId);
  const season = await prisma.leagueSeason.findUniqueOrThrow({ where: { id: seasonId } });
  expect(season).toMatchObject({ leagueId, year: defaultLeagueSeasonYear(startAt) });
}

describe('draft-only league creation', () => {
  beforeAll(async () => {
    vi.stubEnv('STATLY_ENABLE_DEV_TOOLS', 'true');
    await prisma.user.upsert({
      where: { id: OWNER_USER_ID },
      update: {},
      create: {
        id: OWNER_USER_ID,
        email: `${OWNER_USER_ID}@statly.local`,
        passwordHash: 'integration-only',
        displayName: 'Integration Draft-Only Owner',
      },
    });
  });

  afterEach(() => {
    authMocks.getAuthenticatedUserId.mockReset();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const leagueId of createdLeagueIds) await removeLeague(leagueId);
    await prisma.user.deleteMany({ where: { id: OWNER_USER_ID, ownedLeagues: { none: {} } } });
  });

  it('gives a test draft league an active season', async () => {
    const response = await createTestDraft(
      new NextRequest('http://localhost/api/create-test-draft', {
        method: 'POST',
        body: JSON.stringify({ mode: 'quick-completion' }),
      })
    );
    expect(response.status).toBe(200);
    const { data } = await response.json();
    createdLeagueIds.push(data.draft.leagueId);

    await expectActiveSeason(data.draft.leagueId, new Date(data.draft.draftStartTime));
  });

  it('gives a standalone draft league an active season', async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValue(OWNER_USER_ID);
    const response = await createDraft(
      new NextRequest('http://localhost/api/drafts', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Integration Draft-Only League',
          leagueSize: 4,
          draftType: 'snake',
          timePerPick: 60,
          leagueData: {
            name: 'Integration Draft-Only League',
            maxTeams: 4,
            categories: [],
            ownerId: OWNER_USER_ID,
          },
        }),
      })
    );
    expect(response.status).toBe(201);
    const { data } = await response.json();
    createdLeagueIds.push(data.leagueId);

    await expectActiveSeason(data.leagueId, new Date(data.startAt));
  });
});
