import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { logger, withTiming } from '@/lib/logger';
import { withMetrics } from '@/lib/metrics';
import { getLeagueMembershipAccess } from '@/server/leagues/membership';
import {
  getTransactionWindow,
  transactionsClosedResponse,
} from '@/server/leagues/transactionWindow';
import {
  PrismaWaiverClaimStore,
  WaiverClaimStoreError,
} from '@/server/waivers/WaiverProcessingService';
import { resolveCanonicalPlayerId } from '@/server/players/playerIdentityService';
import { findWaiverPlayerAliasIds } from '@/server/waivers/waiverPlayerIdentity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withMetrics(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const { id: leagueId } = await context.params;
      if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 });

      const userId = await getAuthenticatedUserId(req);
      if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const body = await req.json().catch(() => ({}));
      const { teamId, playerId, dropPlayerId, priority = 1, bidAmount } = body || {};

      if (!teamId || !playerId) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      logger.apiRequest('POST', `/api/leagues/${leagueId}/waivers/submit`, {
        userId,
        teamId,
        playerId,
      });
      const access = await getLeagueMembershipAccess(leagueId, userId);
      if (!access.isMember) {
        return NextResponse.json({ error: 'League membership required' }, { status: 403 });
      }
      const transactionWindow = await getTransactionWindow(leagueId, prisma, {
        memberId: access.memberId,
      });
      if (!transactionWindow.open) return transactionsClosedResponse(transactionWindow);

      const requestedPlayerId = String(playerId);
      const activePlayers = await prisma.player.findMany({
        where: { active: true },
        select: { id: true, name: true, club: true, position: true },
      });
      const resolvedPlayerId = await resolveCanonicalPlayerId(requestedPlayerId);
      const transitionalAliasIds = resolvedPlayerId
        ? findWaiverPlayerAliasIds(activePlayers, resolvedPlayerId)
        : [];
      const canonicalPlayerId = resolvedPlayerId;
      if (!canonicalPlayerId || transitionalAliasIds.length === 0) {
        return NextResponse.json({ error: 'Player not found' }, { status: 404 });
      }
      const playerAliasIds = [
        ...new Set([requestedPlayerId, canonicalPlayerId, ...transitionalAliasIds]),
      ];

      // Prisma owns roster ownership; the Firestore ownership projection is never consulted here.
      const prismaOwnership = await prisma.leagueRosterPlayer.findFirst({
        where: { leagueId, playerId: { in: playerAliasIds } },
        select: { playerId: true, memberId: true },
      });
      if (prismaOwnership) {
        return NextResponse.json({ error: 'Player already owned' }, { status: 409 });
      }

      const ws = await withTiming('waivers.settings.get', () =>
        new PrismaWaiverClaimStore().loadWaiverSettings(leagueId)
      );

      const isFAAB = ws?.system === 'FAAB';
      let validatedBid: number | undefined = undefined;

      if (isFAAB) {
        const minBid = ws?.minimumBid ?? 1;
        if (!Number.isInteger(bidAmount) || bidAmount < minBid) {
          return NextResponse.json({ error: 'Invalid bid amount' }, { status: 400 });
        }
        validatedBid = bidAmount;
      }

      const storedDropPlayerId = dropPlayerId
        ? ((await resolveCanonicalPlayerId(String(dropPlayerId))) ?? String(dropPlayerId))
        : undefined;
      const submittedClaim = await new PrismaWaiverClaimStore().submitClaim({
        leagueId,
        userId,
        teamId: String(teamId),
        playerId: canonicalPlayerId,
        priority: Number(priority) || 1,
        waiverSettings: ws,
        ...(storedDropPlayerId ? { dropPlayerId: storedDropPlayerId } : {}),
        ...(typeof validatedBid === 'number' ? { bidAmount: validatedBid } : {}),
      });
      const claimId = submittedClaim.id;

      logger.info('waiver submitted', {
        leagueId,
        userId,
        teamId,
        playerId: canonicalPlayerId,
        claimId,
      });
      // Echo the stored claim so the client confirms what persisted, not what it sent.
      return NextResponse.json(
        {
          id: claimId,
          playerId: canonicalPlayerId,
          ...(storedDropPlayerId ? { dropPlayerId: storedDropPlayerId } : {}),
          ...(typeof validatedBid === 'number' ? { bidAmount: validatedBid } : {}),
          processingAt: submittedClaim.processingAt.toISOString(),
        },
        { status: 201 }
      );
    } catch (err) {
      const refusal = claimRefusal(err);
      if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
      logger.apiError('POST', '/api/leagues/[id]/waivers/submit', err);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  'POST /api/leagues/[id]/waivers/submit'
);

/** The claim store's expected refusals, as the answer the client shows; null for anything else. */
function claimRefusal(err: unknown): { error: string; status: number } | null {
  if (!(err instanceof Error)) return null;
  const code = err instanceof WaiverClaimStoreError ? err.code : err.message;
  if (code === 'PLAYER_OWNED') return { error: 'Player already owned', status: 409 };
  if (code === 'INSUFFICIENT_FAAB') return { error: 'Insufficient FAAB remaining', status: 400 };
  if (code === 'TEAM_NOT_FOUND' && err instanceof WaiverClaimStoreError) {
    return { error: 'Team not found', status: 403 };
  }
  if (code === 'FAAB_BALANCE_UNAVAILABLE' && err instanceof WaiverClaimStoreError) {
    return { error: 'FAAB balance unavailable', status: 400 };
  }
  if (!(err instanceof WaiverClaimStoreError)) return null;
  switch (code) {
    case 'DROP_NOT_ON_ROSTER':
      return { error: 'The player you chose to drop is not on your roster', status: 409 };
    case 'ROSTER_FULL':
      return { error: 'Your roster is full: choose a player to drop', status: 409 };
    case 'DUPLICATE_CLAIM':
      return { error: 'You already have a pending claim for this player', status: 409 };
    case 'INVALID_BID':
      return { error: 'Bid must be a whole number', status: 400 };
  }
  return null;
}
