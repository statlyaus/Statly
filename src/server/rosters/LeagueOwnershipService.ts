import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

export type OwnershipMutationErrorCode =
  | 'LEAGUE_NOT_FOUND'
  | 'TEAM_NOT_FOUND'
  | 'PLAYER_NOT_FOUND'
  | 'PLAYER_OWNED'
  | 'PLAYER_ON_WAIVERS'
  | 'PLAYER_NOT_OWNED'
  | 'ROSTER_LIMIT_REACHED';

export class OwnershipMutationError extends Error {
  constructor(
    readonly code: OwnershipMutationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'OwnershipMutationError';
  }
}

export interface RosterMutationResult {
  playerIds: string[];
}

type RosterTransaction = Prisma.TransactionClient;

function serializePlayerIds(playerIds: string[]): string {
  return JSON.stringify(playerIds);
}

async function requireMember(
  tx: RosterTransaction,
  leagueId: string,
  memberId: string
): Promise<void> {
  const member = await tx.leagueMember.findUnique({
    where: { id: memberId },
    select: { leagueId: true },
  });

  if (!member || member.leagueId !== leagueId) {
    throw new OwnershipMutationError('TEAM_NOT_FOUND', 'Team not found in this league');
  }
}

async function requireLeagueRosterSize(tx: RosterTransaction, leagueId: string): Promise<number> {
  const league = await tx.league.findUnique({
    where: { id: leagueId },
    select: { settings: { select: { rosterSize: true } } },
  });

  if (!league) {
    throw new OwnershipMutationError('LEAGUE_NOT_FOUND', 'League not found');
  }

  return league.settings.rosterSize;
}

async function syncRosterProjection(
  tx: RosterTransaction,
  leagueId: string,
  memberId: string
): Promise<string[]> {
  const ownerships = await tx.leagueRosterPlayer.findMany({
    where: { leagueId, memberId },
    orderBy: [{ acquiredAt: 'asc' }, { createdAt: 'asc' }],
    select: { playerId: true },
  });
  const playerIds = ownerships.map((ownership) => ownership.playerId);

  await tx.leagueRoster.upsert({
    where: { leagueId_memberId: { leagueId, memberId } },
    create: { leagueId, memberId, playerIds: serializePlayerIds(playerIds) },
    update: { playerIds: serializePlayerIds(playerIds) },
  });

  return playerIds;
}

async function ensureUnownedPlayer(
  tx: RosterTransaction,
  input: { leagueId: string; playerId: string; allowWaiverHold: boolean }
): Promise<void> {
  const [player, ownership, hold] = await Promise.all([
    tx.player.findUnique({ where: { id: input.playerId }, select: { id: true } }),
    tx.leagueRosterPlayer.findUnique({
      where: { leagueId_playerId: { leagueId: input.leagueId, playerId: input.playerId } },
      select: { memberId: true },
    }),
    tx.leagueWaiverHold.findUnique({
      where: { leagueId_playerId: { leagueId: input.leagueId, playerId: input.playerId } },
      select: { availableAt: true },
    }),
  ]);

  if (!player) {
    throw new OwnershipMutationError('PLAYER_NOT_FOUND', 'Player not found');
  }
  if (ownership) {
    throw new OwnershipMutationError('PLAYER_OWNED', 'Player already owned in this league');
  }
  if (hold && hold.availableAt > new Date() && !input.allowWaiverHold) {
    throw new OwnershipMutationError('PLAYER_ON_WAIVERS', 'Player is on waivers');
  }
}

async function ensureCapacity(
  tx: RosterTransaction,
  input: { leagueId: string; memberId: string; incoming: number; outgoing: number }
): Promise<void> {
  const [rosterSize, currentCount] = await Promise.all([
    requireLeagueRosterSize(tx, input.leagueId),
    tx.leagueRosterPlayer.count({ where: { leagueId: input.leagueId, memberId: input.memberId } }),
  ]);

  if (currentCount - input.outgoing + input.incoming > rosterSize) {
    throw new OwnershipMutationError('ROSTER_LIMIT_REACHED', 'Roster limit reached');
  }
}

export class LeagueOwnershipService {
  constructor(private readonly db: Pick<typeof prisma, '$transaction'> = prisma) {}

  async addFreeAgent(input: {
    leagueId: string;
    memberId: string;
    playerId: string;
  }): Promise<RosterMutationResult> {
    try {
      return await this.db.$transaction(async (tx) => {
        await requireMember(tx, input.leagueId, input.memberId);
        await ensureUnownedPlayer(tx, {
          leagueId: input.leagueId,
          playerId: input.playerId,
          allowWaiverHold: false,
        });
        await ensureCapacity(tx, { ...input, incoming: 1, outgoing: 0 });

        await tx.leagueRosterPlayer.create({
          data: {
            leagueId: input.leagueId,
            memberId: input.memberId,
            playerId: input.playerId,
            acquiredBy: 'FREE_AGENT',
          },
        });

        return { playerIds: await syncRosterProjection(tx, input.leagueId, input.memberId) };
      });
    } catch (error) {
      throw normalizeOwnershipError(error);
    }
  }

  async dropToWaivers(input: {
    leagueId: string;
    memberId: string;
    playerId: string;
    availableAt: Date;
  }): Promise<RosterMutationResult> {
    return this.db.$transaction(async (tx) => {
      await requireMember(tx, input.leagueId, input.memberId);
      const ownership = await tx.leagueRosterPlayer.findUnique({
        where: { leagueId_playerId: { leagueId: input.leagueId, playerId: input.playerId } },
        select: { memberId: true },
      });

      if (!ownership || ownership.memberId !== input.memberId) {
        throw new OwnershipMutationError('PLAYER_NOT_OWNED', 'Player is not in this roster');
      }

      await tx.leagueRosterPlayer.delete({
        where: { leagueId_playerId: { leagueId: input.leagueId, playerId: input.playerId } },
      });
      await tx.leagueWaiverHold.upsert({
        where: { leagueId_playerId: { leagueId: input.leagueId, playerId: input.playerId } },
        create: {
          leagueId: input.leagueId,
          playerId: input.playerId,
          releasedByMemberId: input.memberId,
          availableAt: input.availableAt,
        },
        update: {
          releasedByMemberId: input.memberId,
          availableAt: input.availableAt,
        },
      });

      return { playerIds: await syncRosterProjection(tx, input.leagueId, input.memberId) };
    });
  }

  async claimWaiver(input: {
    leagueId: string;
    memberId: string;
    playerId: string;
    dropPlayerId?: string;
    droppedPlayerAvailableAt: Date;
  }): Promise<RosterMutationResult> {
    try {
      return await this.db.$transaction(async (tx) => {
        await requireMember(tx, input.leagueId, input.memberId);
        await ensureUnownedPlayer(tx, {
          leagueId: input.leagueId,
          playerId: input.playerId,
          allowWaiverHold: true,
        });

        if (input.dropPlayerId) {
          const dropOwnership = await tx.leagueRosterPlayer.findUnique({
            where: {
              leagueId_playerId: { leagueId: input.leagueId, playerId: input.dropPlayerId },
            },
            select: { memberId: true },
          });
          if (!dropOwnership || dropOwnership.memberId !== input.memberId) {
            throw new OwnershipMutationError(
              'PLAYER_NOT_OWNED',
              'Drop player is not in this roster'
            );
          }
        }

        await ensureCapacity(tx, {
          leagueId: input.leagueId,
          memberId: input.memberId,
          incoming: 1,
          outgoing: input.dropPlayerId ? 1 : 0,
        });

        if (input.dropPlayerId) {
          await tx.leagueRosterPlayer.delete({
            where: {
              leagueId_playerId: { leagueId: input.leagueId, playerId: input.dropPlayerId },
            },
          });
          await tx.leagueWaiverHold.upsert({
            where: {
              leagueId_playerId: { leagueId: input.leagueId, playerId: input.dropPlayerId },
            },
            create: {
              leagueId: input.leagueId,
              playerId: input.dropPlayerId,
              releasedByMemberId: input.memberId,
              availableAt: input.droppedPlayerAvailableAt,
            },
            update: {
              releasedByMemberId: input.memberId,
              availableAt: input.droppedPlayerAvailableAt,
            },
          });
        }

        await tx.leagueRosterPlayer.create({
          data: {
            leagueId: input.leagueId,
            memberId: input.memberId,
            playerId: input.playerId,
            acquiredBy: 'WAIVER',
          },
        });
        await tx.leagueWaiverHold.deleteMany({
          where: { leagueId: input.leagueId, playerId: input.playerId },
        });

        return { playerIds: await syncRosterProjection(tx, input.leagueId, input.memberId) };
      });
    } catch (error) {
      throw normalizeOwnershipError(error);
    }
  }
}

export async function syncCanonicalRosterProjection(
  tx: RosterTransaction,
  leagueId: string,
  memberId: string
): Promise<string[]> {
  return syncRosterProjection(tx, leagueId, memberId);
}

function normalizeOwnershipError(error: unknown): Error {
  if (error instanceof OwnershipMutationError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new OwnershipMutationError('PLAYER_OWNED', 'Player already owned in this league');
  }
  return error instanceof Error ? error : new Error(String(error));
}
