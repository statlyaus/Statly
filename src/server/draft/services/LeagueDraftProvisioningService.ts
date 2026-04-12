import { DraftDirection, DraftStatus, Prisma } from '@prisma/client';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { prismaUserPublicSelect } from '@/lib/prismaUserPublicSelect';
import { createDraftReminders, updateDraftReminders } from '@/lib/reminders';
import { scheduleDraftStart } from '@/server/queue/draftQueue';

type ProvisioningReason =
  | 'missing_draft_date'
  | 'draft_date_in_past'
  | 'insufficient_members'
  | 'draft_order_incomplete'
  | 'existing_draft_locked';

export type LeagueDraftProvisioningResult = {
  status: 'created' | 'updated' | 'skipped';
  reason?: ProvisioningReason;
  draft?: {
    id: string;
    status: DraftStatus;
    startAt: string;
    createdAt: string;
  };
};

type LeagueAggregate = Prisma.LeagueGetPayload<{
  include: {
    settings: true;
    members: { include: { user: { select: typeof prismaUserPublicSelect } } };
    drafts: { take: 1; orderBy: { createdAt: 'desc' } };
  };
}>;

function buildDraftSummary(input: {
  draft: { id: string; status: DraftStatus; createdAt: Date };
  startAt: Date;
}): NonNullable<LeagueDraftProvisioningResult['draft']> {
  return {
    id: input.draft.id,
    status: input.draft.status,
    startAt: input.startAt.toISOString(),
    createdAt: input.draft.createdAt.toISOString(),
  };
}

function getOrderedMembers(league: LeagueAggregate) {
  return [...league.members].sort((left, right) => {
    const leftSlot = typeof left.draftSlot === 'number' ? left.draftSlot : Number.MAX_SAFE_INTEGER;
    const rightSlot =
      typeof right.draftSlot === 'number' ? right.draftSlot : Number.MAX_SAFE_INTEGER;

    if (leftSlot !== rightSlot) {
      return leftSlot - rightSlot;
    }

    return left.joinedAt.getTime() - right.joinedAt.getTime();
  });
}

function hasProvisionableDraftOrder(league: LeagueAggregate): boolean {
  const orderedMembers = getOrderedMembers(league);
  if (orderedMembers.length !== league.members.length) {
    return false;
  }

  const assignedSlots = orderedMembers.map((member) => member.draftSlot);
  const uniqueSlots = new Set<number>();
  for (let index = 0; index < assignedSlots.length; index += 1) {
    const slot = assignedSlots[index];
    if (typeof slot !== 'number' || slot !== index + 1 || uniqueSlots.has(slot)) {
      return false;
    }
    uniqueSlots.add(slot);
  }

  return true;
}

export class LeagueDraftProvisioningService {
  async syncFromLeagueSettings(leagueId: string): Promise<LeagueDraftProvisioningResult> {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        settings: true,
        members: {
          include: {
            user: { select: prismaUserPublicSelect },
          },
        },
        drafts: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!league) {
      throw new Error('not_found:League not found');
    }

    if (!league.draftDate) {
      return { status: 'skipped', reason: 'missing_draft_date' };
    }

    if (league.members.length < 4) {
      return { status: 'skipped', reason: 'insufficient_members' };
    }

    if (!hasProvisionableDraftOrder(league)) {
      return { status: 'skipped', reason: 'draft_order_incomplete' };
    }

    const scheduledDate = league.settings.startAt;
    if (scheduledDate.getTime() <= Date.now()) {
      return { status: 'skipped', reason: 'draft_date_in_past' };
    }

    const orderedMembers = getOrderedMembers(league);
    const totalPicks =
      league.members.length * (league.settings.rosterSize + league.settings.benchSize);
    const existingDraft = league.drafts[0] ?? null;

    if (existingDraft && existingDraft.status !== DraftStatus.SCHEDULED) {
      return {
        status: 'skipped',
        reason: 'existing_draft_locked',
        draft: buildDraftSummary({ draft: existingDraft, startAt: scheduledDate }),
      };
    }

    const draft =
      existingDraft === null
        ? await prisma.$transaction(async (tx) => {
            const createdDraft = await tx.draft.create({
              data: {
                leagueId: league.id,
                status: DraftStatus.SCHEDULED,
                lobbyStatus: 'CLOSED',
                currentPick: 1,
                totalPicks,
                round: 1,
                direction: DraftDirection.FORWARD,
              },
            });

            for (const [index, member] of orderedMembers.entries()) {
              await tx.draftOrder.create({
                data: {
                  draftId: createdDraft.id,
                  memberId: member.id,
                  slot: index + 1,
                },
              });
            }

            return createdDraft;
          })
        : await prisma.$transaction(async (tx) => {
            const updatedDraft = await tx.draft.update({
              where: { id: existingDraft.id },
              data: {
                status: DraftStatus.SCHEDULED,
                currentPick: 1,
                totalPicks,
                round: 1,
                direction: DraftDirection.FORWARD,
                startedAt: null,
                completedAt: null,
                lobbyStatus: 'CLOSED',
                lobbyOpenAt: null,
                pickStartedAt: null,
                pickDeadlineAt: null,
                pausedRemainingSeconds: null,
              },
            });

            await tx.draftOrder.deleteMany({
              where: { draftId: existingDraft.id },
            });

            for (const [index, member] of orderedMembers.entries()) {
              await tx.draftOrder.create({
                data: {
                  draftId: existingDraft.id,
                  memberId: member.id,
                  slot: index + 1,
                },
              });
            }

            return updatedDraft;
          });

    await scheduleDraftStart(league.id, scheduledDate, league.settings.pickSeconds * 1000);

    const participantIds = orderedMembers.map((member) => member.userId);
    if (league.settings.enableDraftReminders && participantIds.length > 0) {
      if (existingDraft) {
        await updateDraftReminders(existingDraft.id, scheduledDate, participantIds);
      } else {
        await createDraftReminders(draft.id, scheduledDate, participantIds);
      }
    }

    const provisioningResult: LeagueDraftProvisioningResult = {
      status: existingDraft ? 'updated' : 'created',
      draft: buildDraftSummary({ draft, startAt: scheduledDate }),
    };

    logger.info('League draft provisioned from league settings', {
      leagueId,
      result: provisioningResult.status,
      draftId: draft.id,
      scheduledTime: scheduledDate.toISOString(),
      timePerPick: league.settings.pickSeconds,
    });

    return provisioningResult;
  }
}

export const leagueDraftProvisioningService = new LeagueDraftProvisioningService();
