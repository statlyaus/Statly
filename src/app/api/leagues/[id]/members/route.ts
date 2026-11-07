import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { commonErrors } from '@/lib/apiResponse';
import { withRequestTracing } from '@/lib/requestTracing';
import { prisma } from '@/lib/prisma';
import type { LeagueMember } from '@/types/leagues';
import { Timestamp } from 'firebase-admin/firestore';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import {
  getLeagueMemberDocId,
  listActiveFirestoreLeagueMembers,
  listActiveLeagueMembers,
  queueLeagueMembershipPatch,
  type LeagueMembershipListItem,
  verifyLeagueMembership,
} from '@/lib/leagueMembership';
import {
  removeLeagueMember,
  transferLeagueOwnership,
  updateLeagueMember,
  type MemberCommandFailureCode,
  type MemberCommandInput,
  type UpdateLeagueMemberInput,
  type UpdateMemberFailureCode,
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

    // Prisma owns leagues. A league with no Prisma row is legacy data and is not found; the
    // Firestore copy never decides whether a league exists or who belongs to it.
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true },
    });
    if (!league) {
      return commonErrors.notFound('League not found');
    }

    const membership = await verifyLeagueMembership(leagueId, userId);
    if (!membership.isMember) {
      return commonErrors.forbidden('Not a member of this league');
    }

    const members = (await listActiveLeagueMembers(leagueId)).map(toApiLeagueMember);

    tracer.complete(200, { memberCount: members.length });
    return NextResponse.json({ success: true, data: members });
  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);
    return commonErrors.internalServerError('Failed to fetch league members');
  }
}

// POST /api/leagues/[id]/members - Update or remove a member, or transfer ownership
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

    return handleUpdateMember(
      { ...commandInput, teamName: updates?.teamName, role: updates?.role },
      tracer
    );
  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);
    return commonErrors.internalServerError('Failed to process member action');
  }
}

/**
 * Updates a member through the Prisma command, then writes the Firestore projection.
 */
async function handleUpdateMember(
  input: UpdateLeagueMemberInput,
  tracer: ReturnType<typeof withRequestTracing>
) {
  const result = await updateLeagueMember(input);
  if (!result.ok) return memberCommandFailure(result);

  await projectToFirestoreBestEffort('member-updated', input, async () => {
    const member = findActiveMember(
      await listActiveFirestoreLeagueMembers(input.leagueId),
      input.targetUserId
    );
    if (!member) return;
    const batch = adminDb.batch();
    queueLeagueMembershipPatch(
      batch,
      input.leagueId,
      input.targetUserId,
      { teamName: result.data.teamName, role: result.data.role },
      { topLevelMemberId: getTopLevelMemberId(input.leagueId, member) }
    );
    await batch.commit();
  });

  tracer.complete(200, { action: 'member-updated' });
  return NextResponse.json({ success: true, data: result.data });
}

async function handleRemoveMember(
  input: MemberCommandInput,
  tracer: ReturnType<typeof withRequestTracing>
) {
  const result = await removeLeagueMember(input);
  if (!result.ok) return memberCommandFailure(result);

  await projectToFirestoreBestEffort('member-removed', input, async () => {
    const member = findActiveMember(
      await listActiveFirestoreLeagueMembers(input.leagueId),
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
    const activeMembers = await listActiveFirestoreLeagueMembers(input.leagueId);
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

const MEMBER_COMMAND_STATUS: Record<MemberCommandFailureCode | UpdateMemberFailureCode, number> = {
  'league-not-found': 404,
  forbidden: 403,
  'member-not-found': 404,
  'owner-cannot-be-removed': 400,
  'draft-started': 409,
  'team-name-taken': 400,
};

function memberCommandFailure(result: {
  code: MemberCommandFailureCode | UpdateMemberFailureCode;
  message: string;
}) {
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
