import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { commonErrors } from '@/lib/apiResponse';
import { withRequestTracing } from '@/lib/requestTracing';
import type { LeagueMember, League } from '@/types/leagues';
import { Timestamp } from 'firebase-admin/firestore';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import {
  getLeagueMemberDocId,
  listActiveLeagueMembers,
  queueLeagueMembershipPatch,
  type LeagueMembershipListItem,
  type LeagueMembershipWrite,
  verifyLeagueMembership,
} from '@/lib/leagueMembership';
import { syncPrismaLeagueMember, syncPrismaLeagueOwner } from '@/lib/prismaLeagueBridge';

// GET /api/leagues/[id]/members - Get league members
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: leagueId } = await params;
  const tracer = withRequestTracing(req, { endpoint: 'league-members', leagueId });

  try {
    if (process.env.NODE_ENV !== "production" && leagueId === 'development-league-id') {
      const now = Date.now();
      const developmentMembers: LeagueMember[] = [
        {
          id: 'development-member-1',
          userId: 'statly-dev-tester',
          teamName: 'Development Champions',
          role: 'owner' as const,
        },
        ...Array.from({ length: 11 }, (_, index) => ({
          id: `development-bot-member-${index + 1}`,
          userId: `development-bot-user-${index + 1}`,
          teamName: `Development Team ${index + 1}`,
          role: 'member' as const,
        })),
      ].map((member, index) => ({
        ...member,
        leagueId,
        joinedAt: Timestamp.fromMillis(now - index * 86400000).toDate().toISOString(),
        isActive: true,
      }));

      tracer.complete(200, { memberCount: developmentMembers.length });
      return NextResponse.json({ success: true, data: developmentMembers });
    }

    const userId = await getUserIdFromRequest(req);
    if (!userId) {
      return commonErrors.unauthorized('Must be logged in');
    }

    const membership = await verifyLeagueMembership(leagueId, userId);
    if (!membership.isMember) {
      return commonErrors.forbidden('Not a member of this league');
    }

    // Verify league exists
    const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();
    if (!leagueDoc.exists) {
      return commonErrors.notFound('League not found');
    }

    const members: LeagueMember[] = (await listActiveLeagueMembers(leagueId)).map((member) => ({
      id: member.id,
      leagueId: member.leagueId,
      userId: member.userId,
      role: member.role as LeagueMember['role'],
      teamName: member.teamName,
      joinedAt: toIsoDate(member.joinedAt),
      ...(member.leftAt ? { leftAt: toIsoDate(member.leftAt) } : {}),
      isActive: member.isActive,
    }));

    tracer.complete(200, { memberCount: members.length });
    return NextResponse.json({ success: true, data: members });
  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);
    return commonErrors.internalServerError('Failed to fetch league members');
  }
}

// POST /api/leagues/[id]/members - Add member or update member settings
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: leagueId } = await params;
  const tracer = withRequestTracing(req, { endpoint: 'league-member-action', leagueId });

  try {
    const body = await req.json();
    const userId = await getUserIdFromRequest(req);

    if (!userId) {
      return commonErrors.unauthorized('Must be logged in');
    }

    const { action, targetUserId, updates } = body;

    // Get league data
    const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();
    if (!leagueDoc.exists) {
      return commonErrors.notFound('League not found');
    }

    const league = { id: leagueDoc.id, ...leagueDoc.data() } as League;

    if (!['updateMember', 'removeMember', 'transferOwnership'].includes(action)) {
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }

    const activeMembers = await listActiveLeagueMembers(leagueId);

    if (action === 'updateMember') {
      return handleUpdateMember(
        leagueId,
        userId,
        targetUserId,
        updates,
        league,
        activeMembers,
        tracer
      );
    }
    if (action === 'removeMember') {
      return handleRemoveMember(leagueId, userId, targetUserId, league, activeMembers, tracer);
    }
    return handleTransferOwnership(leagueId, userId, targetUserId, league, activeMembers, tracer);
  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);
    return commonErrors.internalServerError('Failed to process member action');
  }
}

async function handleUpdateMember(
  leagueId: string,
  userId: string,
  targetUserId: string,
  updates: Partial<LeagueMember>,
  league: League,
  activeMembers: LeagueMembershipListItem[],
  tracer: ReturnType<typeof withRequestTracing>
) {
  // Only owner or the member themselves can update member settings
  const isOwner = league.ownerId === userId;
  const isSelf = userId === targetUserId;

  if (!isOwner && !isSelf) {
    return commonErrors.forbidden('Not authorized to update this member');
  }

  const member = findActiveMember(activeMembers, targetUserId);

  if (!member) {
    return commonErrors.notFound('Member not found');
  }

  const apiMember = toApiLeagueMember(member);

  // Validate updates
  const allowedUpdates: Partial<LeagueMember> = {};

  if (updates.teamName && updates.teamName.trim()) {
    const requestedTeamName = updates.teamName.trim();
    // Check for duplicate team names
    const duplicateMember = activeMembers.find(
      (candidate) =>
        candidate.userId !== targetUserId &&
        candidate.teamName.trim().toLowerCase() === requestedTeamName.toLowerCase()
    );

    if (duplicateMember) {
      return NextResponse.json(
        { success: false, error: 'Team name already taken' },
        { status: 400 }
      );
    }

    allowedUpdates.teamName = requestedTeamName;
  }

  // Only owner can update role
  if (isOwner && updates.role && ['owner', 'admin', 'member'].includes(updates.role)) {
    allowedUpdates.role = updates.role;
  }

  // Update member
  const writeUpdates: Partial<LeagueMembershipWrite> = {};
  if (allowedUpdates.teamName) writeUpdates.teamName = allowedUpdates.teamName;
  if (allowedUpdates.role) writeUpdates.role = allowedUpdates.role;
  if (Object.keys(writeUpdates).length > 0) {
    const batch = adminDb.batch();
    queueLeagueMembershipPatch(batch, leagueId, targetUserId, writeUpdates, {
      topLevelMemberId: getTopLevelMemberId(leagueId, member),
    });
    await batch.commit();

    await syncPrismaMemberBestEffort({
      leagueId,
      userId: targetUserId,
      memberId: getTopLevelMemberId(leagueId, member),
      role: allowedUpdates.role ?? apiMember.role,
      teamName: allowedUpdates.teamName ?? apiMember.teamName,
      isActive: true,
    });
  }

  const updatedMember: LeagueMember = {
    ...apiMember,
    ...allowedUpdates,
  };

  tracer.complete(200, { updatedFields: Object.keys(allowedUpdates) });
  return NextResponse.json({
    success: true,
    data: updatedMember,
  });
}

async function handleRemoveMember(
  leagueId: string,
  userId: string,
  targetUserId: string,
  league: League,
  activeMembers: LeagueMembershipListItem[],
  tracer: ReturnType<typeof withRequestTracing>
) {
  // Only owner can remove members (or member can leave themselves)
  const isOwner = league.ownerId === userId;
  const isSelf = userId === targetUserId;

  if (!isOwner && !isSelf) {
    return commonErrors.forbidden('Not authorized to remove this member');
  }

  // Can't remove the owner
  if (targetUserId === league.ownerId) {
    return NextResponse.json(
      { success: false, error: 'Cannot remove league owner' },
      { status: 400 }
    );
  }

  const member = findActiveMember(activeMembers, targetUserId);

  if (!member) {
    return commonErrors.notFound('Member not found');
  }

  // Mark member as inactive instead of deleting
  const topLevelMemberId = getTopLevelMemberId(leagueId, member);
  const batch = adminDb.batch();
  queueLeagueMembershipPatch(
    batch,
    leagueId,
    targetUserId,
    {
      isActive: false,
      leftAt: Timestamp.now(),
    },
    {
      topLevelMemberId,
    }
  );
  await batch.commit();

  await syncPrismaMemberBestEffort({
    leagueId,
    userId: targetUserId,
    memberId: topLevelMemberId,
    isActive: false,
  });

  tracer.complete(200, { action: 'member-removed' });
  return NextResponse.json({
    success: true,
    message: 'Member removed successfully',
  });
}

async function handleTransferOwnership(
  leagueId: string,
  userId: string,
  targetUserId: string,
  league: League,
  activeMembers: LeagueMembershipListItem[],
  tracer: ReturnType<typeof withRequestTracing>
) {
  // Only current owner can transfer ownership
  if (league.ownerId !== userId) {
    return commonErrors.forbidden('Only league owner can transfer ownership');
  }

  const targetMember = findActiveMember(activeMembers, targetUserId);

  if (!targetMember) {
    return commonErrors.notFound('Target user is not a member of this league');
  }

  const ownerMember = findActiveMember(activeMembers, userId);

  const batch = adminDb.batch();

  // Update league owner
  batch.update(adminDb.collection('leagues').doc(leagueId), {
    ownerId: targetUserId,
  });

  // Update target member role to owner
  queueLeagueMembershipPatch(
    batch,
    leagueId,
    targetUserId,
    {
      role: 'owner',
    },
    {
      topLevelMemberId: getTopLevelMemberId(leagueId, targetMember),
    }
  );

  // Update current owner role to admin
  if (ownerMember) {
    queueLeagueMembershipPatch(
      batch,
      leagueId,
      userId,
      {
        role: 'admin',
      },
      {
        topLevelMemberId: getTopLevelMemberId(leagueId, ownerMember),
      }
    );
  }

  await batch.commit();

  await syncPrismaOwnerBestEffort({
    leagueId,
    ownerUserId: targetUserId,
    previousOwnerUserId: userId,
  });

  tracer.complete(200, { action: 'ownership-transferred' });
  return NextResponse.json({
    success: true,
    message: 'Ownership transferred successfully',
  });
}

async function syncPrismaMemberBestEffort(input: Parameters<typeof syncPrismaLeagueMember>[0]) {
  try {
    const result = await syncPrismaLeagueMember(input);
    if (!result.synced && result.reason !== 'no-prisma-league') {
      console.warn('Prisma league member mirror was not synced', {
        ...input,
        reason: result.reason,
      });
    }
  } catch (syncError) {
    console.warn('Failed to sync Prisma league member mirror', {
      ...input,
      error: syncError instanceof Error ? syncError.message : String(syncError),
    });
  }
}

function findActiveMember(
  members: LeagueMembershipListItem[],
  userId: string
): LeagueMembershipListItem | undefined {
  return members.find((member) => member.userId === userId);
}

function toApiLeagueMember(member: LeagueMembershipListItem): LeagueMember {
  return {
    id: member.id,
    leagueId: member.leagueId,
    userId: member.userId,
    role: member.role as LeagueMember['role'],
    teamName: member.teamName,
    joinedAt: toIsoDate(member.joinedAt),
    ...(member.leftAt ? { leftAt: toIsoDate(member.leftAt) } : {}),
    isActive: member.isActive,
  };
}

function getTopLevelMemberId(leagueId: string, member: LeagueMembershipListItem): string {
  return member.source === 'legacy' ? member.id : getLeagueMemberDocId(leagueId, member.userId);
}

function toIsoDate(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === 'string' ? value : '';
}

async function syncPrismaOwnerBestEffort(input: Parameters<typeof syncPrismaLeagueOwner>[0]) {
  try {
    const result = await syncPrismaLeagueOwner(input);
    if (!result.synced && result.reason !== 'no-prisma-league') {
      console.warn('Prisma league owner mirror was not synced', {
        ...input,
        reason: result.reason,
      });
    }
  } catch (syncError) {
    console.warn('Failed to sync Prisma league owner mirror', {
      ...input,
      error: syncError instanceof Error ? syncError.message : String(syncError),
    });
  }
}
