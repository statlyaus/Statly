import { DraftStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { leagueDraftProvisioningService } from '@/server/draft/services/LeagueDraftProvisioningService';

import type { DevFixtureScenarioManifest, DevFixtureStepResult } from '../core/types';

function expectedSlots(count: number) {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function slotsAreContiguous(slots: number[], expectedCount: number) {
  const sortedSlots = [...slots].sort((left, right) => left - right);
  return (
    sortedSlots.length === expectedCount && sortedSlots.every((slot, index) => slot === index + 1)
  );
}

async function resetCorruptLockedFixtureDraft(input: {
  leagueId: string;
  manifest: DevFixtureScenarioManifest;
}): Promise<DevFixtureStepResult | null> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    include: {
      members: {
        select: {
          id: true,
          draftSlot: true,
        },
      },
      drafts: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        include: {
          orders: {
            select: {
              memberId: true,
              slot: true,
            },
            orderBy: { slot: 'asc' },
          },
        },
      },
    },
  });
  const draft = league?.drafts[0] ?? null;
  if (!league || !draft || draft.status === DraftStatus.SCHEDULED) {
    return null;
  }

  const memberIds = new Set(league.members.map((member) => member.id));
  const memberSlots = league.members
    .map((member) => member.draftSlot)
    .filter((slot): slot is number => typeof slot === 'number');
  const draftSlots = draft.orders.map((order) => order.slot);
  const expectedTotalPicks =
    input.manifest.teamsPerLeague * (input.manifest.rosterSize + input.manifest.benchSize);
  const draftOrderMatchesMembers =
    draft.orders.length === league.members.length &&
    draft.orders.every((order) => memberIds.has(order.memberId));

  const needsReset =
    league.members.length === input.manifest.teamsPerLeague &&
    (!slotsAreContiguous(memberSlots, input.manifest.teamsPerLeague) ||
      !slotsAreContiguous(draftSlots, input.manifest.teamsPerLeague) ||
      !draftOrderMatchesMembers ||
      draft.totalPicks !== expectedTotalPicks);

  if (!needsReset) {
    return null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.draftEvent.deleteMany({ where: { draftId: draft.id } });
    await tx.draftWatchlist.deleteMany({ where: { draftId: draft.id } });
    await tx.preDraftQueue.deleteMany({ where: { draftId: draft.id } });
    await tx.lobbyActivity.deleteMany({ where: { draftId: draft.id } });
    await tx.pick.deleteMany({ where: { draftId: draft.id } });
    await tx.draftOrder.deleteMany({ where: { draftId: draft.id } });
    await tx.draft.delete({ where: { id: draft.id } });
  });

  return {
    name: `draft ${input.leagueId} repair`,
    status: 'updated',
    detail: `Reset corrupt locked fixture draft ${draft.id} before reprovisioning.`,
  };
}

export async function ensureFixtureDrafts(input: {
  manifest: DevFixtureScenarioManifest;
  leagueIds: string[];
}): Promise<DevFixtureStepResult[]> {
  const steps: DevFixtureStepResult[] = [];

  for (const leagueId of input.leagueIds) {
    const repairStep = await resetCorruptLockedFixtureDraft({ leagueId, manifest: input.manifest });
    if (repairStep) {
      steps.push(repairStep);
    }

    const result = await leagueDraftProvisioningService.syncFromLeagueSettings(leagueId);
    steps.push({
      name: `draft ${leagueId}`,
      status: result.status === 'skipped' ? 'skipped' : result.status,
      detail: result.draft
        ? `${result.status} draft ${result.draft.id} (${result.draft.status}).`
        : `Draft provisioning skipped: ${result.reason ?? 'unknown reason'}.`,
    });
  }

  return steps;
}
