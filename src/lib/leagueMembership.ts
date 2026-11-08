import { adminDb } from './firebaseAdmin';
import { prisma } from './prisma';
import { isActivePrismaMembership } from '@/server/leagues/activeMembership';
import { generateDeterministicMemberId } from '../utils/firestore';

export type MembershipSource = 'prisma' | 'embedded' | 'legacy' | 'none';

type MembershipWriteBatch = Pick<FirebaseFirestore.WriteBatch, 'set'>;
type MembershipDocumentLike = {
  id: string;
  data: () => FirebaseFirestore.DocumentData;
  ref?: {
    parent?: {
      parent?: {
        id?: string;
      } | null;
    };
  };
};

export interface LeagueMembershipWrite {
  leagueId: string;
  userId: string;
  role?: string;
  teamName?: string;
  teamLogoUrl?: string | null;
  teamLogoPositionX?: number | null;
  teamLogoPositionY?: number | null;
  teamLogoZoom?: number | null;
  joinedAt?: unknown;
  leftAt?: unknown;
  isActive?: boolean;
  status?: string;
  draftPreferences?: unknown;
  scoringPreferences?: unknown;
  notificationSettings?: unknown;
  migratedFrom?: string;
  migratedAt?: unknown;
}

export interface MembershipCheckResult {
  isMember: boolean;
  /** Always `prisma` for a member and `none` otherwise: Prisma is the only membership authority. */
  source: MembershipSource;
  /** The Prisma `LeagueMember` id, or the user id for an owner with no member row. */
  memberDocId?: string;
}

export interface LeagueMembershipReadResult extends MembershipCheckResult {
  data?: FirebaseFirestore.DocumentData;
}

export interface LeagueMembershipListItem {
  id: string;
  leagueId: string;
  userId: string;
  role: string;
  teamName: string;
  teamLogoUrl?: string;
  teamLogoPositionX?: number;
  teamLogoPositionY?: number;
  teamLogoZoom?: number;
  joinedAt?: unknown;
  leftAt?: unknown;
  isActive: boolean;
  source: Exclude<MembershipSource, 'none'>;
}

export function getLeagueMemberDocId(leagueId: string, userId: string): string {
  return generateDeterministicMemberId(leagueId, userId);
}

export function getLeagueMembershipRefs(
  leagueId: string,
  userId: string,
  topLevelMemberId = getLeagueMemberDocId(leagueId, userId)
): {
  topLevelRef: FirebaseFirestore.DocumentReference;
  embeddedRef: FirebaseFirestore.DocumentReference;
} {
  return {
    topLevelRef: adminDb.collection('leagueMembers').doc(topLevelMemberId),
    embeddedRef: adminDb.doc(`leagues/${leagueId}/members/${userId}`),
  };
}

export function isActiveMembershipData(data: FirebaseFirestore.DocumentData | undefined): boolean {
  if (!data) return false;
  if (data.isActive === false) return false;

  const normalizedStatus =
    typeof data.status === 'string' ? data.status.trim().toLowerCase() : undefined;
  return !normalizedStatus || !['declined', 'inactive', 'removed'].includes(normalizedStatus);
}

export function toCanonicalLeagueMembershipData(
  membership: LeagueMembershipWrite
): FirebaseFirestore.DocumentData {
  const isActive = membership.isActive ?? !isInactiveStatus(membership.status);

  return {
    leagueId: membership.leagueId,
    userId: membership.userId,
    role: membership.role ?? 'member',
    teamName: membership.teamName ?? 'Team',
    ...(membership.teamLogoUrl !== undefined && { teamLogoUrl: membership.teamLogoUrl }),
    ...(membership.teamLogoPositionX !== undefined && {
      teamLogoPositionX: membership.teamLogoPositionX,
    }),
    ...(membership.teamLogoPositionY !== undefined && {
      teamLogoPositionY: membership.teamLogoPositionY,
    }),
    ...(membership.teamLogoZoom !== undefined && { teamLogoZoom: membership.teamLogoZoom }),
    joinedAt: membership.joinedAt ?? new Date().toISOString(),
    isActive,
    status: isActive ? 'ACTIVE' : 'REMOVED',
    draftPreferences: membership.draftPreferences ?? {
      watchlist: [],
      autoDraftEnabled: true,
      draftStrategy: 'BALANCED',
      priorityPositions: ['MID', 'FWD', 'DEF', 'RUC'],
      maxDraftTime: 90,
    },
    scoringPreferences: membership.scoringPreferences ?? {
      rankingType: 'H2H_POINTS',
      viewMode: 'DETAILED',
    },
    notificationSettings: membership.notificationSettings ?? {
      tradePush: true,
      waiverPush: true,
      draftReminder: true,
      scoringAlerts: true,
    },
    ...(membership.leftAt !== undefined && { leftAt: membership.leftAt }),
    ...(membership.migratedFrom !== undefined && { migratedFrom: membership.migratedFrom }),
    ...(membership.migratedAt !== undefined && { migratedAt: membership.migratedAt }),
  };
}

export function toCanonicalLeagueMembershipPatch(
  updates: Partial<LeagueMembershipWrite>
): FirebaseFirestore.DocumentData {
  const patch: FirebaseFirestore.DocumentData = {};

  if (updates.role !== undefined) patch.role = updates.role;
  if (updates.teamName !== undefined) patch.teamName = updates.teamName;
  if (updates.teamLogoUrl !== undefined) patch.teamLogoUrl = updates.teamLogoUrl;
  if (updates.teamLogoPositionX !== undefined) patch.teamLogoPositionX = updates.teamLogoPositionX;
  if (updates.teamLogoPositionY !== undefined) patch.teamLogoPositionY = updates.teamLogoPositionY;
  if (updates.teamLogoZoom !== undefined) patch.teamLogoZoom = updates.teamLogoZoom;
  if (updates.joinedAt !== undefined) patch.joinedAt = updates.joinedAt;
  if (updates.leftAt !== undefined) patch.leftAt = updates.leftAt;
  if (updates.isActive !== undefined) {
    patch.isActive = updates.isActive;
    patch.status = updates.isActive ? 'ACTIVE' : 'REMOVED';
  }
  if (updates.status !== undefined) {
    patch.status = updates.status;
    patch.isActive = !isInactiveStatus(updates.status);
  }
  if (updates.draftPreferences !== undefined) patch.draftPreferences = updates.draftPreferences;
  if (updates.scoringPreferences !== undefined)
    patch.scoringPreferences = updates.scoringPreferences;
  if (updates.notificationSettings !== undefined) {
    patch.notificationSettings = updates.notificationSettings;
  }

  return patch;
}

export function queueLeagueMembershipSet(
  batch: MembershipWriteBatch,
  membership: LeagueMembershipWrite,
  options?: { topLevelMemberId?: string }
): string {
  const memberDocId =
    options?.topLevelMemberId ?? getLeagueMemberDocId(membership.leagueId, membership.userId);
  const { topLevelRef, embeddedRef } = getLeagueMembershipRefs(
    membership.leagueId,
    membership.userId,
    memberDocId
  );
  const data = toCanonicalLeagueMembershipData(membership);

  batch.set(topLevelRef, data, { merge: true });
  batch.set(embeddedRef, data, { merge: true });

  return memberDocId;
}

export function queueLeagueMembershipPatch(
  batch: MembershipWriteBatch,
  leagueId: string,
  userId: string,
  updates: Partial<LeagueMembershipWrite>,
  options?: { topLevelMemberId?: string }
): void {
  const memberDocId = options?.topLevelMemberId ?? getLeagueMemberDocId(leagueId, userId);
  const { topLevelRef, embeddedRef } = getLeagueMembershipRefs(leagueId, userId, memberDocId);
  const patch = toCanonicalLeagueMembershipPatch(updates);

  batch.set(topLevelRef, patch, { merge: true });
  batch.set(embeddedRef, patch, { merge: true });
}

const PRISMA_MEMBERSHIP_LIST_SELECT = {
  id: true,
  userId: true,
  role: true,
  teamName: true,
  teamLogoUrl: true,
  teamLogoPositionX: true,
  teamLogoPositionY: true,
  teamLogoZoom: true,
  joinedAt: true,
  leftAt: true,
  isActive: true,
  status: true,
  isCoCommissioner: true,
} as const;

interface PrismaMembershipListRow {
  id: string;
  userId: string;
  teamName: string;
  teamLogoUrl: string | null;
  teamLogoPositionX: number | null;
  teamLogoPositionY: number | null;
  teamLogoZoom: number | null;
  joinedAt: Date;
  leftAt: Date | null;
  isCoCommissioner: boolean;
}

function toPrismaMembershipListItem(
  leagueId: string,
  ownerId: string,
  member: PrismaMembershipListRow
): LeagueMembershipListItem {
  return {
    id: member.id,
    leagueId,
    userId: member.userId,
    // The API's role vocabulary: the owner, a co-commissioner ('admin'), or an ordinary member.
    role: member.userId === ownerId ? 'owner' : member.isCoCommissioner ? 'admin' : 'member',
    teamName: member.teamName,
    ...(member.teamLogoUrl ? { teamLogoUrl: member.teamLogoUrl } : {}),
    ...(member.teamLogoPositionX != null ? { teamLogoPositionX: member.teamLogoPositionX } : {}),
    ...(member.teamLogoPositionY != null ? { teamLogoPositionY: member.teamLogoPositionY } : {}),
    ...(member.teamLogoZoom != null ? { teamLogoZoom: member.teamLogoZoom } : {}),
    joinedAt: member.joinedAt,
    ...(member.leftAt ? { leftAt: member.leftAt } : {}),
    isActive: true,
    source: 'prisma',
  };
}

/**
 * Active members of a league, read from Prisma (removed and declined rows excluded). Prisma owns
 * membership, so a league with no Prisma row has no members.
 */
export async function listActiveLeagueMembers(
  leagueId: string
): Promise<LeagueMembershipListItem[]> {
  const prismaLeague = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      ownerId: true,
      members: {
        orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
        select: PRISMA_MEMBERSHIP_LIST_SELECT,
      },
    },
  });

  if (!prismaLeague) {
    return [];
  }

  return prismaLeague.members
    .filter(isActivePrismaMembership)
    .map((member) => toPrismaMembershipListItem(leagueId, prismaLeague.ownerId, member));
}

/**
 * Active members as recorded in the Firestore compatibility projection. Only projection writers
 * should use this, to locate the Firestore documents they update after a Prisma command.
 */
export async function listActiveFirestoreLeagueMembers(
  leagueId: string
): Promise<LeagueMembershipListItem[]> {
  const embeddedSnap = await adminDb
    .collection('leagues')
    .doc(leagueId)
    .collection('members')
    .get();

  if (!embeddedSnap.empty) {
    return toActiveMemberList(embeddedSnap.docs, leagueId, 'embedded');
  }

  const legacySnap = await adminDb
    .collection('leagueMembers')
    .where('leagueId', '==', leagueId)
    .get();

  return toActiveMemberList(legacySnap.docs, leagueId, 'legacy');
}

/**
 * A user's active league memberships, read from Prisma and ordered by join time. Firestore member
 * documents are never consulted.
 */
export async function listActiveUserLeagueMemberships(
  userId: string
): Promise<LeagueMembershipListItem[]> {
  const memberships = await prisma.leagueMember.findMany({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: {
      ...PRISMA_MEMBERSHIP_LIST_SELECT,
      leagueId: true,
      league: { select: { ownerId: true } },
    },
  });

  return memberships
    .filter(isActivePrismaMembership)
    .map((member) => toPrismaMembershipListItem(member.leagueId, member.league.ownerId, member));
}

/**
 * Reads a user's league membership data from Prisma. A league with no Prisma row, or a user with no
 * active Prisma membership who is not the league owner, is not a member. Firestore member documents
 * are a compatibility projection and never decide membership or role.
 */
export async function getLeagueMembership(
  leagueId: string,
  userId: string
): Promise<LeagueMembershipReadResult> {
  const prismaLeague = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      ownerId: true,
      members: {
        where: { userId },
        select: {
          id: true,
          userId: true,
          role: true,
          teamName: true,
          teamLogoUrl: true,
          teamLogoPositionX: true,
          teamLogoPositionY: true,
          teamLogoZoom: true,
          joinedAt: true,
          isActive: true,
          status: true,
        },
        take: 1,
      },
    },
  });

  if (prismaLeague) {
    // A removed or declined member keeps its row for history but no longer belongs to the league.
    const member = prismaLeague.members.find(isActivePrismaMembership);
    if (!member && prismaLeague.ownerId !== userId) {
      return { isMember: false, source: 'none' };
    }

    const role = String(member?.role ?? 'OWNER');
    const teamName = member?.teamName ?? 'Team';
    const teamLogoUrl = member?.teamLogoUrl ?? undefined;
    const teamLogoPositionX = member?.teamLogoPositionX ?? undefined;
    const teamLogoPositionY = member?.teamLogoPositionY ?? undefined;
    const teamLogoZoom = member?.teamLogoZoom ?? undefined;
    const joinedAt = member?.joinedAt;

    return {
      isMember: true,
      source: 'prisma',
      memberDocId: member?.id ?? userId,
      data: {
        leagueId,
        userId: member?.userId ?? userId,
        role,
        teamName,
        teamLogoUrl,
        teamLogoPositionX,
        teamLogoPositionY,
        teamLogoZoom,
        ...(joinedAt ? { joinedAt } : {}),
        isActive: true,
        status: 'ACTIVE',
      },
    };
  }

  return { isMember: false, source: 'none' };
}

/**
 * Verify whether a given user is a member of the specified league.
 */
export async function verifyLeagueMembership(
  leagueId: string,
  userId: string
): Promise<MembershipCheckResult> {
  const result = await getLeagueMembership(leagueId, userId);
  return {
    isMember: result.isMember,
    source: result.source,
    ...(result.memberDocId ? { memberDocId: result.memberDocId } : {}),
  };
}

/**
 * Ensures membership or throws a standard error. Useful when callers prefer exceptions.
 */
export async function assertLeagueMember(
  leagueId: string,
  userId: string
): Promise<Exclude<MembershipCheckResult, { isMember: false }>> {
  const result = await verifyLeagueMembership(leagueId, userId);
  if (!result.isMember) {
    const error = new Error('FORBIDDEN_NOT_LEAGUE_MEMBER');
    // @ts-expect-error attach metadata for upstream handlers
    error.status = 403;
    throw error;
  }
  return result as Exclude<MembershipCheckResult, { isMember: false }>;
}

function isInactiveStatus(status: unknown): boolean {
  return (
    typeof status === 'string' &&
    ['declined', 'inactive', 'removed'].includes(status.trim().toLowerCase())
  );
}

function toActiveMemberList(
  docs: MembershipDocumentLike[],
  leagueId: string,
  source: Exclude<MembershipSource, 'none'>
): LeagueMembershipListItem[] {
  return docs
    .map((doc) => toLeagueMembershipListItem(doc, leagueId, source))
    .filter((member) => member.isActive)
    .sort((a, b) => toJoinedAtMillis(a.joinedAt) - toJoinedAtMillis(b.joinedAt));
}

function toLeagueMembershipListItem(
  doc: MembershipDocumentLike,
  defaultLeagueId: string,
  source: Exclude<MembershipSource, 'none'>
): LeagueMembershipListItem {
  const data = doc.data();
  const leagueId = String(data.leagueId ?? doc.ref?.parent?.parent?.id ?? defaultLeagueId);

  return {
    id: doc.id,
    leagueId,
    userId: String(data.userId ?? (source === 'embedded' ? doc.id : '')),
    role: String(data.role ?? 'member'),
    teamName: String(data.teamName ?? ''),
    teamLogoUrl: typeof data.teamLogoUrl === 'string' ? data.teamLogoUrl : undefined,
    teamLogoPositionX:
      typeof data.teamLogoPositionX === 'number' ? data.teamLogoPositionX : undefined,
    teamLogoPositionY:
      typeof data.teamLogoPositionY === 'number' ? data.teamLogoPositionY : undefined,
    teamLogoZoom: typeof data.teamLogoZoom === 'number' ? data.teamLogoZoom : undefined,
    joinedAt: data.joinedAt,
    leftAt: data.leftAt,
    isActive: isActiveMembershipData(data),
    source,
  };
}

function toJoinedAtMillis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}
