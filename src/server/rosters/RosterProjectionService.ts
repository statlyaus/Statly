import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { requireActiveSeasonId } from '@/server/leagues/activeSeason';
import { WaiverAvailabilityProjectionService } from '@/server/waivers/WaiverAvailabilityProjectionService';
import { loadPinnedPriorityMemberId, withPinnedFirst } from '@/server/waivers/pinnedWaiverPriority';

type PrismaLike = Pick<typeof prisma, '$transaction'>;
type ProjectionClient = Pick<
  Prisma.TransactionClient,
  'league' | 'pick' | 'leagueRosterPlayer' | 'waiverPriority'
>;
type WaiverAvailabilityProjectionLike = Pick<WaiverAvailabilityProjectionService, 'projectLeague'>;

export interface RosterProjectionResult {
  projected: number;
}

export class RosterPreferenceError extends Error {
  constructor(
    public readonly code: 'INVALID_SELECTION' | 'ROSTER_CHANGED',
    message: string,
    public readonly status: 400 | 409
  ) {
    super(message);
    this.name = 'RosterPreferenceError';
  }
}

export class RosterProjectionService {
  constructor(
    private readonly db: PrismaLike = prisma,
    private readonly waiverAvailabilityProjectionService: WaiverAvailabilityProjectionLike = new WaiverAvailabilityProjectionService()
  ) {}

  /**
   * Writes the drafted rosters and seeds waiver priority on the caller's transaction. The draft
   * service runs it inside the final pick's transaction, so the pick, the COMPLETED draft and the
   * rosters commit together or not at all.
   */
  async projectDraftInTx(
    tx: ProjectionClient,
    input: { leagueId: string; draftId: string }
  ): Promise<RosterProjectionResult> {
    const picks = await tx.pick.findMany({
      where: { draftId: input.draftId },
      orderBy: { overall: 'asc' },
      select: { id: true, draftId: true, playerId: true, memberId: true, overall: true },
    });

    // A fresh league owns none of these players yet: create them in one statement and update only
    // rows a previous draft of the same league left behind.
    const existing = await tx.leagueRosterPlayer.findMany({
      where: { leagueId: input.leagueId, playerId: { in: picks.map((pick) => pick.playerId) } },
      select: { playerId: true },
    });
    const existingPlayerIds = new Set(existing.map(({ playerId }) => playerId));
    await tx.leagueRosterPlayer.createMany({
      data: picks
        .filter((pick) => !existingPlayerIds.has(pick.playerId))
        .map((pick) => ({
          leagueId: input.leagueId,
          memberId: pick.memberId,
          draftId: pick.draftId,
          pickId: pick.id,
          playerId: pick.playerId,
          acquiredBy: 'DRAFT',
        })),
    });
    for (const pick of picks.filter((candidate) => existingPlayerIds.has(candidate.playerId))) {
      await tx.leagueRosterPlayer.update({
        where: { leagueId_playerId: { leagueId: input.leagueId, playerId: pick.playerId } },
        data: {
          memberId: pick.memberId,
          draftId: pick.draftId,
          pickId: pick.id,
          acquiredBy: 'DRAFT',
        },
      });
    }

    const finalPickByMemberId = new Map<string, number>();
    for (const pick of picks) {
      finalPickByMemberId.set(pick.memberId, pick.overall);
    }

    // Reverse final pick order. A Bloodsucker, who has no picks, is pinned at 1 ahead of it (BR-16).
    const waiverPriorityEntries = withPinnedFirst(
      [...finalPickByMemberId.entries()]
        .sort(([, left], [, right]) => right - left)
        .map(([memberId]) => memberId),
      await loadPinnedPriorityMemberId(tx, input.leagueId)
    ).map((memberId) => ({ memberId }));

    const seasonId =
      waiverPriorityEntries.length > 0 ? await requireActiveSeasonId(tx, input.leagueId) : '';
    for (const [index, entry] of waiverPriorityEntries.entries()) {
      await tx.waiverPriority.upsert({
        where: {
          leagueId_seasonId_memberId: {
            leagueId: input.leagueId,
            seasonId,
            memberId: entry.memberId,
          },
        },
        update: {
          priority: index + 1,
        },
        create: {
          leagueId: input.leagueId,
          seasonId,
          memberId: entry.memberId,
          priority: index + 1,
        },
      });
    }

    return { projected: picks.length };
  }

  /**
   * Refreshes the Firestore waiver availability projection after the draft has committed. Firestore
   * is a projection, never canonical, so a failure is logged and the committed draft stands.
   */
  async refreshWaiverAvailability(input: { leagueId: string; draftId: string }): Promise<void> {
    try {
      await this.waiverAvailabilityProjectionService.projectLeague({ leagueId: input.leagueId });
    } catch (error) {
      logger.warn('Waiver availability projection failed after roster projection', {
        leagueId: input.leagueId,
        draftId: input.draftId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async updateMemberPreferences(input: {
    leagueId: string;
    memberId: string;
    submittedPlayerIds: string[];
    benchOrder?: string[] | null;
  }) {
    return this.db.$transaction(async (tx) => {
      if (new Set(input.submittedPlayerIds).size !== input.submittedPlayerIds.length) {
        throw new RosterPreferenceError(
          'INVALID_SELECTION',
          'Roster players must not be duplicated.',
          400
        );
      }

      const ownership = await tx.leagueRosterPlayer.findMany({
        where: { leagueId: input.leagueId, memberId: input.memberId },
        select: { playerId: true },
        orderBy: [{ acquiredAt: 'asc' }, { createdAt: 'asc' }],
      });
      const playerIds = ownership.map(({ playerId }) => playerId);
      const authoritativeIds = new Set(playerIds);
      const submittedIds = new Set(input.submittedPlayerIds);
      const rosterChanged =
        authoritativeIds.size !== submittedIds.size ||
        playerIds.some((playerId) => !submittedIds.has(playerId));

      if (rosterChanged) {
        throw new RosterPreferenceError(
          'ROSTER_CHANGED',
          'The roster changed. Refresh before saving team preferences.',
          409
        );
      }

      const benchOrder = input.benchOrder ?? [];
      if (
        new Set(benchOrder).size !== benchOrder.length ||
        benchOrder.some((playerId) => !authoritativeIds.has(playerId))
      ) {
        throw new RosterPreferenceError(
          'INVALID_SELECTION',
          'Bench order must contain unique players from the current roster.',
          400
        );
      }

      // Clear all bench positions for this member, then set positions for those in benchOrder
      await tx.leagueRosterPlayer.updateMany({
        where: { leagueId: input.leagueId, memberId: input.memberId },
        data: { benchPosition: null },
      });

      for (const [index, playerId] of benchOrder.entries()) {
        await tx.leagueRosterPlayer.update({
          where: {
            leagueId_memberId_playerId: {
              leagueId: input.leagueId,
              memberId: input.memberId,
              playerId,
            },
          },
          data: { benchPosition: index },
        });
      }

      // Return a shape compatible with existing callers
      const updatedPlayer = await tx.leagueRosterPlayer.findFirst({
        where: { leagueId: input.leagueId, memberId: input.memberId },
        select: { id: true, leagueId: true, memberId: true, updatedAt: true },
      });

      return {
        id: updatedPlayer?.id ?? `${input.leagueId}:${input.memberId}`,
        leagueId: input.leagueId,
        memberId: input.memberId,
        benchOrder: benchOrder.length > 0 ? JSON.stringify(benchOrder) : null,
        updatedAt: updatedPlayer?.updatedAt ?? new Date(),
      };
    });
  }
}
