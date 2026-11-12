import { DraftDirection, DraftStatus, DraftType } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { draftRepository } from '@/server/draft/repository/DraftRepository';

const OWNER_ID = 'integration-outbox-fairness-owner';
const FAILING = 'integration-outbox-fairness-failing';
const HEALTHY = 'integration-outbox-fairness-healthy';
const FIXTURES = [FAILING, HEALTHY];

async function removeFixture(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.draft.deleteMany({ where: { id: { in: FIXTURES } } });
    await tx.league.deleteMany({ where: { id: { in: FIXTURES } } });
    await tx.leagueSettings.deleteMany({ where: { id: { in: FIXTURES } } });
    await tx.user.deleteMany({ where: { id: OWNER_ID } });
  });
}

async function seedDraft(id: string, inviteCode: string): Promise<void> {
  await prisma.leagueSettings.create({
    data: {
      id,
      rosterSize: 22,
      benchSize: 0,
      maxTeams: 12,
      pickSeconds: 120,
      allowAutoPick: true,
      draftType: DraftType.SNAKE,
    },
  });
  await prisma.league.create({
    data: { id, name: id, inviteCode, ownerId: OWNER_ID, settingsId: id },
  });
  await prisma.draft.create({
    data: {
      id,
      leagueId: id,
      status: DraftStatus.SCHEDULED,
      currentPick: 1,
      totalPicks: 264,
      round: 1,
      direction: DraftDirection.FORWARD,
    },
  });
}

describe('draft outbox batch fairness', () => {
  beforeEach(async () => {
    await removeFixture();
    await prisma.user.create({
      data: {
        id: OWNER_ID,
        email: 'integration-outbox-fairness@example.test',
        passwordHash: 'test',
        displayName: 'Outbox Owner',
      },
    });
    await seedDraft(FAILING, 'INTOBX01');
    await seedDraft(HEALTHY, 'INTOBX02');
  });

  afterAll(removeFixture);

  it('picks a healthy draft ahead of events that keep failing, without dropping them', async () => {
    const limit = 3;
    // Enough failing events to fill the whole batch, all older than the healthy draft's event.
    await prisma.draftEvent.createMany({
      data: [1, 2, 3].map((sequence) => ({
        draftId: FAILING,
        leagueId: FAILING,
        event: 'draft:paused',
        sequence,
        attempts: 5,
        lastError: 'redis down',
        createdAt: new Date(`2026-06-09T10:00:0${sequence}.000Z`),
      })),
    });
    await prisma.draftEvent.create({
      data: {
        draftId: HEALTHY,
        leagueId: HEALTHY,
        event: 'draft:paused',
        sequence: 9,
        createdAt: new Date('2026-06-09T11:00:00.000Z'),
      },
    });
    // Other files share this database; leave room for any pending events they left behind.
    const others = await prisma.draftEvent.count({
      where: { publishedAt: null, draftId: { notIn: FIXTURES } },
    });

    const batch = await prisma.$transaction((tx) =>
      draftRepository.listPendingDraftEventsBatch(tx, others + limit)
    );
    const ours = batch.filter((event) => FIXTURES.includes(event.draftId));

    expect(ours.map((event) => event.draftId)).toContain(HEALTHY);
    // The failing events are still pending and still picked when there is room.
    expect(ours.filter((event) => event.draftId === FAILING)).toHaveLength(limit - 1);
  });
});
