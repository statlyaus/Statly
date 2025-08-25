import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { commonErrors } from '@/lib/apiResponse';
import { withRequestTracing } from '@/lib/requestTracing';
import type { LeagueMember, League, LeagueMemberDoc } from '@/types/leagues';
import { Timestamp } from 'firebase-admin/firestore';
import { getUserIdFromRequest } from '@/lib/serverAuth';

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
          role: 'owner'
        },
        {
          id: 'bot-member-1',
          leagueId: 'test-league-id',
          userId: 'bot-user-1',
          teamName: 'AFL Legends',
          joinedAt: Timestamp.fromMillis(Date.now() - 86400000),
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-2',
          leagueId: 'test-league-id',
          userId: 'bot-user-2',
          teamName: 'Footy Fanatics',
          joinedAt: Timestamp.fromMillis(Date.now() - 172800000),
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-3',
          leagueId: 'test-league-id',
          userId: 'bot-user-3',
          teamName: 'Goal Getters',
          joinedAt: Timestamp.fromMillis(Date.now() - 259200000),
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-4',
          leagueId: 'test-league-id',
          userId: 'bot-user-4',
          teamName: 'Mark Masters',
          joinedAt: Timestamp.fromMillis(Date.now() - 345600000),
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-5',
          leagueId: 'test-league-id',
          userId: 'bot-user-5',
          teamName: 'Tackle Titans',
          joinedAt: Timestamp.fromMillis(Date.now() - 432000000),
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-6',
          leagueId: 'test-league-id',
          userId: 'bot-user-6',
          teamName: 'Disposal Dynamos',
          joinedAt: Timestamp.fromMillis(Date.now() - 518400000),
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-7',
          leagueId: 'test-league-id',
          userId: 'bot-user-7',
          teamName: 'Inside 50 Kings',
          joinedAt: Timestamp.fromMillis(Date.now() - 604800000),
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-8',
          leagueId: 'test-league-id',
          userId: 'bot-user-8',
          teamName: 'Brownlow Medalists',
          joinedAt: Timestamp.fromMillis(Date.now() - 691200000),
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-9',
          leagueId: 'test-league-id',
          userId: 'bot-user-9',
          teamName: 'Grand Final Heroes',
          joinedAt: Timestamp.fromMillis(Date.now() - 777600000),
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-10',
          leagueId: 'test-league-id',
          userId: 'bot-user-10',
          teamName: 'Rising Stars',
          joinedAt: Timestamp.fromMillis(Date.now() - 864000000),
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-11',
          leagueId: 'test-league-id',
          userId: 'bot-user-11',
          teamName: 'Elite Defenders',
          joinedAt: Timestamp.fromMillis(Date.now() - 950400000),
          isActive: true,
          role: 'member'
        }
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

    // Convert Firestore doc shape (Timestamp) to API shape (ISO)
    const members: LeagueMember[] = membersSnapshot.docs.map((doc) => {
      const raw = doc.data() as Record<string, unknown>;
      const data = {
        leagueId: String(raw.leagueId ?? ''),
        userId: String(raw.userId ?? ''),
        role: String(raw.role ?? 'member') as LeagueMember['role'],
        teamName: String(raw.teamName ?? ''),
        joinedAt: raw.joinedAt as unknown,
        leftAt: raw.leftAt as unknown,
        isActive: Boolean(raw.isActive ?? true),
      } as {
        leagueId: string;
        userId: string;
        role: LeagueMember['role'];
        teamName: string;
        joinedAt: unknown;
        leftAt: unknown;
        isActive: boolean;
      };
      return {
        id: doc.id,
        leagueId: data.leagueId,
        userId: data.userId,
        role: data.role,
        teamName: data.teamName,
        joinedAt:
          data.joinedAt instanceof Timestamp
            ? data.joinedAt.toDate().toISOString()
            : typeof data.joinedAt === 'string'
            ? data.joinedAt
            : '',
        leftAt:
          data.leftAt instanceof Timestamp
            ? data.leftAt.toDate().toISOString()
            : typeof data.leftAt === 'string'
            ? data.leftAt
            : undefined,
        isActive: data.isActive,
      };
    });

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

  const rawMember = memberSnapshot.docs[0].data() as Record<string, unknown>;
  const memberData = {
    leagueId: String(rawMember.leagueId ?? ''),
    userId: String(rawMember.userId ?? ''),
    role: String(rawMember.role ?? 'member') as LeagueMember['role'],
    teamName: String(rawMember.teamName ?? ''),
    joinedAt: rawMember.joinedAt as unknown,
    leftAt: rawMember.leftAt as unknown,
    isActive: Boolean(rawMember.isActive ?? true),
  } as {
    leagueId: string;
    userId: string;
    role: LeagueMember['role'];
    teamName: string;
    joinedAt: unknown;
    leftAt: unknown;
    isActive: boolean;
  };
  const member: LeagueMember = {
    id: memberSnapshot.docs[0].id,
    leagueId: memberData.leagueId,
    userId: memberData.userId,
    role: memberData.role,
    teamName: memberData.teamName,
    joinedAt:
      memberData.joinedAt instanceof Timestamp
        ? memberData.joinedAt.toDate().toISOString()
        : typeof memberData.joinedAt === 'string'
        ? memberData.joinedAt
        : '',
    leftAt:
      memberData.leftAt instanceof Timestamp
        ? memberData.leftAt.toDate().toISOString()
        : typeof memberData.leftAt === 'string'
        ? memberData.leftAt
        : undefined,
    isActive: memberData.isActive,
  };

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
  const writeUpdates: Record<string, unknown> = {};
  if (allowedUpdates.teamName) writeUpdates.teamName = allowedUpdates.teamName;
  if (allowedUpdates.role) writeUpdates.role = allowedUpdates.role;
  // Optionally touch an updatedAt timestamp if schema has it
  await adminDb.collection('leagueMembers').doc(member.id).update(writeUpdates);

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
    leftAt: Timestamp.now(),
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
