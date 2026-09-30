import { DraftStatus, LeagueRole, type Prisma, type PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '@/lib/prisma';
import { buildExternalUserEmail } from '@/lib/prismaLeagueBridge';
import { generateDeterministicMemberId } from '@/utils/firestore';

import { isActivePrismaMembership } from './activeMembership';
import { isLeagueAtCapacity } from './leagueCapacity';

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

export type JoinLeagueFailureCode =
  'league-not-found' | 'draft-started' | 'league-full' | 'already-member' | 'team-name-taken';

export type MemberCommandResult<T, Code extends string = MemberCommandFailureCode> =
  { ok: true; data: T } | { ok: false; code: Code; message: string };

export interface MemberCommandInput {
  leagueId: string;
  actorUserId: string;
  targetUserId: string;
}

type CommandClient = Pick<PrismaClient, '$transaction'>;

function fail<T, Code extends string = MemberCommandFailureCode>(
  code: Code,
  message: string
): MemberCommandResult<T, Code> {
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

/** Leagues created before settings were required fall back to the default league size. */
const DEFAULT_MAX_TEAMS = 12;

export interface JoinLeagueInput {
  leagueId: string;
  userId: string;
  teamName?: string;
}

export interface JoinedLeagueMember {
  id: string;
  leagueId: string;
  userId: string;
  role: 'member';
  teamName: string;
  joinedAt: string;
  isActive: true;
}

export interface JoinLeagueData {
  member: JoinedLeagueMember;
  memberCount: number;
  draftSlot: number;
  league: { id: string; name: string; inviteCode: string; draftDate: string | null };
}

/** Resolves an invite code to the Prisma league that owns it, or `null` for a legacy league. */
export async function findPrismaLeagueIdByInviteCode(
  inviteCode: string,
  client: Pick<PrismaClient, 'league'> = defaultPrisma
): Promise<string | null> {
  const league = await client.league.findUnique({ where: { inviteCode }, select: { id: true } });
  return league?.id ?? null;
}

/**
 * Adds a manager to a league that is still forming. The league row is locked before membership is
 * read, so concurrent joins queue behind each other and cannot both take the last slot.
 */
export async function joinLeague(
  input: JoinLeagueInput,
  client: CommandClient = defaultPrisma
): Promise<MemberCommandResult<JoinLeagueData, JoinLeagueFailureCode>> {
  return client.$transaction(async (tx) => {
    // SQLite already serializes Prisma transactions; on PostgreSQL this no-op write takes the league
    // row lock before membership is read, so a concurrent join waits and then sees this one.
    const locked =
      await tx.$executeRaw`UPDATE "League" SET "ownerId" = "ownerId" WHERE "id" = ${input.leagueId}`;
    if (locked === 0) return fail('league-not-found', 'League not found.');

    const league = await tx.league.findUnique({
      where: { id: input.leagueId },
      select: {
        id: true,
        name: true,
        inviteCode: true,
        settings: { select: { maxTeams: true, timeZone: true, startAt: true } },
        members: {
          orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
          select: { id: true, userId: true, teamName: true, isActive: true, status: true },
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
    if (!league) return fail('league-not-found', 'League not found.');

    const draft = league.drafts[0];
    if (hasDraftStarted(draft)) {
      return fail('draft-started', 'League is no longer accepting new members');
    }

    const activeMembers = league.members.filter(isActivePrismaMembership);
    if (activeMembers.some((member) => member.userId === input.userId)) {
      return fail('already-member', 'Already a member of this league');
    }
    if (
      isLeagueAtCapacity({
        activeMemberCount: activeMembers.length,
        maxTeams: league.settings?.maxTeams ?? DEFAULT_MAX_TEAMS,
      })
    ) {
      return fail('league-full', 'League is full');
    }

    const draftSlot = activeMembers.length + 1;
    const teamName = input.teamName?.trim() || `${league.name} Team ${draftSlot}`;
    const normalizedTeamName = teamName.toLowerCase();
    if (
      activeMembers.some((member) => member.teamName.trim().toLowerCase() === normalizedTeamName)
    ) {
      return fail('team-name-taken', 'Team name already taken');
    }

    await tx.user.upsert({
      where: { id: input.userId },
      update: {},
      create: {
        id: input.userId,
        email: buildExternalUserEmail(input.userId),
        passwordHash: 'firebase-auth',
        displayName: teamName,
        timeZone: league.settings?.timeZone ?? 'Australia/Melbourne',
      },
    });

    const joinedAt = new Date();
    const membership = {
      role: LeagueRole.MANAGER,
      teamName,
      draftSlot,
      joinedAt,
      isActive: true,
      status: 'ACTIVE',
      leftAt: null,
    };
    // A manager who was removed rejoins on their retained history row.
    const previous = league.members.find((member) => member.userId === input.userId);
    const member = previous
      ? await tx.leagueMember.update({ where: { id: previous.id }, data: membership })
      : await tx.leagueMember.create({
          data: {
            id: generateDeterministicMemberId(league.id, input.userId),
            leagueId: league.id,
            userId: input.userId,
            ...membership,
          },
        });

    if (draft) {
      await tx.draftOrder.deleteMany({ where: { draftId: draft.id } });
      await tx.draftOrder.createMany({
        data: [...activeMembers, member].map((row, index) => ({
          draftId: draft.id,
          memberId: row.id,
          slot: index + 1,
        })),
      });
    }

    return {
      ok: true,
      data: {
        member: {
          id: member.id,
          leagueId: league.id,
          userId: input.userId,
          role: 'member',
          teamName,
          joinedAt: joinedAt.toISOString(),
          isActive: true,
        },
        memberCount: draftSlot,
        draftSlot,
        league: {
          id: league.id,
          name: league.name,
          inviteCode: league.inviteCode,
          draftDate: league.settings?.startAt?.toISOString() ?? null,
        },
      },
    };
  });
}
