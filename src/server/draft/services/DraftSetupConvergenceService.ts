import { DraftDirection, DraftStatus, type Prisma, type PrismaClient } from '@prisma/client';

import { normalizeDraftPositionLimits } from '@/lib/draftSettings';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { isActivePrismaMembership } from '@/server/leagues/activeMembership';
import { calculateDraftCapacity } from '@/server/draft/domain/draftCapacity';
import { writeDraftOrder } from '@/server/draft/draftOrderWriter';
import { splitDraftingMembers } from '@/server/leagues/leagueFormat';
import type { DraftOperationalReadiness } from '@/types/draftReadiness';

import { getLeagueDraftOperationalReadiness } from './DraftReadinessService';

type ConvergenceClient = PrismaClient;

// Explicit draft slots set the order, unless an earlier member already holds one. Members without a
// slot take the lowest slot nobody holds. writeDraftOrder then numbers the order 1..n.
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
    const active = league.members.filter(isActivePrismaMembership);
    const slots = assignDraftSlots(active.map((member) => member.draftSlot));
    const members = active
      .map((member, index) => ({ member, slot: slots[index] }))
      .sort((left, right) => left.slot - right.slot)
      .map(({ member }) => member);
    // BR-09, BR-10: the Bloodsucker never drafts, but its roster is filled from the pool afterwards.
    const { drafters, bloodsucker } = splitDraftingMembers(members, league.settings);
    const existingDraft = league.drafts[0] ?? null;
    const activePlayerCount = await tx.player.count({ where: { active: true } });
    const capacity = calculateDraftCapacity({
      teamCount: drafters.length,
      reservedTeamCount: bloodsucker ? 1 : 0,
      positionLimits: normalizeDraftPositionLimits(league.settings.positionLimitsJson),
      activePlayerCount,
      existingPickCount: existingDraft?.picks.length ?? 0,
      currentPick: existingDraft?.currentPick,
    });
    const rosterSpots = capacity.rosterSpotsPerTeam;
    const totalPicks = capacity.totalPicks;

    if (existingDraft) {
      const orderMemberIds = new Set(existingDraft.orders.map((order) => order.memberId));
      const orderIsCurrent =
        existingDraft.orders.length === drafters.length &&
        drafters.every((member) => orderMemberIds.has(member.id));
      if (orderIsCurrent) {
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

      await writeDraftOrder(tx, { draftId: existingDraft.id, members, settings: league.settings });

      await tx.draft.update({
        where: { id: existingDraft.id },
        data: { totalPicks },
      });

      return existingDraft.id;
    }

    if (drafters.length < 2 || rosterSpots <= 0) {
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

    await writeDraftOrder(tx, { draftId: draft.id, members, settings: league.settings });

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
