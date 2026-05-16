import { prisma } from '@/lib/prisma';
import { getLeagueOwnershipDetails } from '@/lib/leagueOwnership';
import type { Player } from '@/types/players';
import {
  ensurePlayerSeasonSummariesMaterialized,
  parseStatsJson,
  resolveLatestProjectedSeason,
} from '@/server/readModels/playerReadModels';

type PrismaClient = typeof prisma;

type PlayerWhere = {
  season?: number;
  club?: string;
  position?: string;
  OR?: Array<{
    playerName?: { contains: string; mode: 'insensitive' };
    club?: { contains: string; mode: 'insensitive' };
    position?: { contains: string; mode: 'insensitive' };
  }>;
};

export type PlayerPoolRow = Player & {
  stats: Record<string, number>;
  statsTotal?: Record<string, number>;
  gamesPlayed: number;
  averageScore: number;
  totalValue: number;
  ownershipStatus?: 'Owned' | 'Waiver' | 'Available';
  ownerTeam?: string;
};

export interface PlayerPoolQuery {
  search?: string;
  team?: string;
  position?: string;
  requestedSeason?: number;
  page?: number;
  limit?: number;
  leagueId?: string;
  prismaClient?: PrismaClient;
  fallbackSeason: number;
}

export interface PlayerPoolResult {
  players: PlayerPoolRow[];
  season: number;
  total: number;
  page: number;
  limit: number;
}

function buildPlayerWhere({ search, team, position }: PlayerPoolQuery): PlayerWhere {
  const where: PlayerWhere = {};
  if (team) where.club = team;
  if (position) where.position = position;
  if (search) {
    where.OR = [
      { playerName: { contains: search, mode: 'insensitive' } },
      { club: { contains: search, mode: 'insensitive' } },
      { position: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
}

export async function listPlayerPool(input: PlayerPoolQuery): Promise<PlayerPoolResult> {
  const prismaClient = input.prismaClient ?? prisma;
  const page = input.page ?? 1;
  const limit = input.limit ?? 20;
  const start = (page - 1) * limit;
  const season =
    input.requestedSeason ??
    (await resolveLatestProjectedSeason(prismaClient, input.fallbackSeason));

  await ensurePlayerSeasonSummariesMaterialized(prismaClient, season);

  const where = {
    ...buildPlayerWhere(input),
    season,
  };
  const [total, summaries] = await Promise.all([
    prismaClient.playerSeasonSummary.count({ where }),
    prismaClient.playerSeasonSummary.findMany({
      where,
      orderBy: { playerName: 'asc' },
      skip: start,
      take: limit,
    }),
  ]);

  const pagedPlayers: PlayerPoolRow[] = summaries.map((summary) => {
    const stats = parseStatsJson(summary.statsJson);
    return {
      id: summary.playerId,
      name: summary.playerName,
      team: summary.club,
      position: summary.position,
      ...stats,
      stats,
      statsTotal: parseStatsJson(summary.totalsJson),
      gamesPlayed: summary.gamesPlayed,
      averageScore: summary.averageScore,
      totalValue: summary.totalValue,
    };
  });

  if (!input.leagueId) {
    return {
      players: pagedPlayers,
      season,
      total,
      page,
      limit,
    };
  }

  const ids = pagedPlayers.map((player) => player.id);
  const { totalTeams, counts, owners } = await getLeagueOwnershipDetails(input.leagueId, ids);
  const pendingWaiverClaims = await prismaClient.waiverClaim.findMany({
    where: {
      leagueId: input.leagueId,
      status: 'PENDING',
    },
    select: {
      playerId: true,
    },
  });
  const waiverSet = new Set(pendingWaiverClaims.map((claim) => String(claim.playerId)));

  return {
    players: pagedPlayers.map((player) => {
      const count = counts.get(player.id) ?? 0;
      const ownership = totalTeams > 0 ? Math.round((count / totalTeams) * 100) : 0;
      const ownerTeams = owners.get(player.id) ?? [];
      const ownerTeam = ownerTeams.length ? ownerTeams.join(', ') : undefined;
      const ownershipStatus = waiverSet.has(String(player.id))
        ? 'Waiver'
        : count > 0
          ? 'Owned'
          : 'Available';

      return {
        ...player,
        ownership,
        ownershipStatus,
        ownerTeam,
      };
    }),
    season,
    total,
    page,
    limit,
  };
}
