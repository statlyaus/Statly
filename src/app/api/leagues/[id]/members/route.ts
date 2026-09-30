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
import { syncPrismaLeagueMember } from '@/lib/prismaLeagueBridge';
import {
  removeLeagueMember,
  transferLeagueOwnership,
  type MemberCommandFailureCode,
  type MemberCommandInput,
} from '@/server/leagues/memberCommands';

// GET /api/leagues/[id]/members - Get league members
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: leagueId } = await params;
  const tracer = withRequestTracing(req, { endpoint: 'league-members', leagueId });

  try {
    if (process.env.NODE_ENV !== 'production' && leagueId === 'development-league-id') {
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
        joinedAt: Timestamp.fromMillis(now - index * 86400000)
          .toDate()
          .toISOString(),
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

    if (!['updateMember', 'removeMember', 'transferOwnership'].includes(action)) {
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }

    const commandInput = { leagueId, actorUserId: userId, targetUserId };
    if (action === 'removeMember') {
      return handleRemoveMember(commandInput, tracer);
    }
    if (action === 'transferOwnership') {
      return handleTransferOwnership(commandInput, tracer);
    }

    // Get league data
    const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();
    if (!leagueDoc.exists) {
      return commonErrors.notFound('League not found');
    }

    const league = { id: leagueDoc.id, ...leagueDoc.data() } as League;
    const activeMembers = await listActiveLeagueMembers(leagueId);

    return handleUpdateMember(
      leagueId,
      userId,
      targetUserId,
      updates,
      league,
      activeMembers,
      tracer
    );
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
  input: MemberCommandInput,
  tracer: ReturnType<typeof withRequestTracing>
) {
  const result = await removeLeagueMember(input);
  if (!result.ok) return memberCommandFailure(result);

  await projectToFirestoreBestEffort('member-removed', input, async () => {
    const member = findActiveMember(
      await listActiveLeagueMembers(input.leagueId),
      input.targetUserId
    );
    const batch = adminDb.batch();
    if (member) {
      queueLeagueMembershipPatch(
        batch,
        input.leagueId,
        input.targetUserId,
        { isActive: false, leftAt: Timestamp.now() },
        { topLevelMemberId: getTopLevelMemberId(input.leagueId, member) }
      );
    }
    batch.update(adminDb.collection('leagues').doc(input.leagueId), {
      memberCount: result.data.memberCount,
    });
    await batch.commit();
  });

  tracer.complete(200, { action: 'member-removed' });
  return NextResponse.json({
    success: true,
    message: 'Member removed successfully',
    data: result.data,
  });
}

async function handleTransferOwnership(
  input: MemberCommandInput,
  tracer: ReturnType<typeof withRequestTracing>
) {
  const result = await transferLeagueOwnership(input);
  if (!result.ok) return memberCommandFailure(result);

  await projectToFirestoreBestEffort('ownership-transferred', input, async () => {
    const activeMembers = await listActiveLeagueMembers(input.leagueId);
    const targetMember = findActiveMember(activeMembers, input.targetUserId);
    const ownerMember = findActiveMember(activeMembers, input.actorUserId);
    const batch = adminDb.batch();
    batch.update(adminDb.collection('leagues').doc(input.leagueId), {
      ownerId: input.targetUserId,
    });
    if (targetMember) {
      queueLeagueMembershipPatch(
        batch,
        input.leagueId,
        input.targetUserId,
        { role: 'owner' },
        { topLevelMemberId: getTopLevelMemberId(input.leagueId, targetMember) }
      );
    }
    if (ownerMember) {
      queueLeagueMembershipPatch(
        batch,
        input.leagueId,
        input.actorUserId,
        { role: 'member' },
        { topLevelMemberId: getTopLevelMemberId(input.leagueId, ownerMember) }
      );
    }
    await batch.commit();
  });

  tracer.complete(200, { action: 'ownership-transferred' });
  return NextResponse.json({
    success: true,
    message: 'Ownership transferred successfully',
  });
}

const MEMBER_COMMAND_STATUS: Record<MemberCommandFailureCode, number> = {
  'league-not-found': 404,
  forbidden: 403,
  'member-not-found': 404,
  'owner-cannot-be-removed': 400,
  'draft-started': 409,
};

function memberCommandFailure(result: { code: MemberCommandFailureCode; message: string }) {
  return NextResponse.json(
    { success: false, error: result.message, code: result.code },
    { status: MEMBER_COMMAND_STATUS[result.code] }
  );
}

/**
 * Prisma has already committed the command. Firestore is a compatibility projection, so a failed
 * projection is logged for repair rather than reported as a failed command.
 */
async function projectToFirestoreBestEffort(
  action: string,
  input: MemberCommandInput,
  project: () => Promise<void>
) {
  try {
    await project();
  } catch (projectionError) {
    console.warn('Failed to project league member command to Firestore', {
      action,
      ...input,
      error: projectionError instanceof Error ? projectionError.message : String(projectionError),
    });
  }
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
