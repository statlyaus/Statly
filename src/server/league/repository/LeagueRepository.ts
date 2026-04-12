import { DraftStatus, LeagueRole, Prisma as PrismaNS } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { prismaUserPublicSelect } from '@/lib/prismaUserPublicSelect';
import {
  nestedUserCredentialCreate,
  USER_CREDENTIAL_FIREBASE_MANAGED,
} from '@/lib/userCredentialConstants';

type TxClient = PrismaNS.TransactionClient;

export class LeagueRepository {
  async transaction<T>(work: (tx: TxClient) => Promise<T>, timeout = 20000): Promise<T> {
    return prisma.$transaction((tx) => work(tx), { timeout });
  }

  async findUser(tx: TxClient, userId: string) {
    return tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        timeZone: true,
      },
    });
  }

  async createUser(
    tx: TxClient,
    input: {
      id: string;
      email: string;
      displayName: string;
      timeZone?: string;
    }
  ) {
    return tx.user.create({
      data: {
        id: input.id,
        email: input.email,
        displayName: input.displayName,
        timeZone: input.timeZone ?? 'UTC',
        credential: nestedUserCredentialCreate(USER_CREDENTIAL_FIREBASE_MANAGED),
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        timeZone: true,
      },
    });
  }

  async createLeague(
    tx: TxClient,
    input: {
      name: string;
      inviteCode: string;
      type: string;
      ownerId: string;
      description?: string;
      status: string;
      categoriesJson: string;
      draftDate?: Date;
      tradeLimit: number;
      tradeReview: string;
      tradeVetoPeriodHours?: number;
      tradeDeadline?: Date;
      waiverOrderJson: string;
      waiverPeriodHours: number;
      waiverResetPolicy: string;
      settings: {
        rosterSize: number;
        benchSize: number;
        maxTeams: number;
        pickSeconds: number;
        allowAutoPick: boolean;
        enableDraftReminders: boolean;
        draftType: 'SNAKE' | 'LINEAR';
        startAt: Date;
        timeZone: string;
        locked: boolean;
        seasonWeeks: number;
        matchupsPerOpponent: number;
        playoffsEnabled: boolean;
        playoffTeams: number;
        playoffLegLengthWeeks: number;
        playoffReseedEachRound: boolean;
        playoffIncludeConsolation: boolean;
        enableCaptainSystem: boolean;
        captainMultiplier: number;
        viceCaptainMultiplier: number;
      };
      ownerMember: {
        userId: string;
        teamName: string;
      };
    }
  ) {
    const settings = await tx.leagueSettings.create({
      data: input.settings,
    });

    return tx.league.create({
      data: {
        name: input.name,
        inviteCode: input.inviteCode,
        type: input.type,
        ownerId: input.ownerId,
        description: input.description,
        status: input.status,
        categoriesJson: input.categoriesJson,
        draftDate: input.draftDate,
        tradeLimit: input.tradeLimit,
        tradeReview: input.tradeReview,
        tradeVetoPeriodHours: input.tradeVetoPeriodHours ?? 24,
        tradeDeadline: input.tradeDeadline,
        waiverOrderJson: input.waiverOrderJson,
        waiverPeriodHours: input.waiverPeriodHours,
        waiverResetPolicy: input.waiverResetPolicy,
        settingsId: settings.id,
        members: {
          create: {
            userId: input.ownerMember.userId,
            role: LeagueRole.OWNER,
            teamName: input.ownerMember.teamName,
          },
        },
      },
      include: {
        settings: true,
        members: {
          include: {
            user: { select: prismaUserPublicSelect },
          },
          orderBy: { joinedAt: 'asc' },
        },
        drafts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async findLeagueById(tx: TxClient, leagueId: string) {
    return tx.league.findUnique({
      where: { id: leagueId },
      include: {
        settings: true,
        members: {
          include: {
            user: { select: prismaUserPublicSelect },
          },
          orderBy: { joinedAt: 'asc' },
        },
        drafts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async findLeagueByInviteCode(tx: TxClient, inviteCode: string) {
    return tx.league.findUnique({
      where: { inviteCode },
      include: {
        settings: true,
        members: {
          include: {
            user: { select: prismaUserPublicSelect },
          },
          orderBy: { joinedAt: 'asc' },
        },
        drafts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async findLeagueMember(tx: TxClient, leagueId: string, userId: string) {
    return tx.leagueMember.findFirst({
      where: { leagueId, userId },
      include: {
        league: {
          include: {
            settings: true,
          },
        },
      },
    });
  }

  async createLeagueMember(
    tx: TxClient,
    input: {
      leagueId: string;
      userId: string;
      teamName: string;
      draftSlot?: number | null;
    }
  ) {
    return tx.leagueMember.create({
      data: {
        leagueId: input.leagueId,
        userId: input.userId,
        role: LeagueRole.MANAGER,
        teamName: input.teamName,
        draftSlot: input.draftSlot,
      },
    });
  }

  async updateLeagueMember(
    tx: TxClient,
    input: {
      leagueId: string;
      userId: string;
      teamName?: string;
      role?: LeagueRole;
      draftSlot?: number | null;
    }
  ) {
    const member = await tx.leagueMember.findFirst({
      where: { leagueId: input.leagueId, userId: input.userId },
      select: { id: true },
    });

    if (!member) {
      return null;
    }

    return tx.leagueMember.update({
      where: { id: member.id },
      data: {
        ...(input.teamName !== undefined ? { teamName: input.teamName } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.draftSlot !== undefined ? { draftSlot: input.draftSlot } : {}),
      },
      include: {
        user: { select: prismaUserPublicSelect },
      },
    });
  }

  async removeLeagueMember(
    tx: TxClient,
    input: {
      leagueId: string;
      userId: string;
    }
  ) {
    const member = await tx.leagueMember.findFirst({
      where: { leagueId: input.leagueId, userId: input.userId },
      select: { id: true },
    });

    if (!member) {
      return null;
    }

    await tx.leagueMember.delete({
      where: { id: member.id },
    });

    return member.id;
  }

  async transferLeagueOwnership(
    tx: TxClient,
    input: {
      leagueId: string;
      currentOwnerId: string;
      nextOwnerId: string;
    }
  ) {
    const [currentOwner, nextOwner] = await Promise.all([
      tx.leagueMember.findFirst({
        where: { leagueId: input.leagueId, userId: input.currentOwnerId },
        select: { id: true },
      }),
      tx.leagueMember.findFirst({
        where: { leagueId: input.leagueId, userId: input.nextOwnerId },
        select: { id: true },
      }),
    ]);

    if (!currentOwner || !nextOwner) {
      return null;
    }

    await tx.league.update({
      where: { id: input.leagueId },
      data: { ownerId: input.nextOwnerId },
    });

    await tx.leagueMember.update({
      where: { id: nextOwner.id },
      data: { role: LeagueRole.OWNER },
    });

    await tx.leagueMember.update({
      where: { id: currentOwner.id },
      data: { role: LeagueRole.MANAGER },
    });

    return {
      currentOwnerId: input.currentOwnerId,
      nextOwnerId: input.nextOwnerId,
    };
  }

  async findLeagueDraftSummary(tx: TxClient, leagueId: string) {
    return tx.draft.findUnique({
      where: { leagueId },
      include: {
        league: {
          include: {
            settings: true,
          },
        },
      },
    });
  }

  async updateLeagueAndSettings(
    tx: TxClient,
    input: {
      leagueId: string;
      league: {
        name?: string;
        type?: string;
        description?: string | null;
        draftDate?: Date | null;
        categoriesJson?: string;
        tradeLimit?: number;
        tradeReview?: string;
        tradeVetoPeriodHours?: number;
        tradeDeadline?: Date | null;
        waiverPeriodHours?: number;
        waiverResetPolicy?: string;
        waiverSystem?: string;
        waiverPriorityMode?: string;
        waiverFaabBudget?: number | null;
        waiverMinimumBid?: number;
        waiverMaxWeekAcquisitions?: number | null;
        waiverMaxSeasonAcquisitions?: number | null;
        waiverMoveWinnerToBack?: boolean;
        waiverAcquisitionLocked?: boolean;
        cantDropListJson?: string | null;
      };
      settings: {
        startAt?: Date;
        draftType?: 'SNAKE' | 'LINEAR';
        pickSeconds?: number;
        timeZone?: string;
        maxTeams?: number;
        allowAutoPick?: boolean;
        enableDraftReminders?: boolean;
        rosterSize?: number;
        benchSize?: number;
        seasonWeeks?: number;
        matchupsPerOpponent?: number;
        playoffsEnabled?: boolean;
        playoffTeams?: number;
        playoffLegLengthWeeks?: number;
        playoffReseedEachRound?: boolean;
        playoffIncludeConsolation?: boolean;
        enableCaptainSystem?: boolean;
        captainMultiplier?: number;
        viceCaptainMultiplier?: number;
      };
    }
  ) {
    const league = await tx.league.findUnique({
      where: { id: input.leagueId },
      select: {
        settingsId: true,
      },
    });

    if (!league) {
      return null;
    }

    const updatedLeague = await tx.league.update({
      where: { id: input.leagueId },
      data: input.league,
      include: {
        settings: true,
      },
    });

    const updatedSettings = await tx.leagueSettings.update({
      where: { id: league.settingsId },
      data: input.settings as Parameters<typeof tx.leagueSettings.update>[0]['data'],
    });

    return {
      league: updatedLeague,
      settings: updatedSettings,
    };
  }

  async listLeagues(tx: TxClient, type?: string) {
    return tx.league.findMany({
      where: type ? { type } : undefined,
      include: {
        settings: true,
        members: {
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async listLeaguesForUser(tx: TxClient, userId: string) {
    return tx.leagueMember.findMany({
      where: { userId },
      include: {
        league: {
          include: {
            settings: true,
            drafts: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            members: {
              select: { id: true },
            },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });
  }

  async findRosterContextByLeagueAndUser(
    tx: TxClient,
    input: { leagueId: string; userId: string }
  ) {
    const [member, league] = await Promise.all([
      tx.leagueMember.findFirst({
        where: { leagueId: input.leagueId, userId: input.userId },
        include: {
          rosters: {
            take: 1,
            orderBy: { updatedAt: 'desc' },
          },
        },
      }),
      tx.league.findUnique({
        where: { id: input.leagueId },
        include: {
          settings: true,
        },
      }),
    ]);

    if (!member || !league) {
      return null;
    }

    const rosterPlayers = await tx.leagueRosterPlayer.findMany({
      where: {
        leagueId: input.leagueId,
        memberId: member.id,
      },
      select: {
        playerId: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      member,
      league,
      rosterPlayers,
    };
  }

  async countLeagueMembers(leagueId: string) {
    return prisma.leagueMember.count({
      where: { leagueId },
    });
  }

  async findLeagueRosterOwnershipRows(input: { leagueId: string; playerIds?: string[] }) {
    return prisma.leagueRosterPlayer.findMany({
      where: {
        leagueId: input.leagueId,
        ...(input.playerIds && input.playerIds.length > 0
          ? { playerId: { in: input.playerIds } }
          : {}),
      },
      select: {
        playerId: true,
        memberId: true,
        member: {
          select: {
            teamName: true,
          },
        },
      },
    });
  }

  async listLeaguePlayers(input: {
    ids?: string[];
    team?: string;
    position?: string;
    cursor?: string;
    take: number;
  }) {
    return prisma.player.findMany({
      where: {
        ...(input.ids && input.ids.length > 0 ? { id: { in: input.ids } } : {}),
        ...(input.team ? { club: input.team } : {}),
        ...(input.position ? { position: input.position } : {}),
        ...(input.cursor ? { id: { gt: input.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: input.take,
      select: {
        id: true,
        name: true,
        club: true,
        position: true,
      },
    });
  }

  async countLeaguePlayers(input: { team?: string; position?: string }) {
    return prisma.player.count({
      where: {
        ...(input.team ? { club: input.team } : {}),
        ...(input.position ? { position: input.position } : {}),
      },
    });
  }

  async findLeagueMemberByReference(
    tx: TxClient,
    input: { leagueId: string; memberIdOrUserId: string }
  ) {
    return tx.leagueMember.findFirst({
      where: {
        leagueId: input.leagueId,
        OR: [{ id: input.memberIdOrUserId }, { userId: input.memberIdOrUserId }],
      },
      include: {
        league: {
          include: {
            settings: true,
          },
        },
        rosterPlayers: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        rosters: {
          take: 1,
          orderBy: { updatedAt: 'desc' },
        },
      },
    });
  }

  async getLeagueWaiverConfig(tx: TxClient, leagueId: string) {
    return tx.league.findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        waiverSystem: true,
        waiverPriorityMode: true,
        waiverFaabBudget: true,
        waiverMinimumBid: true,
        waiverPeriodHours: true,
        waiverMaxWeekAcquisitions: true,
        waiverMaxSeasonAcquisitions: true,
        waiverMoveWinnerToBack: true,
        waiverAcquisitionLocked: true,
        cantDropListJson: true,
      },
    });
  }

  async listWaiverClaims(tx: TxClient, leagueId: string) {
    return tx.waiverClaim.findMany({
      where: { leagueId },
      include: {
        member: {
          select: {
            id: true,
            userId: true,
            teamName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async listWaiverPriorities(tx: TxClient, leagueId: string) {
    return tx.waiverPriority.findMany({
      where: { leagueId },
      include: {
        member: {
          select: {
            id: true,
            userId: true,
            teamName: true,
          },
        },
      },
      orderBy: [{ currentPriority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findWaiverClaimById(tx: TxClient, input: { leagueId: string; claimId: string }) {
    return tx.waiverClaim.findFirst({
      where: {
        id: input.claimId,
        leagueId: input.leagueId,
      },
      include: {
        member: {
          select: {
            id: true,
            userId: true,
            teamName: true,
          },
        },
      },
    });
  }

  async createWaiverClaim(
    tx: TxClient,
    input: {
      leagueId: string;
      memberId: string;
      playerId: string;
      dropPlayerId?: string;
      priority: number;
      bidAmount?: number;
    }
  ) {
    return tx.waiverClaim.create({
      data: {
        leagueId: input.leagueId,
        memberId: input.memberId,
        playerId: input.playerId,
        dropPlayerId: input.dropPlayerId,
        priority: input.priority,
        bidAmount: input.bidAmount,
      },
      include: {
        member: {
          select: {
            id: true,
            userId: true,
            teamName: true,
          },
        },
      },
    });
  }

  async updateWaiverClaim(
    tx: TxClient,
    input: {
      claimId: string;
      data: {
        status?: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
        reason?: string | null;
        processingAt?: Date | null;
        processedAt?: Date | null;
        cancelledByUserId?: string | null;
        cancelledAt?: Date | null;
      };
    }
  ) {
    return tx.waiverClaim.update({
      where: { id: input.claimId },
      data: input.data,
    });
  }

  async findWaiverPriorityByMemberId(tx: TxClient, input: { leagueId: string; memberId: string }) {
    return tx.waiverPriority.findFirst({
      where: {
        leagueId: input.leagueId,
        memberId: input.memberId,
      },
    });
  }

  async upsertWaiverPriority(
    tx: TxClient,
    input: {
      leagueId: string;
      memberId: string;
      currentPriority?: number | null;
      remainingFaab?: number | null;
      pendingBidTotal?: number;
      lastClaimDate?: Date | null;
    }
  ) {
    return tx.waiverPriority.upsert({
      where: {
        leagueId_memberId: {
          leagueId: input.leagueId,
          memberId: input.memberId,
        },
      },
      create: {
        leagueId: input.leagueId,
        memberId: input.memberId,
        currentPriority: input.currentPriority ?? null,
        remainingFaab: input.remainingFaab ?? null,
        pendingBidTotal: input.pendingBidTotal ?? 0,
        lastClaimDate: input.lastClaimDate ?? null,
      },
      update: {
        ...(input.currentPriority !== undefined ? { currentPriority: input.currentPriority } : {}),
        ...(input.remainingFaab !== undefined ? { remainingFaab: input.remainingFaab } : {}),
        ...(input.pendingBidTotal !== undefined ? { pendingBidTotal: input.pendingBidTotal } : {}),
        ...(input.lastClaimDate !== undefined ? { lastClaimDate: input.lastClaimDate } : {}),
      },
    });
  }

  async countSuccessfulWaiverClaims(
    tx: TxClient,
    input: { leagueId: string; memberId: string; processedSince?: Date }
  ) {
    return tx.waiverClaim.count({
      where: {
        leagueId: input.leagueId,
        memberId: input.memberId,
        status: 'SUCCESSFUL',
        ...(input.processedSince ? { processedAt: { gte: input.processedSince } } : {}),
      },
    });
  }

  async updateMemberRoster(
    tx: TxClient,
    input: {
      leagueId: string;
      memberId: string;
      playerIds: string[];
    }
  ) {
    await tx.leagueRosterPlayer.deleteMany({
      where: {
        leagueId: input.leagueId,
        memberId: input.memberId,
      },
    });

    if (input.playerIds.length > 0) {
      await tx.leagueRosterPlayer.createMany({
        data: input.playerIds.map((playerId, sortOrder) => ({
          id: `${input.leagueId}:${input.memberId}:${playerId}`,
          leagueId: input.leagueId,
          memberId: input.memberId,
          playerId,
          sortOrder,
        })),
      });
    }

    return tx.leagueRoster.upsert({
      where: {
        leagueId_memberId: {
          leagueId: input.leagueId,
          memberId: input.memberId,
        },
      },
      create: {
        leagueId: input.leagueId,
        memberId: input.memberId,
      },
      update: {},
    });
  }

  mapDraftStatus(status: DraftStatus): 'preseason' | 'active' | 'completed' {
    if (status === DraftStatus.COMPLETED) {
      return 'completed';
    }

    if (status === DraftStatus.SCHEDULED) {
      return 'preseason';
    }

    return 'active';
  }
}

export const leagueRepository = new LeagueRepository();
