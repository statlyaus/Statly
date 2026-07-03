import { createHash } from 'crypto';
import {
  DraftType,
  LeagueRole,
  PickOrder,
  WaiverRule,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { Firestore } from 'firebase-admin/firestore';

import { adminDb } from './firebaseAdmin';
import { prisma } from './prisma';
import { getLeagueMemberDocId, isActiveMembershipData } from './leagueMembership';
import {
  normalizeDraftAutoPickRules,
  normalizeDraftPositionLimits,
} from './draftSettings';

type PrismaClientLike = Pick<PrismaClient, '$transaction' | 'league'>;
type PrismaTx = Prisma.TransactionClient;

export interface PrismaLeagueMirrorMember {
  id: string;
  leagueId: string;
  userId: string;
  role: string;
  teamName: string;
  teamLogoUrl?: string;
  draftSlot?: number;
  isActive: boolean;
}

export interface PrismaLeagueMirrorSnapshot {
  leagueId: string;
  name: string;
  inviteCode: string;
  ownerId: string;
  maxTeams: number;
  draftType: DraftType;
  pickOrder: PickOrder;
  waiverRule: WaiverRule;
  startAt: Date;
  timeZone: string;
  pickSeconds: number;
  allowAutoPick: boolean;
  positionLimitsJson: string;
  autoPickRulesJson: string;
  members: PrismaLeagueMirrorMember[];
}

export interface EnsurePrismaLeagueMirrorInput {
  leagueId: string;
  draftType?: 'snake' | 'linear' | string;
  timePerPick?: number;
  scheduledStartTime?: Date;
  timeZone?: string;
  rosterSize?: number;
  benchSize?: number;
  pickOrder?: 'random' | 'manual' | string;
  positionLimits?: unknown;
  autoPickRules?: unknown;
}

export interface SyncPrismaLeagueMemberInput {
  leagueId: string;
  userId: string;
  memberId?: string;
  role?: string;
  teamName?: string;
  teamLogoUrl?: string | null;
  draftSlot?: number;
  isActive?: boolean;
  timeZone?: string;
}

export interface SyncPrismaLeagueOwnerInput {
  leagueId: string;
  ownerUserId: string;
  previousOwnerUserId?: string;
}

interface BridgeDependencies {
  firestore?: Firestore;
  prisma?: PrismaClientLike;
}

export function normalizeDraftTypeForPrisma(value: unknown): DraftType {
  return String(value ?? '')
    .trim()
    .toLowerCase() === 'linear'
    ? DraftType.LINEAR
    : DraftType.SNAKE;
}

export function normalizeLeagueRoleForPrisma(
  role: unknown,
  userId: string,
  ownerId?: string
): LeagueRole {
  const normalized = String(role ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'owner' || normalized === 'commissioner' || userId === ownerId) {
    return LeagueRole.OWNER;
  }
  return LeagueRole.MANAGER;
}

export function normalizePickOrderForPrisma(value: unknown): PickOrder {
  return String(value ?? '')
    .trim()
    .toLowerCase() === 'manual'
    ? PickOrder.MANUAL
    : PickOrder.RANDOM;
}

export function normalizeWaiverRuleForPrisma(value: unknown): WaiverRule {
  return String(value ?? '')
    .trim()
    .toLowerCase() === 'rolling'
    ? WaiverRule.ROLLING
    : WaiverRule.WEEKLY;
}

export function buildExternalUserEmail(userId: string): string {
  const digest = createHash('sha1').update(userId).digest('hex').slice(0, 20);
  return `firebase_${digest}@statly.local`;
}

export async function loadFirestoreLeagueMirrorSnapshot(
  input: EnsurePrismaLeagueMirrorInput,
  firestore: Firestore = adminDb
): Promise<PrismaLeagueMirrorSnapshot> {
  const leagueRef = firestore.collection('leagues').doc(input.leagueId);
  const [leagueDoc, topLevelMembersSnap, embeddedMembersSnap] = await Promise.all([
    leagueRef.get(),
    firestore.collection('leagueMembers').where('leagueId', '==', input.leagueId).get(),
    leagueRef.collection('members').get(),
  ]);

  if (!leagueDoc.exists) {
    throw new Error('League not found');
  }

  const leagueData = leagueDoc.data() ?? {};
  const topLevelMembers = topLevelMembersSnap.docs
    .map((doc) => toMirrorMember(doc.id, input.leagueId, doc.data()))
    .filter((member): member is PrismaLeagueMirrorMember => Boolean(member));

  const embeddedMembers = embeddedMembersSnap.docs
    .map((doc) =>
      toMirrorMember(getLeagueMemberDocId(input.leagueId, doc.id), input.leagueId, {
        ...doc.data(),
        userId: doc.data().userId ?? doc.id,
      })
    )
    .filter((member): member is PrismaLeagueMirrorMember => Boolean(member));

  const members = topLevelMembers.length > 0 ? topLevelMembers : embeddedMembers;
  const ownerId =
    stringOrUndefined(leagueData.ownerId) ??
    members.find((member) => String(member.role).toLowerCase() === 'owner')?.userId ??
    members[0]?.userId;

  if (!ownerId) {
    throw new Error('League has no owner or active members to mirror');
  }

  const startAt =
    input.scheduledStartTime ??
    toDate(leagueData.draftDate) ??
    toDate(leagueData.startAt) ??
    new Date();

  return {
    leagueId: input.leagueId,
    name: stringOrUndefined(leagueData.name) ?? 'Untitled League',
    inviteCode:
      stringOrUndefined(leagueData.code) ??
      stringOrUndefined(leagueData.inviteCode) ??
      input.leagueId,
    ownerId,
    maxTeams: numberOrUndefined(leagueData.maxTeams) ?? Math.max(members.length, 4),
    draftType: normalizeDraftTypeForPrisma(input.draftType ?? leagueData.draftType),
    pickOrder: normalizePickOrderForPrisma(input.pickOrder ?? leagueData.pickOrder),
    waiverRule: normalizeWaiverRuleForPrisma(leagueData.waiverRule ?? leagueData.waiverResetPolicy),
    startAt,
    timeZone: input.timeZone ?? stringOrUndefined(leagueData.timeZone) ?? 'Australia/Melbourne',
    pickSeconds: input.timePerPick ?? numberOrUndefined(leagueData.pickSeconds) ?? 120,
    allowAutoPick: normalizeDraftAutoPickRules(input.autoPickRules ?? leagueData.autoPickRules).enabled,
    positionLimitsJson: JSON.stringify(
      normalizeDraftPositionLimits(input.positionLimits ?? leagueData.positionLimits)
    ),
    autoPickRulesJson: JSON.stringify(
      normalizeDraftAutoPickRules(input.autoPickRules ?? leagueData.autoPickRules)
    ),
    members,
  };
}

export async function ensurePrismaLeagueMirror(
  input: EnsurePrismaLeagueMirrorInput,
  deps: BridgeDependencies = {}
) {
  const firestore = deps.firestore ?? adminDb;
  const client = deps.prisma ?? prisma;
  const snapshot = await loadFirestoreLeagueMirrorSnapshot(input, firestore);

  return upsertPrismaLeagueMirror(snapshot, client, {
    rosterSize: input.rosterSize ?? 18,
    benchSize: input.benchSize ?? 4,
  });
}

export async function upsertPrismaLeagueMirror(
  snapshot: PrismaLeagueMirrorSnapshot,
  client: PrismaClientLike = prisma,
  options: { rosterSize?: number; benchSize?: number } = {}
) {
  return client.$transaction(async (tx) => {
    const existingLeague = await tx.league.findUnique({
      where: { id: snapshot.leagueId },
      include: { settings: true },
    });
    const inviteCode = await getAvailableInviteCode(tx, snapshot.leagueId, snapshot.inviteCode);

    if (existingLeague) {
      await tx.league.update({
        where: { id: snapshot.leagueId },
        data: {
          name: snapshot.name,
          inviteCode,
          ownerId: snapshot.ownerId,
        },
      });

      await tx.leagueSettings.update({
        where: { id: existingLeague.settingsId },
        data: {
          maxTeams: snapshot.maxTeams,
          pickSeconds: snapshot.pickSeconds,
          allowAutoPick: snapshot.allowAutoPick,
          positionLimitsJson: snapshot.positionLimitsJson,
          autoPickRulesJson: snapshot.autoPickRulesJson,
          draftType: snapshot.draftType,
          pickOrder: snapshot.pickOrder,
          waiverRule: snapshot.waiverRule,
          startAt: snapshot.startAt,
          timeZone: snapshot.timeZone,
        },
      });
    } else {
      const settings = await tx.leagueSettings.create({
        data: {
          rosterSize: options.rosterSize ?? 18,
          benchSize: options.benchSize ?? 4,
          maxTeams: snapshot.maxTeams,
          pickSeconds: snapshot.pickSeconds,
          allowAutoPick: snapshot.allowAutoPick,
          positionLimitsJson: snapshot.positionLimitsJson,
          autoPickRulesJson: snapshot.autoPickRulesJson,
          draftType: snapshot.draftType,
          pickOrder: snapshot.pickOrder,
          waiverRule: snapshot.waiverRule,
          startAt: snapshot.startAt,
          timeZone: snapshot.timeZone,
          locked: false,
        },
      });

      await tx.league.create({
        data: {
          id: snapshot.leagueId,
          name: snapshot.name,
          inviteCode,
          ownerId: snapshot.ownerId,
          settingsId: settings.id,
        },
      });
    }

    await syncActiveMembers(tx, snapshot);

    return {
      leagueId: snapshot.leagueId,
      activeMemberCount: snapshot.members.length,
      mirroredMemberIds: snapshot.members.map((member) => member.id),
    };
  });
}

export async function syncPrismaLeagueMember(
  input: SyncPrismaLeagueMemberInput,
  deps: BridgeDependencies = {}
) {
  const client = deps.prisma ?? prisma;

  return client.$transaction(async (tx) => {
    const league = await tx.league.findUnique({ where: { id: input.leagueId } });
    if (!league) {
      return { synced: false, reason: 'no-prisma-league' as const };
    }

    if (input.isActive === false) {
      const member = await tx.leagueMember.findFirst({
        where: { leagueId: input.leagueId, userId: input.userId },
      });
      if (!member) {
        return { synced: false, reason: 'member-not-found' as const };
      }
      if (await memberHasDraftDependencies(tx, member.id)) {
        return { synced: false, reason: 'member-has-draft-dependencies' as const };
      }
      await tx.leagueMember.delete({ where: { id: member.id } });
      return { synced: true, action: 'deleted' as const };
    }

    const member = toMirrorMember(
      input.memberId ?? getLeagueMemberDocId(input.leagueId, input.userId),
      input.leagueId,
      {
        userId: input.userId,
        role: input.role ?? (input.userId === league.ownerId ? 'owner' : 'member'),
        teamName: input.teamName,
        teamLogoUrl: input.teamLogoUrl,
        draftSlot: input.draftSlot,
        isActive: true,
      }
    );

    if (!member) {
      return { synced: false, reason: 'inactive-member' as const };
    }

    await upsertPrismaUser(tx, member, input.timeZone ?? 'Australia/Melbourne');
    await upsertPrismaMember(tx, member, league.ownerId);
    return { synced: true, action: 'upserted' as const };
  });
}

export async function syncPrismaLeagueOwner(
  input: SyncPrismaLeagueOwnerInput,
  deps: BridgeDependencies = {}
) {
  const client = deps.prisma ?? prisma;

  return client.$transaction(async (tx) => {
    const league = await tx.league.findUnique({ where: { id: input.leagueId } });
    if (!league) {
      return { synced: false, reason: 'no-prisma-league' as const };
    }

    await tx.league.update({
      where: { id: input.leagueId },
      data: { ownerId: input.ownerUserId },
    });

    await tx.leagueMember.updateMany({
      where: { leagueId: input.leagueId, userId: input.ownerUserId },
      data: { role: LeagueRole.OWNER },
    });

    if (input.previousOwnerUserId && input.previousOwnerUserId !== input.ownerUserId) {
      await tx.leagueMember.updateMany({
        where: { leagueId: input.leagueId, userId: input.previousOwnerUserId },
        data: { role: LeagueRole.MANAGER },
      });
    }

    return { synced: true, action: 'owner-updated' as const };
  });
}

async function syncActiveMembers(
  tx: PrismaTx,
  snapshot: PrismaLeagueMirrorSnapshot
): Promise<void> {
  for (const member of snapshot.members) {
    await upsertPrismaUser(tx, member, snapshot.timeZone);
    await upsertPrismaMember(tx, member, snapshot.ownerId);
  }

  const activeUserIds = new Set(snapshot.members.map((member) => member.userId));
  const existingMembers = await tx.leagueMember.findMany({
    where: { leagueId: snapshot.leagueId },
    select: { id: true, userId: true },
  });

  for (const member of existingMembers) {
    if (activeUserIds.has(member.userId)) continue;
    if (await memberHasDraftDependencies(tx, member.id)) continue;
    await tx.leagueMember.delete({ where: { id: member.id } });
  }
}

async function upsertPrismaUser(
  tx: PrismaTx,
  member: PrismaLeagueMirrorMember,
  timeZone: string
): Promise<void> {
  await tx.user.upsert({
    where: { id: member.userId },
    update: {
      displayName: member.teamName,
      timeZone,
    },
    create: {
      id: member.userId,
      email: buildExternalUserEmail(member.userId),
      passwordHash: 'firebase-auth',
      displayName: member.teamName,
      timeZone,
    },
  });
}

async function upsertPrismaMember(
  tx: PrismaTx,
  member: PrismaLeagueMirrorMember,
  ownerId: string
): Promise<void> {
  const existingMember = await tx.leagueMember.findFirst({
    where: { leagueId: member.leagueId, userId: member.userId },
  });

  const data = {
    role: normalizeLeagueRoleForPrisma(member.role, member.userId, ownerId),
    teamName: member.teamName,
    teamLogoUrl: member.teamLogoUrl,
    draftSlot: member.draftSlot,
  };

  if (existingMember) {
    await tx.leagueMember.update({
      where: { id: existingMember.id },
      data,
    });
    return;
  }

  await tx.leagueMember.create({
    data: {
      id: member.id,
      leagueId: member.leagueId,
      userId: member.userId,
      ...data,
    },
  });
}

async function getAvailableInviteCode(
  tx: PrismaTx,
  leagueId: string,
  inviteCode: string
): Promise<string> {
  const existingLeague = await tx.league.findUnique({ where: { inviteCode } });
  if (!existingLeague || existingLeague.id === leagueId) {
    return inviteCode;
  }
  return `FS_${leagueId}`;
}

async function memberHasDraftDependencies(tx: PrismaTx, memberId: string): Promise<boolean> {
  const counts = await Promise.all([
    tx.draftOrder.count({ where: { memberId } }),
    tx.pick.count({ where: { memberId } }),
    tx.draftWatchlist.count({ where: { memberId } }),
    tx.preDraftQueue.count({ where: { memberId } }),
    tx.lobbyActivity.count({ where: { memberId } }),
  ]);
  return counts.some((count) => count > 0);
}

function toMirrorMember(
  memberId: string,
  leagueId: string,
  data: FirebaseFirestore.DocumentData
): PrismaLeagueMirrorMember | null {
  if (!isActiveMembershipData(data)) return null;

  const userId = stringOrUndefined(data.userId);
  if (!userId) return null;

  return {
    id: memberId,
    leagueId,
    userId,
    role: stringOrUndefined(data.role) ?? 'member',
    teamName: stringOrUndefined(data.teamName) ?? 'Team',
    teamLogoUrl: stringOrUndefined(data.teamLogoUrl),
    draftSlot: numberOrUndefined(data.draftSlot),
    isActive: true,
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const maybeTimestamp = value as { toDate?: () => Date } | undefined;
  if (typeof maybeTimestamp?.toDate === 'function') {
    const date = maybeTimestamp.toDate();
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  return undefined;
}
