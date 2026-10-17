import { DraftDirection, DraftStatus, type Prisma, type PrismaClient } from '@prisma/client';

import { normalizeDraftPositionLimits } from '@/lib/draftSettings';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { isActivePrismaMembership } from '@/server/leagues/activeMembership';
import { calculateDraftCapacity } from '@/server/draft/domain/draftCapacity';
import type { DraftOperationalReadiness } from '@/types/draftReadiness';

import { getLeagueDraftOperationalReadiness } from './DraftReadinessService';

type ConvergenceClient = PrismaClient;

// Explicit draft slots are kept, unless an earlier member already holds one. Members without a slot
// take the lowest slot nobody holds, so the result is always unique (DraftOrder @@unique([draftId, slot])).
function assignDraftSlots(draftSlots: Array<number | null>): number[] {
  const used = new Set<number>();
  const explicit = draftSlots.map((slot) => {
    if (slot === null || used.has(slot)) return null;
    used.add(slot);
    return slot;
  });
  let next = 1;
  return explicit.map((slot) => {
    if (slot !== null) return slot;
    while (used.has(next)) next += 1;
    used.add(next);
    return next;
  });
}
export type DraftSetupRecommendedAction = 'AWAIT_EXPLICIT_START' | 'NONE';

export type DraftSetupConvergenceResult = DraftOperationalReadiness & {
  recommendedAction: DraftSetupRecommendedAction;
};

export interface DraftSetupConvergenceInput {
  prismaClient?: ConvergenceClient;
  leagueId: string;
  now?: Date;
}

async function ensureDraftRoomExists(client: ConvergenceClient, leagueId: string) {
  return client.$transaction(async (tx: Prisma.TransactionClient) => {
    const league = await tx.league.findUnique({
      where: { id: leagueId },
      include: {
        settings: true,
        members: {
          where: { isActive: true },
          orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
        },
        drafts: { include: { orders: true, picks: true }, take: 1 },
      },
    });

    if (!league?.settings) {
      return null;
    }

    // A member is in the draft only if its membership is active, not just its isActive flag.
    const members = league.members.filter(isActivePrismaMembership);
    const slots = assignDraftSlots(members.map((member) => member.draftSlot));
    const existingDraft = league.drafts[0] ?? null;
    const activePlayerCount = await tx.player.count({ where: { active: true } });
    const capacity = calculateDraftCapacity({
      teamCount: members.length,
      positionLimits: normalizeDraftPositionLimits(league.settings.positionLimitsJson),
      activePlayerCount,
      existingPickCount: existingDraft?.picks.length ?? 0,
      currentPick: existingDraft?.currentPick,
    });
    const rosterSpots = capacity.rosterSpotsPerTeam;
    const totalPicks = capacity.totalPicks;

    if (existingDraft) {
      if (existingDraft.orders.length === members.length) {
        if (existingDraft.totalPicks !== totalPicks) {
          await tx.draft.update({
            where: { id: existingDraft.id },
            data: { totalPicks },
          });
        }

        return existingDraft.id;
      }

      // Once a draft has started or finished, its order is part of the record: never rewrite it.
      if (existingDraft.status !== DraftStatus.SCHEDULED) {
        return existingDraft.id;
      }

      await tx.draftOrder.deleteMany({ where: { draftId: existingDraft.id } });
      await Promise.all(
        members.map((member, index) =>
          tx.draftOrder.create({
            data: {
              draftId: existingDraft.id,
              memberId: member.id,
              slot: slots[index],
            },
          })
        )
      );

      await tx.draft.update({
        where: { id: existingDraft.id },
        data: { totalPicks },
      });

      return existingDraft.id;
    }

    if (members.length < 2 || rosterSpots <= 0) {
      return null;
    }

    const draft = await tx.draft.create({
      data: {
        leagueId: league.id,
        status: DraftStatus.SCHEDULED,
        lobbyStatus: 'COUNTDOWN',
        lobbyOpenAt: new Date(),
        currentPick: 1,
        totalPicks,
        round: 1,
        direction: DraftDirection.FORWARD,
      },
    });

    await Promise.all(
      members.map((member, index) =>
        tx.draftOrder.create({
          data: {
            draftId: draft.id,
            memberId: member.id,
            slot: slots[index],
          },
        })
      )
    );

    return draft.id;
  });
}

export async function ensureLeagueDraftSetupConverged(
  input: DraftSetupConvergenceInput
): Promise<DraftSetupConvergenceResult> {
  const client = input.prismaClient ?? defaultPrisma;

  await ensureDraftRoomExists(client, input.leagueId);

  const readiness = await getLeagueDraftOperationalReadiness(client, {
    leagueId: input.leagueId,
    now: input.now,
  });

  return {
    ...readiness,
    recommendedAction: readiness.lifecycle.canStartClock ? 'AWAIT_EXPLICIT_START' : 'NONE',
  };
}
