import { DraftDirection, DraftStatus, type Prisma, type PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '@/lib/prisma';
import type { DraftOperationalReadiness } from '@/types/draftReadiness';

import { getLeagueDraftOperationalReadiness } from './DraftReadinessService';

type ConvergenceClient = PrismaClient;
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
        members: { orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }] },
        drafts: { include: { orders: true }, take: 1 },
      },
    });

    if (!league?.settings) {
      return null;
    }

    const existingDraft = league.drafts[0] ?? null;
    const rosterSpots = league.settings.rosterSize + league.settings.benchSize;
    const totalPicks = league.members.length * rosterSpots;

    if (existingDraft) {
      if (existingDraft.orders.length === league.members.length) {
        if (existingDraft.totalPicks !== totalPicks) {
          await tx.draft.update({
            where: { id: existingDraft.id },
            data: { totalPicks },
          });
        }

        return existingDraft.id;
      }

      await tx.draftOrder.deleteMany({ where: { draftId: existingDraft.id } });
      await Promise.all(
        league.members.map((member, index) =>
          tx.draftOrder.create({
            data: {
              draftId: existingDraft.id,
              memberId: member.id,
              slot: member.draftSlot ?? index + 1,
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

    if (league.members.length < 2 || rosterSpots <= 0) {
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
      league.members.map((member, index) =>
        tx.draftOrder.create({
          data: {
            draftId: draft.id,
            memberId: member.id,
            slot: member.draftSlot ?? index + 1,
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
