import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { WaiverAvailabilityProjectionService } from '@/server/waivers/WaiverAvailabilityProjectionService';

type PrismaLike = Pick<
  typeof prisma,
  '$transaction' | 'pick' | 'leagueRoster' | 'leagueRosterPlayer' | 'waiverPriority'
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

  async projectDraft(input: {
    leagueId: string;
    draftId: string;
  }): Promise<RosterProjectionResult> {
    const picks = await this.db.pick.findMany({
      where: { draftId: input.draftId },
      orderBy: { overall: 'asc' },
      select: { id: true, draftId: true, playerId: true, memberId: true, overall: true },
    });

    const rosterShells = new Set<string>();

    for (const pick of picks) {
      if (!rosterShells.has(pick.memberId)) {
        await this.db.leagueRoster.upsert({
          where: {
            leagueId_memberId: {
              leagueId: input.leagueId,
              memberId: pick.memberId,
            },
          },
          update: {},
          create: {
            leagueId: input.leagueId,
            memberId: pick.memberId,
            playerIds: '[]',
          },
        });
        rosterShells.add(pick.memberId);
      }

      await this.db.leagueRosterPlayer.upsert({
        where: {
          leagueId_playerId: {
            leagueId: input.leagueId,
            playerId: pick.playerId,
          },
        },
        update: {
          memberId: pick.memberId,
          draftId: pick.draftId,
          pickId: pick.id,
          acquiredBy: 'DRAFT',
        },
        create: {
          leagueId: input.leagueId,
          memberId: pick.memberId,
          draftId: pick.draftId,
          pickId: pick.id,
          playerId: pick.playerId,
          acquiredBy: 'DRAFT',
        },
      });
    }

    const finalPickByMemberId = new Map<string, number>();
    for (const pick of picks) {
      finalPickByMemberId.set(pick.memberId, pick.overall);
    }

    const waiverPriorityEntries = [...finalPickByMemberId.entries()]
      .map(([memberId, finalPick]) => ({ memberId, finalPick }))
      .sort((a, b) => b.finalPick - a.finalPick);

    for (const [index, entry] of waiverPriorityEntries.entries()) {
      await this.db.waiverPriority.upsert({
        where: {
          leagueId_memberId: {
            leagueId: input.leagueId,
            memberId: entry.memberId,
          },
        },
        update: {
          priority: index + 1,
        },
        create: {
          leagueId: input.leagueId,
          memberId: entry.memberId,
          priority: index + 1,
        },
      });
    }

    try {
      await this.waiverAvailabilityProjectionService.projectLeague({ leagueId: input.leagueId });
    } catch (error) {
      logger.warn('Waiver availability projection failed after roster projection', {
        leagueId: input.leagueId,
        draftId: input.draftId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { projected: picks.length };
  }

  async updateMemberPreferences(input: {
    leagueId: string;
    memberId: string;
    submittedPlayerIds: string[];
    captainId?: string | null;
    viceCaptainId?: string | null;
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

      if (input.captainId && !authoritativeIds.has(input.captainId)) {
        throw new RosterPreferenceError('INVALID_SELECTION', 'Captain must be on the roster.', 400);
      }
      if (input.viceCaptainId && !authoritativeIds.has(input.viceCaptainId)) {
        throw new RosterPreferenceError(
          'INVALID_SELECTION',
          'Vice-captain must be on the roster.',
          400
        );
      }
      if (input.captainId && input.captainId === input.viceCaptainId) {
        throw new RosterPreferenceError(
          'INVALID_SELECTION',
          'Captain and vice-captain cannot be the same player.',
          400
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

      return tx.leagueRoster.upsert({
        where: {
          leagueId_memberId: { leagueId: input.leagueId, memberId: input.memberId },
        },
        create: {
          leagueId: input.leagueId,
          memberId: input.memberId,
          playerIds: JSON.stringify(playerIds),
          captainId: input.captainId ?? null,
          viceCaptainId: input.viceCaptainId ?? null,
          benchOrder: input.benchOrder ? JSON.stringify(input.benchOrder) : null,
        },
        update: {
          playerIds: JSON.stringify(playerIds),
          captainId: input.captainId ?? null,
          viceCaptainId: input.viceCaptainId ?? null,
          benchOrder: input.benchOrder ? JSON.stringify(input.benchOrder) : null,
        },
        select: {
          id: true,
          leagueId: true,
          memberId: true,
          captainId: true,
          viceCaptainId: true,
          benchOrder: true,
          updatedAt: true,
        },
      });
    });
  }
}
