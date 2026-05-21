import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { Timestamp } from 'firebase-admin/firestore';

import { commonErrors } from '@/lib/apiResponse';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { authorizeLocalOnlyRequest } from '@/lib/operationalAuth';
import { withRequestTracing } from '@/lib/requestTracing';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import { leagueDraftProvisioningService } from '@/server/draft/services/LeagueDraftProvisioningService';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';
import type { LeagueMember, LeagueMemberDoc } from '@/types/leagues';
export const runtime = 'nodejs';

// GET /api/leagues/[id]/members - Get league members
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const tracer = withRequestTracing(req, { endpoint: 'league-members', leagueId });

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) {
      return commonErrors.unauthorized('Must be logged in');
    }

    if (leagueId === 'test-league-id') {
      const authorization = authorizeLocalOnlyRequest();
      if (!authorization.ok) {
        return authorization.response;
      }

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
      ];

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

    const membership = await verifyLeagueMembership(leagueId, userId);
    if (!membership.isMember) {
      return commonErrors.forbidden('Must be a league member');
    }

    const members = await leagueApplicationService.getLeagueMembers(leagueId);
    if (!members) {
      return commonErrors.notFound('League not found');
    }

    tracer.complete(200, { memberCount: members.length });
    return NextResponse.json({ success: true, data: members });
  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);
    return commonErrors.internalServerError('Failed to fetch league members');
  }
}

// POST /api/leagues/[id]/members - Update member settings or membership state
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const tracer = withRequestTracing(req, { endpoint: 'league-member-action', leagueId });

  try {
    const body = await req.json();
    const userId = await getUserIdFromRequest(req);

    if (!userId) {
      return commonErrors.unauthorized('Must be logged in');
    }

    const { action, targetUserId, updates } = body as {
      action?: string;
      targetUserId?: string;
      updates?: Partial<LeagueMember> & { draftSlot?: number };
      orderedUserIds?: string[];
    };

    if (action === 'reorderDraftSlots') {
      const orderedUserIds = Array.isArray((body as { orderedUserIds?: unknown })?.orderedUserIds)
        ? (body as { orderedUserIds: unknown[] }).orderedUserIds.filter(
            (value): value is string => typeof value === 'string'
          )
        : [];

      const updatedMembers = await leagueApplicationService.reorderLeagueDraftSlots({
        leagueId,
        actorUserId: userId,
        orderedUserIds,
      });

      const draftProvisioning =
        await leagueDraftProvisioningService.syncFromLeagueSettings(leagueId);

      tracer.complete(200, { action, orderedUserCount: orderedUserIds.length });
      return NextResponse.json({
        success: true,
        data: {
          members: updatedMembers,
          draftProvisioning,
        },
      });
    }

    if (!targetUserId) {
      return NextResponse.json(
        { success: false, error: 'targetUserId is required' },
        { status: 400 }
      );
    }

    if (action === 'updateMember') {
      const updated = await leagueApplicationService.updateLeagueMember({
        leagueId,
        actorUserId: userId,
        targetUserId,
        updates: updates || {},
      });

      tracer.complete(200, { action, targetUserId });
      return NextResponse.json({ success: true, data: updated });
    }

    if (action === 'removeMember') {
      await leagueApplicationService.removeLeagueMember({
        leagueId,
        actorUserId: userId,
        targetUserId,
      });

      tracer.complete(200, { action, targetUserId });
      return NextResponse.json({
        success: true,
        message: 'Member removed successfully',
      });
    }

    if (action === 'transferOwnership') {
      await leagueApplicationService.transferLeagueOwnership({
        leagueId,
        actorUserId: userId,
        targetUserId,
      });

      tracer.complete(200, { action, targetUserId });
      return NextResponse.json({
        success: true,
        message: 'Ownership transferred successfully',
      });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('not_found:')) {
      tracer.complete(404, { error: message });
      return commonErrors.notFound(message.replace('not_found:', ''));
    }

    if (message.startsWith('forbidden:')) {
      tracer.complete(403, { error: message });
      return commonErrors.forbidden(message.replace('forbidden:', ''));
    }

    if (message.startsWith('bad_request:')) {
      tracer.complete(400, { error: message });
      return NextResponse.json(
        { success: false, error: message.replace('bad_request:', '') },
        { status: 400 }
      );
    }

    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);
    return commonErrors.internalServerError('Failed to process member action');
  }
}
