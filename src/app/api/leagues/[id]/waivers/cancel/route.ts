import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { logger } from '@/lib/logger';
import { withMetrics } from '@/lib/metrics';
import { logLeagueActivity } from '@/lib/activity';
import { revalidateTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { getLeagueMembership, isLeagueManagerRole } from '@/lib/leagueMembership';
import { PrismaWaiverClaimStore } from '@/server/waivers/WaiverProcessingService';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withMetrics(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id: leagueId } = await params;

      // AuthN
      const callerId = await getAuthenticatedUserId(req);
      if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      // Validate leagueId format
      if (!leagueId || typeof leagueId !== 'string' || leagueId.trim() === '') {
        return NextResponse.json({ error: 'Invalid league ID' }, { status: 400 });
      }

      const { claimId } = await req.json();
      if (!claimId || typeof claimId !== 'string') {
        return NextResponse.json({ error: 'Invalid claimId' }, { status: 400 });
      }

      logger.apiRequest('POST', `/api/leagues/${leagueId}/waivers/cancel`, { callerId, claimId });
      const waiverStore = new PrismaWaiverClaimStore();
      const claim = await waiverStore.loadClaim(leagueId, claimId);
      if (!claim) {
        return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
      }

      // AuthZ: owner of the claim or league admin/commissioner/owner
      const membership = await getLeagueMembership(leagueId, callerId);
      if (!membership.isMember) {
        // User is not a member of this league
        return NextResponse.json({ error: 'Not a league member' }, { status: 403 });
      }

      if (claim.userId !== callerId && !isLeagueManagerRole(membership.data?.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      if (claim.status !== 'PENDING') {
        return NextResponse.json(
          { error: 'Only pending claims can be cancelled' },
          { status: 409 }
        );
      }

      await waiverStore.cancelPendingClaim({
        leagueId,
        claimId,
        claim,
        cancelledBy: callerId,
      });

      // audit: waiver-cancelled via shared helper
      await logLeagueActivity(leagueId, 'waiver-cancelled', {
        userId: claim.userId,
        teamId: claim.teamId,
        playerId: claim.playerId,
        dropPlayerId: claim.dropPlayerId,
        bidAmount: claim.bidAmount,
        claimId,
        cancelledBy: callerId,
      });

      logger.info('waiver cancelled', { leagueId, callerId, claimId });
      try {
        revalidateTag(tags.waivers(leagueId));
        revalidateTag(tags.league(leagueId));
      } catch (revalErr) {
        logger.warn('Failed to revalidate tags after waiver cancel', {
          leagueId,
          tags: [tags.waivers(leagueId), tags.league(leagueId)],
          error:
            revalErr instanceof Error
              ? { name: revalErr.name, message: revalErr.message, stack: revalErr.stack }
              : undefined,
        });
      }
      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (err) {
      logger.apiError('POST', '/api/leagues/[id]/waivers/cancel', err);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  'POST /api/leagues/[id]/waivers/cancel'
);
