import { DraftDirection, DraftStatus, DraftType, LeagueRole, PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { expect, test } from '@playwright/test';

import { DEVELOPMENT_AUTH_EMAIL, DEVELOPMENT_AUTH_USER_ID } from '../../src/lib/devAuth';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '../../src/types/fantasyCategories';
import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';

const FIXTURE = {
  draftId: 'cme2etimer0000e2etestdraft',
  leagueId: 'e2e-live-timer-league',
  seasonId: 'e2e-live-timer-season',
  settingsId: 'e2e-live-timer-settings',
  humanMemberId: 'e2e-live-timer-member-human',
  botMemberId: 'e2e-live-timer-member-bot',
  botUserId: 'e2e-live-timer-user-bot',
  queuedPlayerId: 'e2e-live-timer-player-queued',
  fallbackPlayerId: 'e2e-live-timer-player-fallback',
  pickSeconds: 18,
} as const;

type DraftExpiryJob = {
  kind: 'draft:pick-expiry';
  draftId: string;
  leagueId: string;
  schedulingVersion: number;
};

function queueConnection() {
  const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  const redisUrlDatabase = redisUrl.pathname.replace(/^\/+/, '');
  const database = Number(process.env.REDIS_DB ?? (redisUrlDatabase || 0));

  if (!Number.isInteger(database) || database < 0) {
    throw new Error('Draft timer E2E requires a valid non-negative Redis database number');
  }

  return {
    host: process.env.REDIS_HOST ?? redisUrl.hostname,
    port: Number((process.env.REDIS_PORT ?? redisUrl.port) || 6379),
    username: (process.env.REDIS_USERNAME ?? redisUrl.username) || undefined,
    password: (process.env.REDIS_PASSWORD ?? redisUrl.password) || undefined,
    db: database,
  };
}

function timerTextToSeconds(text: string): number {
  const minutes = Number(text.match(/(\d+)m/)?.[1] ?? 0);
  const seconds = Number(text.match(/(\d+)s/)?.[1] ?? 0);
  return minutes * 60 + seconds;
}

async function seedLiveTimerFixture() {
  const prisma = new PrismaClient();
  const startedAt = new Date();
  const deadlineAt = new Date(startedAt.getTime() + FIXTURE.pickSeconds * 1000);

  try {
    await prisma.$transaction(async (tx) => {
      const priorDrafts = await tx.draft.findMany({
        where: { OR: [{ id: FIXTURE.draftId }, { leagueId: FIXTURE.leagueId }] },
        select: { id: true },
      });
      const priorDraftIds = priorDrafts.map(({ id }) => id);
      const memberIds = [FIXTURE.humanMemberId, FIXTURE.botMemberId];

      await tx.leagueRosterPlayer.deleteMany({
        where: {
          OR: [
            { leagueId: FIXTURE.leagueId },
            { memberId: { in: memberIds } },
            ...(priorDraftIds.length > 0 ? [{ draftId: { in: priorDraftIds } }] : []),
          ],
        },
      });
      await tx.leagueRoster.deleteMany({
        where: { OR: [{ leagueId: FIXTURE.leagueId }, { memberId: { in: memberIds } }] },
      });
      await tx.teamAction.deleteMany({
        where: {
          OR: [
            { leagueId: FIXTURE.leagueId },
            { memberId: { in: memberIds } },
            { targetMemberId: { in: memberIds } },
          ],
        },
      });
      await tx.queueItem.deleteMany({ where: { memberId: { in: memberIds } } });

      if (priorDraftIds.length > 0) {
        await tx.draftWatchlist.deleteMany({ where: { draftId: { in: priorDraftIds } } });
        await tx.preDraftQueue.deleteMany({ where: { draftId: { in: priorDraftIds } } });
        await tx.lobbyActivity.deleteMany({ where: { draftId: { in: priorDraftIds } } });
        await tx.draftEvent.deleteMany({ where: { draftId: { in: priorDraftIds } } });
        await tx.pick.deleteMany({ where: { draftId: { in: priorDraftIds } } });
        await tx.draftOrder.deleteMany({ where: { draftId: { in: priorDraftIds } } });
        await tx.draft.deleteMany({ where: { id: { in: priorDraftIds } } });
      }

      await tx.leagueMember.deleteMany({ where: { leagueId: FIXTURE.leagueId } });
      await tx.league.deleteMany({ where: { id: FIXTURE.leagueId } });
      await tx.leagueSettings.deleteMany({ where: { id: FIXTURE.settingsId } });

      await tx.user.upsert({
        where: { id: DEVELOPMENT_AUTH_USER_ID },
        update: {
          email: DEVELOPMENT_AUTH_EMAIL,
          displayName: 'Statly Dev Tester',
          timeZone: 'Australia/Melbourne',
        },
        create: {
          id: DEVELOPMENT_AUTH_USER_ID,
          email: DEVELOPMENT_AUTH_EMAIL,
          passwordHash: 'e2e-dev-user',
          displayName: 'Statly Dev Tester',
          timeZone: 'Australia/Melbourne',
        },
      });
      await tx.user.upsert({
        where: { id: FIXTURE.botUserId },
        update: {
          email: 'e2e-live-timer-bot@statly.local',
          displayName: 'Timer Bot',
          timeZone: 'Australia/Melbourne',
        },
        create: {
          id: FIXTURE.botUserId,
          email: 'e2e-live-timer-bot@statly.local',
          passwordHash: 'e2e-bot-user',
          displayName: 'Timer Bot',
          timeZone: 'Australia/Melbourne',
        },
      });

      await tx.leagueSettings.create({
        data: {
          id: FIXTURE.settingsId,
          rosterSize: 1,
          benchSize: 0,
          maxTeams: 2,
          pickSeconds: FIXTURE.pickSeconds,
          allowAutoPick: true,
          positionLimitsJson: JSON.stringify({}),
          autoPickRulesJson: JSON.stringify({ strategy: 'statly-z' }),
          draftType: DraftType.SNAKE,
          pickOrder: 'MANUAL',
          waiverRule: 'WEEKLY',
          startAt: startedAt,
          timeZone: 'Australia/Melbourne',
          locked: true,
        },
      });
      await tx.league.create({
        data: {
          id: FIXTURE.leagueId,
          name: 'Live Timer Reliability League',
          inviteCode: 'E2ETIMER',
          ownerId: DEVELOPMENT_AUTH_USER_ID,
          settingsId: FIXTURE.settingsId,
          categoriesJson: JSON.stringify([...REAL_DATA_NINE_CATEGORY_PRESET]),
          createdAt: startedAt,
        },
      });
      await tx.leagueSeason.create({
        data: {
          id: FIXTURE.seasonId,
          leagueId: FIXTURE.leagueId,
          label: '2026 season',
          year: 2026,
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          endsAt: new Date('2026-12-31T23:59:59.999Z'),
        },
      });
      await tx.league.update({
        where: { id: FIXTURE.leagueId },
        data: { activeSeasonId: FIXTURE.seasonId },
      });
      await tx.leagueMember.createMany({
        data: [
          {
            id: FIXTURE.humanMemberId,
            leagueId: FIXTURE.leagueId,
            userId: DEVELOPMENT_AUTH_USER_ID,
            role: LeagueRole.OWNER,
            teamName: 'Clock Watchers',
            draftSlot: 1,
            joinedAt: startedAt,
          },
          {
            id: FIXTURE.botMemberId,
            leagueId: FIXTURE.leagueId,
            userId: FIXTURE.botUserId,
            role: LeagueRole.MANAGER,
            teamName: 'Timer Bots',
            draftSlot: 2,
            joinedAt: startedAt,
          },
        ],
      });
      await tx.player.upsert({
        where: { id: FIXTURE.queuedPlayerId },
        update: {
          name: 'Queued Timer Player',
          club: 'Adelaide',
          position: 'MID',
          active: true,
        },
        create: {
          id: FIXTURE.queuedPlayerId,
          name: 'Queued Timer Player',
          club: 'Adelaide',
          position: 'MID',
          active: true,
        },
      });
      await tx.player.upsert({
        where: { id: FIXTURE.fallbackPlayerId },
        update: {
          name: 'Fallback Timer Player',
          club: 'Brisbane',
          position: 'DEF',
          active: true,
        },
        create: {
          id: FIXTURE.fallbackPlayerId,
          name: 'Fallback Timer Player',
          club: 'Brisbane',
          position: 'DEF',
          active: true,
        },
      });
      await tx.draft.create({
        data: {
          id: FIXTURE.draftId,
          leagueId: FIXTURE.leagueId,
          status: DraftStatus.LIVE,
          currentPick: 1,
          totalPicks: 2,
          round: 1,
          direction: DraftDirection.FORWARD,
          lobbyStatus: 'LIVE',
          lobbyOpenAt: startedAt,
          startedAt,
          pickStartedAt: startedAt,
          pickDeadlineAt: deadlineAt,
          pausedRemainingSeconds: null,
          schedulingVersion: 1,
        },
      });
      await tx.draftOrder.createMany({
        data: [
          { draftId: FIXTURE.draftId, memberId: FIXTURE.humanMemberId, slot: 1 },
          { draftId: FIXTURE.draftId, memberId: FIXTURE.botMemberId, slot: 2 },
        ],
      });
      await tx.preDraftQueue.create({
        data: {
          draftId: FIXTURE.draftId,
          memberId: FIXTURE.humanMemberId,
          playerId: FIXTURE.queuedPlayerId,
          rank: 1,
        },
      });
    });

    const queue = new Queue<DraftExpiryJob>('draftQueue', { connection: queueConnection() });
    try {
      await queue.add(
        'draft:pick-expiry',
        {
          kind: 'draft:pick-expiry',
          draftId: FIXTURE.draftId,
          leagueId: FIXTURE.leagueId,
          schedulingVersion: 1,
        },
        {
          delay: Math.max(0, deadlineAt.getTime() - Date.now()),
          jobId: `${FIXTURE.draftId}-pick-expiry-v1`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: true,
        }
      );
    } finally {
      await queue.close();
    }

    return { deadlineAt };
  } finally {
    await prisma.$disconnect();
  }
}

test.skip(
  process.env.PLAYWRIGHT_WITH_DRAFT_WORKER !== 'true',
  'Requires the isolated draft-worker E2E topology'
);

test(
  'keeps one canonical clock through pause, resume, and worker expiry',
  { tag: '@draft-worker' },
  async ({ page }) => {
    test.setTimeout(60_000);

    const runtimeErrors = collectRuntimeErrors(page);
    await authenticateAsDevelopmentUser(page);
    const { deadlineAt } = await seedLiveTimerFixture();

    await page.goto(`/drafts/${FIXTURE.draftId}`);
    await expect(page.locator('body')).toContainText('Pick 1 of 2');
    await expectNoAppErrorBoundary(page);

    const timer = page.getByRole('timer');
    await expect(timer).toBeVisible();
    await expect(timer).not.toContainText('Syncing clock');

    const firstTimerValue = timerTextToSeconds(await timer.innerText());
    expect(firstTimerValue).toBeGreaterThan(0);
    expect(firstTimerValue).toBeLessThanOrEqual(
      Math.ceil((deadlineAt.getTime() - Date.now()) / 1000) + 1
    );

    await expect
      .poll(async () => timerTextToSeconds(await timer.innerText()), { timeout: 4_000 })
      .toBeLessThan(firstTimerValue);

    const pauseResponse = await page.request.post(`/api/drafts/${FIXTURE.draftId}/pause`);
    expect(pauseResponse.ok()).toBe(true);
    await expect(page.locator('body')).toContainText('Draft paused');

    const pausedTimerValue = timerTextToSeconds(await timer.innerText());
    expect(pausedTimerValue).toBeGreaterThan(0);
    await page.waitForTimeout(1_500);
    expect(timerTextToSeconds(await timer.innerText())).toBe(pausedTimerValue);

    const resumeResponse = await page.request.post(`/api/drafts/${FIXTURE.draftId}/resume`);
    expect(resumeResponse.ok()).toBe(true);
    await expect(page.locator('body')).toContainText('Pick 1');
    await expect
      .poll(async () => timerTextToSeconds(await timer.innerText()), { timeout: 4_000 })
      .toBeLessThan(pausedTimerValue);

    await expect(page.locator('body')).toContainText('Pick 2 of 2', { timeout: 25_000 });
    await expectNoAppErrorBoundary(page);

    const picksResponse = await page.request.get(
      `/api/drafts/${FIXTURE.draftId}/picks?pageSize=10`
    );
    expect(picksResponse.ok()).toBe(true);
    const picksPayload = await picksResponse.json();
    expect(picksPayload.data.picks).toHaveLength(1);
    expect(picksPayload.data.picks[0]).toMatchObject({
      overall: 1,
      auto: true,
      player: { id: FIXTURE.queuedPlayerId },
    });
    expect(picksPayload.data.draftState.currentPick).toBe(2);
    expect(picksPayload.data.draftState.clock.status).toBe('LIVE');
    expect(picksPayload.data.draftState.clock.revision).toBe(4);
    expect(runtimeErrors).toEqual([]);
  }
);
