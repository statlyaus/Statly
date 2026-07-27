export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  listActiveLeagueMembers,
  listActiveUserLeagueMemberships,
  type LeagueMembershipListItem,
} from '@/lib/leagueMembership';
import { logger } from '@/lib/logger';
import { buildCanonicalPlayerId } from '@/lib/playerIdentity';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';

type AvailabilityStatus = 'owned' | 'your-roster' | 'waiver' | 'free-agent';
type AvailabilityActionType = 'trade' | 'waiver' | 'add' | 'roster';
type LeagueAvailabilitySource = 'prisma' | 'firestore';

interface UserLeagueContext {
  leagueId: string;
  leagueName: string;
  teamName: string;
  memberId: string;
  source: LeagueAvailabilitySource;
}

interface AvailabilityOwner {
  memberId: string;
  userId: string;
  teamName: string;
  isCurrentUser: boolean;
}

interface AvailabilityWaiver {
  processingAt?: Date;
  pendingClaims: number;
}

interface FirestoreAvailabilityStatus {
  owner?: AvailabilityOwner;
  waiver?: AvailabilityWaiver;
}

interface PlayerLeagueAvailability {
  leagueId: string;
  leagueName: string;
  teamName: string;
  source: LeagueAvailabilitySource;
  status: AvailabilityStatus;
  statusLabel: string;
  statusDetail: string;
  owner?: AvailabilityOwner;
  waiver?: {
    processingAt?: string;
    pendingClaims: number;
  };
  action: {
    type: AvailabilityActionType;
    label: string;
    href: string;
  };
}

function getActionHref(
  leagueId: string,
  playerId: string,
  type: AvailabilityActionType,
  ownerMemberId?: string
): string {
  const league = encodeURIComponent(leagueId);
  const player = encodeURIComponent(playerId);

  if (type === 'trade') {
    const owner = ownerMemberId ? `&ownerMemberId=${encodeURIComponent(ownerMemberId)}` : '';
    return `/leagues/${league}/trades?playerId=${player}${owner}`;
  }

  if (type === 'waiver') return `/leagues/${league}?tab=waivers&playerId=${player}&action=claim`;
  if (type === 'roster') return `/leagues/${league}?tab=roster&playerId=${player}`;
  return `/leagues/${league}?tab=roster&addPlayerId=${player}`;
}

function readPlayerIdFromDetails(details: string): string | null {
  try {
    const parsed = JSON.parse(details) as { playerId?: unknown };
    return typeof parsed.playerId === 'string' ? parsed.playerId : null;
  } catch {
    return null;
  }
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function getMembershipMemberId(membership: LeagueMembershipListItem): string {
  return membership.id || `${membership.leagueId}:${membership.userId}`;
}

function parsePlayerIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function loadUserLeagueContexts(userId: string): Promise<UserLeagueContext[]> {
  const contexts = new Map<string, UserLeagueContext>();
  const prismaMemberships = await prisma.leagueMember
    .findMany({
      where: { userId },
      include: {
        league: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    })
    .catch((error) => {
      logger.warn('Prisma league memberships unavailable for player availability', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });

  for (const membership of prismaMemberships) {
    contexts.set(membership.leagueId, {
      leagueId: membership.leagueId,
      leagueName: membership.league.name,
      teamName: membership.teamName,
      memberId: membership.id,
      source: 'prisma',
    });
  }

  try {
    const firestoreMemberships = await listActiveUserLeagueMemberships(userId);
    const missingFirestoreMemberships = firestoreMemberships.filter(
      (membership) => membership.leagueId && !contexts.has(membership.leagueId)
    );
    const firestoreLeagueDocs = await Promise.all(
      missingFirestoreMemberships.map(async (membership) => ({
        membership,
        snap: await adminDb.collection('leagues').doc(membership.leagueId).get(),
      }))
    );

    for (const { membership, snap } of firestoreLeagueDocs) {
      const data = snap.data() ?? {};
      contexts.set(membership.leagueId, {
        leagueId: membership.leagueId,
        leagueName: String(data.name ?? data.leagueName ?? membership.leagueId),
        teamName: membership.teamName || 'My team',
        memberId: getMembershipMemberId(membership),
        source: 'firestore',
      });
    }
  } catch (error) {
    logger.warn('Firestore memberships unavailable for player availability; using Prisma data', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return Array.from(contexts.values());
}

async function loadFirestoreOwnership(input: {
  leagueId: string;
  playerIds: string[];
  currentUserId: string;
}): Promise<FirestoreAvailabilityStatus> {
  const leagueRef = adminDb.collection('leagues').doc(input.leagueId);
  const [members, ownershipDocs, availableDocs, rosterSnaps, waiverSnaps] = await Promise.all([
    listActiveLeagueMembers(input.leagueId).catch(() => []),
    Promise.all(input.playerIds.map((playerId) => leagueRef.collection('playerOwnerships').doc(playerId).get())),
    Promise.all(input.playerIds.map((playerId) => leagueRef.collection('availablePlayers').doc(playerId).get())),
    Promise.all(
      input.playerIds.map((playerId) =>
        leagueRef.collection('rosters').where('playerIds', 'array-contains', playerId).limit(1).get()
      )
    ),
    Promise.all(
      input.playerIds.map((playerId) =>
        leagueRef
          .collection('waivers')
          .where('playerId', '==', playerId)
          .where('status', '==', 'PENDING')
          .limit(20)
          .get()
      )
    ),
  ]);

  const memberById = new Map<string, LeagueMembershipListItem>();
  const memberByUserId = new Map<string, LeagueMembershipListItem>();
  for (const member of members) {
    memberById.set(member.id, member);
    memberById.set(getMembershipMemberId(member), member);
    memberByUserId.set(member.userId, member);
  }

  const ownershipDoc = ownershipDocs.find((doc) => doc.exists);
  const availableDoc = availableDocs.find((doc) => doc.exists);
  const rosterSnap = rosterSnaps.find((snap) => !snap.empty);
  const ownershipData = ownershipDoc?.data() ?? null;
  const availableData = availableDoc?.data() ?? null;
  const ownershipMemberId =
    typeof ownershipData?.memberId === 'string'
      ? ownershipData.memberId
      : typeof availableData?.memberId === 'string' && availableData.status === 'owned'
        ? availableData.memberId
        : null;
  const ownershipUserId =
    typeof ownershipData?.userId === 'string'
      ? ownershipData.userId
      : typeof availableData?.userId === 'string'
        ? availableData.userId
        : null;

  let ownerMember = ownershipMemberId ? memberById.get(ownershipMemberId) : undefined;
  if (!ownerMember && ownershipUserId) ownerMember = memberByUserId.get(ownershipUserId);

  if (!ownerMember && rosterSnap && !rosterSnap.empty) {
    const rosterDoc = rosterSnap.docs[0];
    const rosterData = rosterDoc.data();
    const rosterUserId = typeof rosterData.userId === 'string' ? rosterData.userId : rosterDoc.id;
    ownerMember = memberByUserId.get(rosterUserId) ?? memberById.get(rosterDoc.id);
  }

  const owner = ownerMember
    ? {
        memberId: getMembershipMemberId(ownerMember),
        userId: ownerMember.userId,
        teamName: ownerMember.teamName || 'Team',
        isCurrentUser: ownerMember.userId === input.currentUserId,
      }
    : undefined;

  let earliestProcessingAt: Date | undefined;
  let pendingClaims = 0;
  const availableProcessingAt = toDate(availableData?.processingAt);
  if (availableData?.status === 'waiver') {
    if (availableProcessingAt && availableProcessingAt.getTime() > Date.now()) {
      earliestProcessingAt = availableProcessingAt;
    }
    pendingClaims = 0;
  }
  for (const waiversSnap of waiverSnaps) {
    waiversSnap.forEach((doc) => {
      const data = doc.data();
      const processingAt = toDate(data.processingAt);
      if (processingAt && processingAt.getTime() > Date.now()) {
        pendingClaims += 1;
        if (!earliestProcessingAt || processingAt < earliestProcessingAt) {
          earliestProcessingAt = processingAt;
        }
      }
    });
  }

  return {
    ...(owner ? { owner } : {}),
    ...(pendingClaims > 0 || earliestProcessingAt
      ? { waiver: { ...(earliestProcessingAt ? { processingAt: earliestProcessingAt } : {}), pendingClaims } }
      : {}),
  };
}

function serializeWaiver(waiver: AvailabilityWaiver): PlayerLeagueAvailability['waiver'] {
  return {
    ...(waiver.processingAt ? { processingAt: waiver.processingAt.toISOString() } : {}),
    pendingClaims: waiver.pendingClaims,
  };
}

function buildAvailabilityRow(input: {
  league: UserLeagueContext;
  playerId: string;
  owner?: AvailabilityOwner;
  waiver?: AvailabilityWaiver;
}): PlayerLeagueAvailability {
  if (input.owner) {
    const actionType: AvailabilityActionType = input.owner.isCurrentUser ? 'roster' : 'trade';
    return {
      leagueId: input.league.leagueId,
      leagueName: input.league.leagueName,
      teamName: input.league.teamName,
      source: input.league.source,
      status: input.owner.isCurrentUser ? 'your-roster' : 'owned',
      statusLabel: input.owner.isCurrentUser ? 'On your roster' : 'Owned',
      statusDetail: input.owner.isCurrentUser
        ? `Rostered by ${input.league.teamName}`
        : `Owned by ${input.owner.teamName}`,
      owner: input.owner,
      action: {
        type: actionType,
        label: input.owner.isCurrentUser ? 'View roster' : 'Trade',
        href: getActionHref(input.league.leagueId, input.playerId, actionType, input.owner.memberId),
      },
    };
  }

  if (input.waiver) {
    return {
      leagueId: input.league.leagueId,
      leagueName: input.league.leagueName,
      teamName: input.league.teamName,
      source: input.league.source,
      status: 'waiver',
      statusLabel: 'Waivers',
      statusDetail: input.waiver.processingAt
        ? `Claims process ${input.waiver.processingAt.toISOString()}`
        : `${input.waiver.pendingClaims} pending claim${input.waiver.pendingClaims === 1 ? '' : 's'}`,
      waiver: serializeWaiver(input.waiver),
      action: {
        type: 'waiver',
        label: 'Waiver claim',
        href: getActionHref(input.league.leagueId, input.playerId, 'waiver'),
      },
    };
  }

  return {
    leagueId: input.league.leagueId,
    leagueName: input.league.leagueName,
    teamName: input.league.teamName,
    source: input.league.source,
    status: 'free-agent',
    statusLabel: 'Free agent',
    statusDetail: 'Not rostered in this league',
    action: {
      type: 'add',
      label: 'Add player',
      href: getActionHref(input.league.leagueId, input.playerId, 'add'),
    },
  };
}

function titleCaseName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`)
    .join(' ');
}

async function resolvePlayerIdentityCandidates(requestedPlayerId: string): Promise<string[]> {
  const normalized = requestedPlayerId.trim();
  const slugAsWords = normalized.replace(/[_-]+/g, ' ').trim();
  const tokens = slugAsWords.split(/\s+/).filter(Boolean);
  const possibleNames = new Set<string>();

  if (slugAsWords) possibleNames.add(titleCaseName(slugAsWords));
  for (let length = tokens.length - 1; length >= 2; length -= 1) {
    possibleNames.add(titleCaseName(tokens.slice(0, length).join(' ')));
  }

  const seedIds = new Set(
    [
      normalized,
      normalized.replace(/-/g, '_'),
      buildCanonicalPlayerId(slugAsWords),
      ...Array.from(possibleNames).map(buildCanonicalPlayerId),
    ].filter(Boolean)
  );

  const players = await prisma.player
    .findMany({
      where: {
        OR: [
          { id: { in: Array.from(seedIds) } },
          ...Array.from(possibleNames).map((name) => ({ name })),
        ],
      },
      select: {
        id: true,
      },
      take: 20,
    })
    .catch((error) => {
      logger.warn('Prisma player id resolution unavailable for availability lookup', {
        requestedPlayerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });

  for (const player of players) seedIds.add(player.id);
  return Array.from(seedIds);
}

async function loadPrismaOwnerships(input: {
  leagueIds: string[];
  playerIds: string[];
  userId: string;
}): Promise<Map<string, AvailabilityOwner>> {
  if (input.leagueIds.length === 0 || input.playerIds.length === 0) return new Map();
  const ownerByLeagueId = new Map<string, AvailabilityOwner>();

  const ownerships = await prisma.leagueRosterPlayer
    .findMany({
      where: {
        leagueId: { in: input.leagueIds },
        playerId: { in: input.playerIds },
      },
      select: {
        leagueId: true,
        memberId: true,
        member: {
          select: {
            id: true,
            userId: true,
            teamName: true,
          },
        },
      },
    })
    .catch((error) => {
      logger.warn('Prisma roster ownership unavailable for player availability', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });

  for (const ownership of ownerships) {
    ownerByLeagueId.set(ownership.leagueId, {
        memberId: ownership.memberId,
        userId: ownership.member.userId,
        teamName: ownership.member.teamName,
        isCurrentUser: ownership.member.userId === input.userId,
    });
  }

  const missingLeagueIds = input.leagueIds.filter((leagueId) => !ownerByLeagueId.has(leagueId));
  if (missingLeagueIds.length === 0) return ownerByLeagueId;

  const rosterRows = await prisma.leagueRoster
    .findMany({
      where: { leagueId: { in: missingLeagueIds } },
      select: { leagueId: true, memberId: true, playerIds: true },
    })
    .catch((error) => {
      logger.warn('Prisma JSON rosters unavailable for player availability', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });
  const playerIdSet = new Set(input.playerIds);
  const matchingRosterRows = rosterRows.filter((row) =>
    parsePlayerIds(row.playerIds).some((playerId) => playerIdSet.has(playerId))
  );

  const draftPicks = await prisma.pick
    .findMany({
      where: {
        playerId: { in: input.playerIds },
        draft: { leagueId: { in: missingLeagueIds } },
      },
      select: {
        playerId: true,
        memberId: true,
        draft: { select: { leagueId: true } },
        member: { select: { userId: true, teamName: true } },
      },
    })
    .catch((error) => {
      logger.warn('Prisma draft picks unavailable for player availability', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });

  const rosterMemberIds = matchingRosterRows.map((row) => row.memberId);
  const rosterMembers =
    rosterMemberIds.length > 0
      ? await prisma.leagueMember
          .findMany({
            where: { id: { in: rosterMemberIds } },
            select: { id: true, userId: true, teamName: true },
          })
          .catch(() => [])
      : [];
  const memberById = new Map(rosterMembers.map((member) => [member.id, member]));

  for (const row of matchingRosterRows) {
    if (ownerByLeagueId.has(row.leagueId)) continue;
    const member = memberById.get(row.memberId);
    if (!member) continue;
    ownerByLeagueId.set(row.leagueId, {
      memberId: row.memberId,
      userId: member.userId,
      teamName: member.teamName,
      isCurrentUser: member.userId === input.userId,
    });
  }

  for (const pick of draftPicks) {
    const leagueId = pick.draft.leagueId;
    if (ownerByLeagueId.has(leagueId)) continue;
    ownerByLeagueId.set(leagueId, {
      memberId: pick.memberId,
      userId: pick.member.userId,
      teamName: pick.member.teamName,
      isCurrentUser: pick.member.userId === input.userId,
    });
  }

  return ownerByLeagueId;
}

async function loadPrismaWaivers(input: {
  leagueIds: string[];
  playerIds: string[];
}): Promise<Map<string, AvailabilityWaiver>> {
  const waiversByLeagueId = new Map<string, AvailabilityWaiver>();
  if (input.leagueIds.length === 0 || input.playerIds.length === 0) return waiversByLeagueId;

  const pendingWaiverActions = await prisma.teamAction
    .findMany({
      where: {
        leagueId: { in: input.leagueIds },
        actionType: { in: ['WAIVER_CLAIM', 'DROP_PLAYER'] },
        status: 'PENDING',
        processingAt: { gt: new Date() },
      },
      select: {
        leagueId: true,
        details: true,
        processingAt: true,
      },
      orderBy: { processingAt: 'asc' },
    })
    .catch((error) => {
      logger.warn('Prisma waiver actions unavailable for player availability', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });

  const playerIdSet = new Set(input.playerIds);
  for (const action of pendingWaiverActions) {
    const actionPlayerId = readPlayerIdFromDetails(action.details);
    if (!actionPlayerId || !playerIdSet.has(actionPlayerId)) continue;
    const current = waiversByLeagueId.get(action.leagueId);
    waiversByLeagueId.set(action.leagueId, {
      processingAt: current?.processingAt ?? action.processingAt ?? undefined,
      pendingClaims: (current?.pendingClaims ?? 0) + 1,
    });
  }

  return waiversByLeagueId;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const requestedPlayerId = decodeURIComponent(id);

  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return commonErrors.unauthorized();

    const leagueContexts = await loadUserLeagueContexts(userId);
    const leagueIds = leagueContexts.map((league) => league.leagueId);
    const playerIds = await resolvePlayerIdentityCandidates(requestedPlayerId);

    if (leagueIds.length === 0) {
      return successResponse({
        playerId: requestedPlayerId,
        playerIds,
        leagues: [] satisfies PlayerLeagueAvailability[],
        generatedAt: new Date().toISOString(),
      });
    }

    const [ownershipByLeagueId, waiversByLeagueId, firestoreStatuses] = await Promise.all([
      loadPrismaOwnerships({ leagueIds, playerIds, userId }),
      loadPrismaWaivers({ leagueIds, playerIds }),
      Promise.all(
        leagueContexts.map(async (league) => ({
          leagueId: league.leagueId,
          status: await loadFirestoreOwnership({
            leagueId: league.leagueId,
            playerIds,
            currentUserId: userId,
          }).catch((): FirestoreAvailabilityStatus => ({})),
        }))
      ),
    ]);

    const firestoreStatusByLeagueId = new Map(
      firestoreStatuses.map((item) => [item.leagueId, item.status])
    );

    const leagues = leagueContexts.map((league) => {
      const firestoreStatus = firestoreStatusByLeagueId.get(league.leagueId);
      return buildAvailabilityRow({
        league,
        playerId: requestedPlayerId,
        owner: ownershipByLeagueId.get(league.leagueId) ?? firestoreStatus?.owner,
        waiver: waiversByLeagueId.get(league.leagueId) ?? firestoreStatus?.waiver,
      });
    });

    return successResponse({
      playerId: requestedPlayerId,
      playerIds,
      leagues,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to fetch player availability', error, { playerId: requestedPlayerId });
    return commonErrors.internalServerError('Failed to fetch player availability');
  }
}
