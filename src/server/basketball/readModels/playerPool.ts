import 'server-only';

import type { PrismaClient } from '@prisma/client';
import { cache } from 'react';

import {
  dateOnlyToString,
  fantasyWeekOf,
  toEasternDate,
  type EasternDate,
} from '@/lib/basketball/fantasyWeeks';
import {
  blendProjection,
  type PlayerProjection,
  type PlayerSeasonTotals,
} from '@/lib/basketball/projection';
import { auctionValues, valuePlayers } from '@/lib/basketball/valuation';
import { prisma } from '@/lib/prisma';
import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';
import {
  countRosterSpots,
  NBA_STAT_KEYS,
  type BasketballCategoryId,
  type NbaStatKey,
  type NbaStatLine,
} from '@/types/basketball';

/** The Prisma reads the basketball read models make; tests pass an in-memory fake. */
export type NbaReadClient = Pick<
  PrismaClient,
  'nbaPlayerGameStat' | 'nbaPlayer' | 'nbaGame' | 'nbaIngestRun'
>;

export type PlayerOwner =
  | { kind: 'MINE' | 'OPPONENT' | 'TEAM'; teamName: string }
  | { kind: 'ELSEWHERE' | 'FREE_AGENT'; teamName: null };

export interface PoolPlayerInjury {
  status: 'OUT' | 'DAY_TO_DAY';
  detail: string | null;
  expectedReturnOn: EasternDate | null;
}

export interface PoolPlayer extends Omit<PlayerProjection, 'playerId'> {
  playerId: string;
  fullName: string;
  teamId: string | null;
  teamCode: string | null;
  positions: string[];
  injury: PoolPlayerInjury | null;
  owner: PlayerOwner;
  /** z per catalog category, higher always better. */
  categoryZ: Record<BasketballCategoryId, number>;
  /** Σ z over the league's categories that are not punted. */
  value: number;
  rank: number;
  /** In the pool that sets the means and spreads (blended MPG ≥ 20). */
  inPool: boolean;
  /** null when the league has no auction budget. */
  auctionDollars: number | null;
}

export interface PlayerPool {
  season: number;
  lastSeason: number;
  categories: BasketballCategoryId[];
  leaguePunts: BasketballCategoryId[];
  /** The punts the values use: the what-if override, else the league's. */
  punts: BasketballCategoryId[];
  /** Sorted by rank. Active players, plus any inactive player rostered in this league. */
  players: PoolPlayer[];
  /** When the latest successful box-score ingest finished (ISO), or null. */
  statsUpdatedAt: string | null;
  /** Median games this season among pool players: the typical blend weight. */
  typicalGamesThisSeason: number;
}

/** Prisma select for the box-score counts that make a stat line. */
export const STAT_LINE_SELECT = {
  points: true,
  rebounds: true,
  assists: true,
  steals: true,
  blocks: true,
  turnovers: true,
  threePointersMade: true,
  threePointersAttempted: true,
  fieldGoalsMade: true,
  fieldGoalsAttempted: true,
  freeThrowsMade: true,
  freeThrowsAttempted: true,
} as const satisfies Record<NbaStatKey, true>;

/** The stat line held in a row selected with `STAT_LINE_SELECT`. */
export function toStatLine(row: Record<NbaStatKey, number | null>): NbaStatLine {
  return Object.fromEntries(NBA_STAT_KEYS.map((key) => [key, row[key] ?? 0])) as NbaStatLine;
}

/** Played regular-season (all stored games are) FINAL games, summed per player for one season. */
const loadSeasonTotals = cache(
  async (client: NbaReadClient, season: number): Promise<Map<string, PlayerSeasonTotals>> => {
    const rows = await client.nbaPlayerGameStat.groupBy({
      by: ['playerId'],
      where: { played: true, game: { season, status: 'FINAL' } },
      _count: { _all: true },
      _sum: { secondsPlayed: true, ...STAT_LINE_SELECT },
    });
    return new Map(
      rows.map((row) => {
        const totals: PlayerSeasonTotals = {
          ...toStatLine(row._sum),
          playerId: row.playerId,
          gamesPlayed: row._count._all,
          secondsPlayed: row._sum.secondsPlayed ?? 0,
        };
        return [row.playerId, totals];
      })
    );
  }
);

const loadStatsUpdatedAt = cache(async (client: NbaReadClient): Promise<string | null> => {
  const run = await client.nbaIngestRun.findFirst({
    where: { job: { in: ['BOX_SCORES', 'BACKFILL'] }, outcome: 'SUCCEEDED' },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  return run?.finishedAt?.toISOString() ?? null;
});

function ownerLabels(league: BasketballLeagueDetail, today: EasternDate): Map<string, PlayerOwner> {
  const week = fantasyWeekOf(today, league.weekOneStartsOn, league.twoWeekMatchups);
  const opponentId = league.matchups.find(
    (matchup) => matchup.week === week && matchup.teamId === league.myTeamId
  )?.opponentTeamId;
  const teamName = new Map(league.teams.map((team) => [team.id, team.name]));
  return new Map(
    league.rosterSpots.map((spot): [string, PlayerOwner] => {
      if (spot.teamId === null) return [spot.playerId, { kind: 'ELSEWHERE', teamName: null }];
      const kind =
        spot.teamId === league.myTeamId ? 'MINE' : spot.teamId === opponentId ? 'OPPONENT' : 'TEAM';
      return [spot.playerId, { kind, teamName: teamName.get(spot.teamId) ?? '' }];
    })
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Every player worth listing for this league: blended projection (this season with last season),
 * volume-weighted z per category, value under the league's punts (or a what-if `punts` override),
 * auction dollars when the league has a budget, and who holds him in this league. NBA data is read
 * by season only; ownership comes from the already-authorised league profile.
 */
export async function loadPlayerPool(
  league: BasketballLeagueDetail,
  options: {
    punts?: readonly BasketballCategoryId[];
    today?: EasternDate;
    client?: NbaReadClient;
  } = {}
): Promise<PlayerPool> {
  const client = options.client ?? prisma;
  const today = options.today ?? toEasternDate(new Date());
  const season = league.season;
  const lastSeason = season - 1;
  const rostered = league.rosterSpots.map((spot) => spot.playerId);

  const [thisTotals, lastTotals, identities, statsUpdatedAt] = await Promise.all([
    loadSeasonTotals(client, season),
    loadSeasonTotals(client, lastSeason),
    client.nbaPlayer.findMany({
      where: { OR: [{ active: true }, { id: { in: rostered } }] },
      select: {
        id: true,
        fullName: true,
        positions: true,
        teamId: true,
        team: { select: { code: true } },
        injury: { select: { status: true, detail: true, expectedReturnOn: true } },
      },
    }),
    loadStatsUpdatedAt(client),
  ]);

  const projections = identities.flatMap((player) => {
    const projection = blendProjection(thisTotals.get(player.id), lastTotals.get(player.id));
    return projection ? [projection] : [];
  });
  const punts = [...(options.punts ?? league.puntCategories)];
  const values = valuePlayers(projections, { categories: league.categories, punts });
  const dollars = league.auctionBudget
    ? auctionValues(
        values.map((value) => ({ playerId: value.playerId, total: value.total })),
        {
          teamCount: league.teamCount,
          rosterSpots: countRosterSpots(league.rosterSlots),
          budget: league.auctionBudget,
        }
      )
    : null;

  const identityById = new Map(identities.map((player) => [player.id, player]));
  const projectionById = new Map(
    projections.map((projection) => [projection.playerId, projection])
  );
  const owners = ownerLabels(league, today);

  const players = values.map((value): PoolPlayer => {
    const identity = identityById.get(value.playerId)!;
    const projection = projectionById.get(value.playerId)!;
    return {
      ...projection,
      fullName: identity.fullName,
      teamId: identity.teamId,
      teamCode: identity.team?.code ?? null,
      positions: identity.positions,
      injury: identity.injury
        ? {
            status: identity.injury.status,
            detail: identity.injury.detail,
            expectedReturnOn: identity.injury.expectedReturnOn
              ? dateOnlyToString(identity.injury.expectedReturnOn)
              : null,
          }
        : null,
      owner: owners.get(value.playerId) ?? { kind: 'FREE_AGENT', teamName: null },
      categoryZ: value.categoryZ,
      value: value.total,
      rank: value.rank,
      inPool: value.inPool,
      auctionDollars: dollars ? (dollars[value.playerId] ?? 1) : null,
    };
  });

  return {
    season,
    lastSeason,
    categories: [...league.categories],
    leaguePunts: [...league.puntCategories],
    punts,
    players,
    statsUpdatedAt,
    typicalGamesThisSeason: median(
      players.filter((player) => player.inPool).map((player) => player.gamesThisSeason)
    ),
  };
}
