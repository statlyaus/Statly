import { DraftStatus, LeagueRole, type Prisma, type PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '@/lib/prisma';

import { isActivePrismaMembership } from './activeMembership';

/**
 * Prisma owns league membership. These commands authorize against the persisted league owner and
 * active membership inside the same transaction that writes, so route code only authenticates.
 */

export type MemberCommandFailureCode =
  | 'league-not-found'
  | 'forbidden'
  | 'member-not-found'
  | 'owner-cannot-be-removed'
  | 'draft-started';

export type MemberCommandResult<T> =
  { ok: true; data: T } | { ok: false; code: MemberCommandFailureCode; message: string };

export interface MemberCommandInput {
  leagueId: string;
  actorUserId: string;
  targetUserId: string;
}

type CommandClient = Pick<PrismaClient, '$transaction'>;

function fail<T>(code: MemberCommandFailureCode, message: string): MemberCommandResult<T> {
  return { ok: false, code, message };
}

async function loadLeagueForCommand(tx: Prisma.TransactionClient, leagueId: string) {
  return tx.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      ownerId: true,
      members: {
        orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
        select: { id: true, userId: true, isActive: true, status: true, draftSlot: true },
      },
      drafts: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          startedAt: true,
          lobbyStatus: true,
          _count: { select: { picks: true } },
        },
      },
    },
  });
}

/** Removal closes once the league's latest draft has left SCHEDULED, started, or taken a pick. */
export function hasDraftStarted(
  draft: { status: DraftStatus; startedAt: Date | null; _count: { picks: number } } | undefined
): boolean {
  if (!draft) return false;
  return (
    draft.status !== DraftStatus.SCHEDULED || draft.startedAt !== null || draft._count.picks > 0
  );
}

/**
 * Removal closes once the league's latest draft has left SCHEDULED, started, taken a pick, or opened
 * a live room. A COUNTDOWN lobby is still forming (draft setup opens every lobby that way).
 */
export function hasDraftStarted(
  draft:
    | {
        status: DraftStatus;
        startedAt: Date | null;
        lobbyStatus: string | null;
        _count: { picks: number };
      }
    | undefined
): boolean {
  if (!draft) return false;
  return (
    draft.status !== DraftStatus.SCHEDULED ||
    draft.startedAt !== null ||
    draft.lobbyStatus === 'LIVE' ||
    draft._count.picks > 0
  );
}

/**
 * Removes a member while the league is still forming. Once a draft starts, rosters, fixtures and
 * standings depend on every team, so the member stays.
 */
export async function removeLeagueMember(
  input: MemberCommandInput,
  client: CommandClient = defaultPrisma
): Promise<MemberCommandResult<{ removedUserId: string; memberCount: number }>> {
  return client.$transaction(async (tx) => {
    const league = await loadLeagueForCommand(tx, input.leagueId);
    if (!league) return fail('league-not-found', 'League not found.');

    const isOwner = league.ownerId === input.actorUserId;
    const isSelf = input.actorUserId === input.targetUserId;
    if (!isOwner && !isSelf) {
      return fail('forbidden', 'Only the league owner can remove other members.');
    }
    if (input.targetUserId === league.ownerId) {
      return fail(
        'owner-cannot-be-removed',
        'Transfer ownership before the owner leaves the league.'
      );
    }

    const activeMembers = league.members.filter(isActivePrismaMembership);
    const target = activeMembers.find((member) => member.userId === input.targetUserId);
    if (!target) return fail('member-not-found', 'That manager is not in this league.');

    const draft = league.drafts[0];
    if (hasDraftStarted(draft)) {
      return fail('draft-started', 'Managers can only be removed before the draft starts.');
    }

    await tx.leagueMember.update({
      where: { id: target.id },
      data: { isActive: false, status: 'removed', leftAt: new Date(), draftSlot: null },
    });

    const remaining = activeMembers.filter((member) => member.id !== target.id);
    await Promise.all(
      remaining.map((member, index) =>
        tx.leagueMember.update({ where: { id: member.id }, data: { draftSlot: index + 1 } })
      )
    );

    if (draft) {
      await tx.draftOrder.deleteMany({ where: { draftId: draft.id } });
      await tx.draftOrder.createMany({
        data: remaining.map((member, index) => ({
          draftId: draft.id,
          memberId: member.id,
          slot: index + 1,
        })),
      });
    }

    return {
      ok: true,
      data: { removedUserId: input.targetUserId, memberCount: remaining.length },
    };
  });
}

/** Hands the league to another active member; the previous owner stays on as a manager. */
export async function transferLeagueOwnership(
  input: MemberCommandInput,
  client: CommandClient = defaultPrisma
): Promise<MemberCommandResult<{ ownerUserId: string }>> {
  return client.$transaction(async (tx) => {
    const league = await loadLeagueForCommand(tx, input.leagueId);
    if (!league) return fail('league-not-found', 'League not found.');
    if (league.ownerId !== input.actorUserId) {
      return fail('forbidden', 'Only the league owner can transfer ownership.');
    }

    const activeMembers = league.members.filter(isActivePrismaMembership);
    const target = activeMembers.find((member) => member.userId === input.targetUserId);
    if (!target || input.targetUserId === input.actorUserId) {
      return fail('member-not-found', 'Choose another manager in this league.');
    }

    await tx.league.update({
      where: { id: league.id },
      data: { ownerId: input.targetUserId },
    });
    await tx.leagueMember.updateMany({
      where: { leagueId: league.id, userId: input.actorUserId },
      data: { role: LeagueRole.MANAGER },
    });
    await tx.leagueMember.update({ where: { id: target.id }, data: { role: LeagueRole.OWNER } });

    return { ok: true, data: { ownerUserId: input.targetUserId } };
  });
}
