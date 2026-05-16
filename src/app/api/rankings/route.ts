import { type NextRequest, NextResponse } from 'next/server';

import { commonErrors } from '@/lib/apiResponse';
import { getDefaultAflSeason } from '@/lib/aflSeason';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';
import {
  PLAYER_RANKING_METHOD,
  PLAYER_RANKING_METHOD_VERSION,
} from '@/server/rankings/playerRankingEngine';
import { statsReadService } from '@/server/stats/StatsReadService';

export const runtime = 'nodejs';

const CACHE_SECONDS = 300;

export type RankingCategory =
  | 'goals'
  | 'goal_assists'
  | 'tackles'
  | 'clearances'
  | 'inside_50s'
  | 'rebound_50s'
  | 'hitouts'
  | 'intercepts'
  | 'marks';

export type OwnershipStatus = 'OWNED' | 'AVAILABLE' | 'WAIVER';

type RankingPlayer = {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  games: number;
  ownership: OwnershipStatus;
  overall: number;
  rank: number;
  isSmallSample: boolean;
  categories: Record<
    RankingCategory,
    {
      perGame: number;
      zScore: number;
    }
  >;
};

const CATEGORY_MAP: ReadonlyArray<readonly [RankingCategory, CanonicalStatKey]> = [
  ['goals', 'goals'],
  ['goal_assists', 'goalAssists'],
  ['tackles', 'tackles'],
  ['clearances', 'clearances'],
  ['inside_50s', 'inside50s'],
  ['rebound_50s', 'rebound50s'],
  ['hitouts', 'hitouts'],
  ['intercepts', 'intercepts'],
  ['marks', 'marks'],
];

function parseInteger(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getOwnershipStatus(_playerId: string, _leagueId?: string): Promise<OwnershipStatus> {
  return 'AVAILABLE';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const season = parseInteger(searchParams.get('season'), getDefaultAflSeason());
    const period = (searchParams.get('period') ?? 'season').trim().toLowerCase();
    const position = searchParams.get('position');
    const ownership = searchParams.get('ownership');
    const leagueId = searchParams.get('leagueId') ?? undefined;
    const sortBy = searchParams.get('sortBy') || 'overall';
    const sortDirection = searchParams.get('sortDirection') === 'asc' ? 'asc' : 'desc';
    const limit = Math.max(0, parseInteger(searchParams.get('limit'), 0));
    const search = (searchParams.get('search') ?? '').trim().toLowerCase();

    logger.debug('Rankings API query', {
      season,
      period,
      position,
      ownership,
      sortBy,
      sortDirection,
    });

    if (period !== 'season') {
      return commonErrors.badRequest(
        'Only season rankings are published. Recent-form ranking publication has not been implemented yet.'
      );
    }

    await statsReadService.ensureSeasonReady(season);

    const [snapshots, publication] = await Promise.all([
      statsReadService.listRankings({ season, scope: 'season' }),
      prisma.playerProjectionPublication.findUnique({
        where: { id: `${season}:season` },
        select: {
          rankingMethod: true,
          rankingMethodVersion: true,
          rankingMinimumGames: true,
          rankingPopulationSize: true,
          rankingsDirty: true,
          rankingPublishedAt: true,
        },
      }),
    ]);

    let players: RankingPlayer[] = await Promise.all(
      snapshots.map(async (snapshot) => ({
        playerId: snapshot.playerId,
        playerName: snapshot.playerName,
        team: snapshot.club,
        position: snapshot.position,
        games: snapshot.gamesPlayed,
        ownership: await getOwnershipStatus(snapshot.playerId, leagueId),
        overall: snapshot.rankingValue,
        rank: snapshot.rank,
        isSmallSample: snapshot.isSmallSample,
        categories: Object.fromEntries(
          CATEGORY_MAP.map(([apiKey, statKey]) => [
            apiKey,
            {
              perGame: Number(snapshot.stats[statKey] ?? 0),
              zScore: Number(snapshot.categories[statKey] ?? 0),
            },
          ])
        ) as RankingPlayer['categories'],
      }))
    );

    if (position && position !== 'ALL') {
      players = players.filter((player) => player.position === position);
    }

    if (search) {
      players = players.filter(
        (player) =>
          player.playerName.toLowerCase().includes(search) || player.team.toLowerCase().includes(search)
      );
    }

    if (ownership) {
      players = players.filter((player) => player.ownership === ownership.toUpperCase());
    }

    const sortableCategories = new Set<RankingCategory>(CATEGORY_MAP.map(([key]) => key));
    if (sortBy === 'overall') {
      players.sort((left, right) =>
        sortDirection === 'asc' ? left.overall - right.overall : right.overall - left.overall
      );
    } else if (sortBy === 'name') {
      players.sort((left, right) =>
        sortDirection === 'asc'
          ? left.playerName.localeCompare(right.playerName)
          : right.playerName.localeCompare(left.playerName)
      );
    } else if (sortableCategories.has(sortBy as RankingCategory)) {
      const category = sortBy as RankingCategory;
      players.sort((left, right) =>
        sortDirection === 'asc'
          ? left.categories[category].perGame - right.categories[category].perGame
          : right.categories[category].perGame - left.categories[category].perGame
      );
    }

    const rankedPlayers = players.map((player, index) => ({
      ...player,
      rank: index + 1,
    }));
    const limitedPlayers = limit > 0 ? rankedPlayers.slice(0, limit) : rankedPlayers;

    return NextResponse.json(
      {
        success: true,
        data: {
          players: limitedPlayers,
          meta: {
            period: 'season',
            position: position || undefined,
            ownership: ownership || undefined,
            sortBy,
            totalPlayers: rankedPlayers.length,
            rankingMethod: publication?.rankingMethod ?? PLAYER_RANKING_METHOD,
            rankingMethodVersion:
              publication?.rankingMethodVersion ?? PLAYER_RANKING_METHOD_VERSION,
            minimumGames: publication?.rankingMinimumGames ?? 0,
            populationSize: publication?.rankingPopulationSize ?? snapshots.length,
            rankingsDirty: publication?.rankingsDirty ?? false,
            rankingPublishedAt: publication?.rankingPublishedAt?.toISOString() ?? null,
          },
        },
      },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
        },
      }
    );
  } catch (error) {
    logger.error('Failed to fetch rankings', error);
    return commonErrors.internalServerError('Failed to fetch rankings');
  }
}
