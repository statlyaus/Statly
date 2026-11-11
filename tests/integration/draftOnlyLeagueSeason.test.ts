import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { POST as createTestDraft } from '@/app/api/create-test-draft/route';
import { prisma } from '@/lib/prisma';
import { requireActiveSeasonId } from '@/server/leagues/activeSeason';
import { defaultLeagueSeasonYear } from '@/server/leagues/seasonYear';

// A draft's final pick seeds waiver priority in the league's active season, so the league the test
// draft tool creates needs one, as league creation gives every league. POST /api/drafts only drafts
// an existing league, so the test tool is the one draft-only league path left.
const createdLeagueIds: string[] = [];

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
  beforeAll(() => {
    vi.stubEnv('STATLY_ENABLE_DEV_TOOLS', 'true');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const leagueId of createdLeagueIds) await removeLeague(leagueId);
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
});
