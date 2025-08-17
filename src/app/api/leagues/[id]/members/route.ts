import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { commonErrors } from '@/lib/apiResponse';
import { withRequestTracing } from '@/lib/requestTracing';
import type { LeagueMember, League } from '@/types/leagues';

// GET /api/leagues/[id]/members - Get league members
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const tracer = withRequestTracing(req, { endpoint: 'league-members', leagueId });

  try {
    // Handle test league for development
    if (leagueId === 'test-league-id') {
      const testMembers: LeagueMember[] = [
        {
          id: 'test-member-1',
          leagueId: 'test-league-id',
          userId: '2qlfdHSCFTPlxoKFSUfNLSlCDRe2',
          teamName: 'Robbo Rockers',
          joinedAt: new Date().toISOString(),
          isActive: true,
          role: 'owner'
        }
      ];

      tracer.complete(200, { memberCount: testMembers.length });
      return NextResponse.json({ success: true, data: testMembers });
    }

    // Verify league exists
    const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();
    if (!leagueDoc.exists) {
      return commonErrors.notFound('League not found');
    }

    // Get all active members
    const membersSnapshot = await adminDb
      .collection('leagueMembers')
      .where('leagueId', '==', leagueId)
      .where('isActive', '==', true)
      .orderBy('joinedAt', 'asc')
      .get();

    const members = membersSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as LeagueMember[];

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
    const userId = req.headers.get('x-user-id');

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

    if (action === 'updateMember') {
      return handleUpdateMember(leagueId, userId, targetUserId, updates, league, tracer);
    } else if (action === 'removeMember') {
      return handleRemoveMember(leagueId, userId, targetUserId, league, tracer);
    } else if (action === 'transferOwnership') {
      return handleTransferOwnership(leagueId, userId, targetUserId, league, tracer);
    } else {
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }
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
  tracer: ReturnType<typeof withRequestTracing>
) {
  // Only owner or the member themselves can update member settings
  const isOwner = league.ownerId === userId;
  const isSelf = userId === targetUserId;

  if (!isOwner && !isSelf) {
    return commonErrors.forbidden('Not authorized to update this member');
  }

  // Get member document
  const memberSnapshot = await adminDb
    .collection('leagueMembers')
    .where('leagueId', '==', leagueId)
    .where('userId', '==', targetUserId)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (memberSnapshot.empty) {
    return commonErrors.notFound('Member not found');
  }

  const memberDoc = memberSnapshot.docs[0];
  const member = { id: memberDoc.id, ...memberDoc.data() } as LeagueMember;

  // Validate updates
  const allowedUpdates: Partial<LeagueMember> = {};

  if (updates.teamName && updates.teamName.trim()) {
    // Check for duplicate team names
    const duplicateSnapshot = await adminDb
      .collection('leagueMembers')
      .where('leagueId', '==', leagueId)
      .where('teamName', '==', updates.teamName.trim())
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (!duplicateSnapshot.empty && duplicateSnapshot.docs[0].id !== member.id) {
      return NextResponse.json(
        { success: false, error: 'Team name already taken' },
        { status: 400 }
      );
    }

    allowedUpdates.teamName = updates.teamName.trim();
  }

  // Only owner can update role
  if (isOwner && updates.role && ['owner', 'admin', 'member'].includes(updates.role)) {
    allowedUpdates.role = updates.role;
  }

  // Update member
  await adminDb.collection('leagueMembers').doc(member.id).update(allowedUpdates);

  const updatedMember: LeagueMember = {
    ...member,
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

  // Get member document
  const memberSnapshot = await adminDb
    .collection('leagueMembers')
    .where('leagueId', '==', leagueId)
    .where('userId', '==', targetUserId)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (memberSnapshot.empty) {
    return commonErrors.notFound('Member not found');
  }

  // Mark member as inactive instead of deleting
  const memberDoc = memberSnapshot.docs[0];
  await adminDb.collection('leagueMembers').doc(memberDoc.id).update({
    isActive: false,
    leftAt: new Date().toISOString(),
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
  tracer: ReturnType<typeof withRequestTracing>
) {
  // Only current owner can transfer ownership
  if (league.ownerId !== userId) {
    return commonErrors.forbidden('Only league owner can transfer ownership');
  }

  // Verify target is a member
  const targetMemberSnapshot = await adminDb
    .collection('leagueMembers')
    .where('leagueId', '==', leagueId)
    .where('userId', '==', targetUserId)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (targetMemberSnapshot.empty) {
    return commonErrors.notFound('Target user is not a member of this league');
  }

  // Get current owner member document
  const ownerMemberSnapshot = await adminDb
    .collection('leagueMembers')
    .where('leagueId', '==', leagueId)
    .where('userId', '==', userId)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  const batch = adminDb.batch();

  // Update league owner
  batch.update(adminDb.collection('leagues').doc(leagueId), {
    ownerId: targetUserId,
  });

  // Update target member role to owner
  const targetMemberDoc = targetMemberSnapshot.docs[0];
  batch.update(targetMemberDoc.ref, {
    role: 'owner',
  });

  // Update current owner role to admin
  if (!ownerMemberSnapshot.empty) {
    const ownerMemberDoc = ownerMemberSnapshot.docs[0];
    batch.update(ownerMemberDoc.ref, {
      role: 'admin',
    });
  }

  await batch.commit();

  tracer.complete(200, { action: 'ownership-transferred' });
  return NextResponse.json({
    success: true,
    message: 'Ownership transferred successfully',
  });
}
