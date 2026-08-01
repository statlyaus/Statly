import { DraftDirection, DraftStatus, DraftType } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import {
  DraftClockConvergenceService,
  hasValidLiveDraftClockAnchors,
} from '@/server/draft/services/DraftClockConvergenceService';

const FIXTURE = {
  leagueId: 'integration-clock-convergence-league',
  draftId: 'integration-clock-convergence-draft',
  settingsId: 'integration-clock-convergence-settings',
} as const;

const startedAt = new Date('2026-06-09T10:00:00.000Z');

async function removeFixture(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.draft.deleteMany({ where: { id: FIXTURE.draftId } });
    await tx.league.deleteMany({ where: { id: FIXTURE.leagueId } });
    await tx.leagueSettings.deleteMany({ where: { id: FIXTURE.settingsId } });
  });
}

async function seedMalformedLiveDraft(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.leagueSettings.create({
      data: {
        id: FIXTURE.settingsId,
        rosterSize: 22,
        benchSize: 0,
        maxTeams: 12,
        pickSeconds: 120,
        allowAutoPick: true,
        draftType: DraftType.SNAKE,
      },
    });
    await tx.league.create({
      data: {
        id: FIXTURE.leagueId,
        name: 'Integration Clock Convergence League',
        inviteCode: 'INTCLK01',
        ownerId: 'integration-clock-owner',
        settingsId: FIXTURE.settingsId,
      },
    });
    await tx.draft.create({
      data: {
        id: FIXTURE.draftId,
        leagueId: FIXTURE.leagueId,
        status: DraftStatus.LIVE,
        currentPick: 1,
        totalPicks: 264,
        round: 1,
        direction: DraftDirection.FORWARD,
        startedAt,
        pickStartedAt: null,
        pickDeadlineAt: null,
        pausedRemainingSeconds: 120,
        schedulingVersion: 4,
      },
    });
  });
}

describe('draft clock convergence compare-and-swap', () => {
  beforeEach(async () => {
    await removeFixture();
    await seedMalformedLiveDraft();
  });

  afterAll(async () => {
    await removeFixture();
  });

  it('allows concurrent repair attempts to advance the durable revision exactly once', async () => {
    const services = [new DraftClockConvergenceService(), new DraftClockConvergenceService()];

    const results = await Promise.all(
      services.map((service) =>
        service.convergeDraft(FIXTURE.draftId, new Date('2026-06-09T10:10:00.000Z'))
      )
    );
    const persisted = await prisma.draft.findUniqueOrThrow({ where: { id: FIXTURE.draftId } });

    expect(results.filter((result) => result.repaired)).toHaveLength(1);
    expect(results.every((result) => result.schedule !== null)).toBe(true);
    expect(results.every((result) => hasValidLiveDraftClockAnchors(result.schedule!))).toBe(true);
    expect(results.map((result) => result.schedule?.schedulingVersion)).toEqual([5, 5]);
    expect(persisted).toMatchObject({
      status: DraftStatus.LIVE,
      schedulingVersion: 5,
      pickStartedAt: startedAt,
      pickDeadlineAt: new Date('2026-06-09T10:02:00.000Z'),
      pausedRemainingSeconds: null,
    });
  });
});
