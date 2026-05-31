import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { commonErrors } from '@/lib/apiResponse';
import { withRequestTracing } from '@/lib/requestTracing';
import type { LeagueMember, League, LeagueMemberDoc } from '@/types/leagues';
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
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const tracer = withRequestTracing(req, { endpoint: 'league-members', leagueId });

  try {
    // Handle test league for development
    if (leagueId === 'test-league-id') {
      const testMembersDoc: LeagueMemberDoc[] = [
        {
          id: 'test-member-1',
          leagueId: 'test-league-id',
          userId: '2qlfdHSCFTPlxoKFSUfNLSlCDRe2',
          teamName: 'Robbo Rockers',
          joinedAt: Timestamp.now(),
          isActive: true,
          role: 'owner',
        },
        {
          id: 'bot-member-1',
          leagueId: 'test-league-id',
          userId: 'bot-user-1',
          teamName: 'AFL Legends',
          joinedAt: Timestamp.fromMillis(Date.now() - 86400000),
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-2',
          leagueId: 'test-league-id',
          userId: 'bot-user-2',
          teamName: 'Footy Fanatics',
          joinedAt: Timestamp.fromMillis(Date.now() - 172800000),
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-3',
          leagueId: 'test-league-id',
          userId: 'bot-user-3',
          teamName: 'Goal Getters',
          joinedAt: Timestamp.fromMillis(Date.now() - 259200000),
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-4',
          leagueId: 'test-league-id',
          userId: 'bot-user-4',
          teamName: 'Mark Masters',
          joinedAt: Timestamp.fromMillis(Date.now() - 345600000),
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-5',
          leagueId: 'test-league-id',
          userId: 'bot-user-5',
          teamName: 'Tackle Titans',
          joinedAt: Timestamp.fromMillis(Date.now() - 432000000),
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-6',
          leagueId: 'test-league-id',
          userId: 'bot-user-6',
          teamName: 'Disposal Dynamos',
          joinedAt: Timestamp.fromMillis(Date.now() - 518400000),
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-7',
          leagueId: 'test-league-id',
          userId: 'bot-user-7',
          teamName: 'Inside 50 Kings',
          joinedAt: Timestamp.fromMillis(Date.now() - 604800000),
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-8',
          leagueId: 'test-league-id',
          userId: 'bot-user-8',
          teamName: 'Brownlow Medalists',
          joinedAt: Timestamp.fromMillis(Date.now() - 691200000),
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-9',
          leagueId: 'test-league-id',
          userId: 'bot-user-9',
          teamName: 'Grand Final Heroes',
          joinedAt: Timestamp.fromMillis(Date.now() - 777600000),
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-10',
          leagueId: 'test-league-id',
          userId: 'bot-user-10',
          teamName: 'Rising Stars',
          joinedAt: Timestamp.fromMillis(Date.now() - 864000000),
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-11',
          leagueId: 'test-league-id',
          userId: 'bot-user-11',
          teamName: 'Elite Defenders',
          joinedAt: Timestamp.fromMillis(Date.now() - 950400000),
          isActive: true,
          role: 'member',
        },
      ];

      // Convert to API shape (ISO strings)
      const testMembers: LeagueMember[] = testMembersDoc
        .sort((a, b) => a.joinedAt.toMillis() - b.joinedAt.toMillis())
        .map((m) => ({
          id: m.id,
          leagueId: m.leagueId,
          userId: m.userId,
          role: m.role,
          teamName: m.teamName,
          joinedAt: m.joinedAt.toDate().toISOString(),
          isActive: m.isActive,
        }));

      tracer.complete(200, { memberCount: testMembers.length });
      return NextResponse.json({ success: true, data: testMembers });
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
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
