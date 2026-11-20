/**
 * Lobby activity retention: the prune-lobby cron deletes LobbyActivity rows older than the retention
 * window, keeps newer ones, and reports the number it actually deleted.
 */
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as pruneLobbyCron } from '@/app/api/cron/prune-lobby/route';
import { prisma } from '@/lib/prisma';
import { pruneLobbyActivity } from '@/server/draft/lobbyActivityRetention';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';
import { activateLeagueSeason } from './helpers/leagueSeason';

const LEAGUE = 'int-lobby-prune-league';
const SETTINGS = 'int-lobby-prune-settings';
const USER = 'int-lobby-prune-user';
const MEMBER = 'int-lobby-prune-member';
const DRAFT = 'int-lobby-prune-draft';
const OLD = 'int-lobby-prune-old';
const RECENT = 'int-lobby-prune-recent';
const DAY_MS = 24 * 60 * 60 * 1000;

async function removeFixture() {
  await deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: [],
    settingsIds: [SETTINGS],
    userIds: [USER],
  });
}

async function seed() {
  await prisma.user.create({
    data: { id: USER, email: `${USER}@example.test`, passwordHash: 'test', displayName: USER },
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 22,
      benchSize: 4,
      maxTeams: 12,
      pickSeconds: 60,
      draftType: 'SNAKE',
      startAt: new Date('2026-07-24T00:00:00.000Z'),
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Lobby Prune',
      inviteCode: 'LOBPRUN1',
      ownerId: USER,
      settingsId: SETTINGS,
    },
  });
  await activateLeagueSeason(prisma, LEAGUE);
  await prisma.leagueMember.create({
    data: { id: MEMBER, leagueId: LEAGUE, userId: USER, role: 'OWNER', teamName: 'Team' },
  });
  await prisma.draft.create({
    data: { id: DRAFT, leagueId: LEAGUE, status: 'COMPLETED', totalPicks: 1 },
  });
  const now = Date.now();
  await prisma.lobbyActivity.createMany({
    data: [
      {
        id: OLD,
        draftId: DRAFT,
        memberId: MEMBER,
        action: 'QUEUE_UPDATED',
        timestamp: new Date(now - 40 * DAY_MS),
      },
      {
        id: RECENT,
        draftId: DRAFT,
        memberId: MEMBER,
        action: 'QUEUE_UPDATED',
        timestamp: new Date(now - DAY_MS),
      },
    ],
  });
}

async function remainingIds() {
  const rows = await prisma.lobbyActivity.findMany({
    where: { draftId: DRAFT },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((row) => row.id);
}

function cronRequest() {
  return new NextRequest('http://localhost/api/cron/prune-lobby', {
    headers: { authorization: 'Bearer cron-secret' },
  });
}

describe('lobby activity retention', () => {
  beforeEach(async () => {
    await removeFixture();
    await seed();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await removeFixture();
    await prisma.$disconnect();
  });

  it('deletes rows older than the retention and reports the deleted count', async () => {
    vi.stubEnv('LOBBY_ACTIVITY_RETENTION_DAYS', '30');

    const response = await pruneLobbyCron(cronRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, deleted: 1, retentionDays: 30 });
    expect(await remainingIds()).toEqual([RECENT]);
  });

  it('refuses an invalid retention without deleting anything', async () => {
    vi.stubEnv('LOBBY_ACTIVITY_RETENTION_DAYS', '0');

    const response = await pruneLobbyCron(cronRequest());

    expect(response.status).toBe(400);
    expect(await remainingIds()).toEqual([OLD, RECENT]);
  });

  it('counts without deleting on a dry run', async () => {
    const result = await pruneLobbyActivity(30, { dryRun: true });

    expect(result.count).toBe(1);
    expect(await remainingIds()).toEqual([OLD, RECENT]);
  });
});
