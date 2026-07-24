import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { logger, withTiming } from '@/lib/logger';
import { revalidateTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { withMetrics } from '@/lib/metrics';
import { getLeagueMembershipAccess } from '@/server/leagues/membership';
import {
  PrismaWaiverClaimStore,
  WaiverClaimStoreError,
  type WaiverSettings as ProcessingWaiverSettings,
} from '@/server/waivers/WaiverProcessingService';
import { findWaiverPlayerAliasIds } from '@/server/waivers/waiverPlayerIdentity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface WaiverSettings {
  system?: 'FAAB' | 'PRIORITY';
  minimumBid?: number;
}

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

      const requestedPlayerId = String(playerId);
      const activePlayers = await prisma.player.findMany({
        where: { active: true },
        select: { id: true, name: true, club: true, position: true },
      });
      const playerAliasIds = findWaiverPlayerAliasIds(activePlayers, requestedPlayerId);
      if (playerAliasIds.length === 0) {
        return NextResponse.json({ error: 'Player not found' }, { status: 404 });
      }

      const prismaOwnership = await prisma.leagueRosterPlayer.findFirst({
        where: { leagueId, playerId: { in: playerAliasIds } },
        select: { playerId: true, memberId: true },
      });
      if (prismaOwnership) {
        return NextResponse.json({ error: 'Player already owned' }, { status: 409 });
      }

      // Ownership checks (doc read + roster scan) concurrently to reduce latency
      const ownershipRefs = playerAliasIds.map((aliasId) =>
        adminDb.doc(`leagues/${leagueId}/playerOwnerships/${aliasId}`)
      );
      const [ownershipDocs, rosterScans] = await Promise.all([
        Promise.all(
          ownershipRefs.map((ref) => withTiming('waivers.ownership.get', () => ref.get()))
        ),
        Promise.all(
          playerAliasIds.map((aliasId) =>
            withTiming('waivers.roster.scan', () =>
              adminDb
                .collection(`leagues/${leagueId}/rosters`)
                .where('playerIds', 'array-contains', aliasId)
                .limit(1)
                .get()
            )
          )
        ),
      ]);
      if (
        ownershipDocs.some((document) => document.exists) ||
        rosterScans.some((scan) => !scan.empty)
      ) {
        return NextResponse.json({ error: 'Player already owned' }, { status: 409 });
      }

      // Read waiver settings
      const settingsSnap = await withTiming('waivers.settings.get', () =>
        adminDb.doc(`leagues/${leagueId}/config/settings`).get()
      );
      interface SettingsDoc {
        waiverSettings?: WaiverSettings;
      }
      const rawSettings: unknown = settingsSnap.data();
      const waiverSettings: SettingsDoc | undefined =
        rawSettings && typeof rawSettings === 'object' ? (rawSettings as SettingsDoc) : undefined;
      const ws: WaiverSettings | undefined = waiverSettings?.waiverSettings;

      const isFAAB = ws?.system === 'FAAB';
      let validatedBid: number | undefined = undefined;

      if (isFAAB) {
        const minBid = ws?.minimumBid ?? 1;
        if (typeof bidAmount !== 'number' || bidAmount < minBid) {
          return NextResponse.json({ error: 'Invalid bid amount' }, { status: 400 });
        }
        validatedBid = bidAmount;
      }

      const freshOwnershipDocs = await Promise.all(
        ownershipRefs.map((ref) => withTiming('waivers.ownership.recheck', () => ref.get()))
      );
      if (freshOwnershipDocs.some((document) => document.exists)) {
        return NextResponse.json({ error: 'Player already owned' }, { status: 409 });
      }

      const submittedClaim = await new PrismaWaiverClaimStore().submitClaim({
        leagueId,
        userId,
        teamId: String(teamId),
        playerId: requestedPlayerId,
        priority: Number(priority) || 1,
        waiverSettings: (ws ?? {}) as ProcessingWaiverSettings,
        ...(dropPlayerId ? { dropPlayerId: String(dropPlayerId) } : {}),
        ...(typeof validatedBid === 'number' ? { bidAmount: validatedBid } : {}),
      });
      const claimId = submittedClaim.id;

      logger.info('waiver submitted', {
        leagueId,
        userId,
        teamId,
        playerId: requestedPlayerId,
        claimId,
      });
      try {
        const results = await Promise.allSettled([
          revalidateTag(tags.waivers(leagueId)),
          revalidateTag(tags.league(leagueId)),
        ]);
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed) {
          logger.warn('Failed to revalidate tags after waiver submit', { leagueId, failed });
        }
      } catch (e) {
        logger.warn('Revalidation error after waiver submit', { leagueId, error: e });
      }
      return NextResponse.json({ id: claimId }, { status: 201 });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'PLAYER_OWNED') {
          return NextResponse.json({ error: 'Player already owned' }, { status: 409 });
        }
        if (
          err.message === 'INSUFFICIENT_FAAB' ||
          (err instanceof WaiverClaimStoreError && err.code === 'INSUFFICIENT_FAAB')
        ) {
          return NextResponse.json({ error: 'Insufficient FAAB remaining' }, { status: 400 });
        }
        if (err instanceof WaiverClaimStoreError && err.code === 'TEAM_NOT_FOUND') {
          return NextResponse.json({ error: 'Team not found' }, { status: 403 });
        }
        if (err instanceof WaiverClaimStoreError && err.code === 'FAAB_BALANCE_UNAVAILABLE') {
          return NextResponse.json({ error: 'FAAB balance unavailable' }, { status: 400 });
        }
      }
      logger.apiError('POST', '/api/leagues/[id]/waivers/submit', err);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  'POST /api/leagues/[id]/waivers/submit'
);
