/**
 * In-memory stand-in for the Prisma reads the basketball read models make. It understands only the
 * query shapes those modules send and throws on anything else, so a changed query fails loudly in
 * the unit tests instead of silently matching everything.
 */

import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';
import { NBA_STAT_KEYS, YAHOO_DEFAULT_ROSTER_SLOTS, type NbaStatLine } from '@/types/basketball';

import type { NbaReadClient } from '../playerPool';

export interface FakePlayer {
  id: string;
  fullName: string;
  positions: string[];
  teamId: string | null;
  active?: boolean;
  injury?: { status: 'OUT' | 'DAY_TO_DAY'; detail?: string | null; expectedReturnOn?: string };
}

export interface FakeGame {
  id: string;
  season: number;
  gameDate: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL' | 'POSTPONED' | 'CANCELLED';
  homeTeamId: string;
  awayTeamId: string;
  /** Defaults to true for FINAL games. */
  boxScoreIngested?: boolean;
}

export interface FakeStat extends NbaStatLine {
  gameId: string;
  playerId: string;
  teamId: string;
  played: boolean;
  secondsPlayed: number;
}

export interface FakeRun {
  job: string;
  outcome: string | null;
  finishedAt: Date | null;
}

export interface FakeNbaData {
  teams: { id: string; code: string }[];
  players: FakePlayer[];
  games: FakeGame[];
  stats: FakeStat[];
  runs?: FakeRun[];
}

/** A box-score row: zeros except the given counts; 30 minutes and played unless stated. */
export function statRow(
  gameId: string,
  playerId: string,
  teamId: string,
  line: Partial<FakeStat> = {}
): FakeStat {
  const zeros = Object.fromEntries(NBA_STAT_KEYS.map((key) => [key, 0])) as NbaStatLine;
  return { gameId, playerId, teamId, played: true, secondsPlayed: 1800, ...zeros, ...line };
}

function unsupported(what: string, args: unknown): never {
  throw new Error(`fakeNbaClient: unsupported ${what}: ${JSON.stringify(args)}`);
}

function inList(filter: unknown, value: string): boolean {
  if (filter === undefined) return true;
  if (filter && typeof filter === 'object' && 'in' in filter) {
    return (filter as { in: string[] }).in.includes(value);
  }
  return unsupported('list filter', filter);
}

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

export function createFakeNbaClient(data: FakeNbaData): NbaReadClient {
  const gameById = new Map(data.games.map((game) => [game.id, game]));
  const teamCode = (teamId: string | null) =>
    data.teams.find((team) => team.id === teamId)?.code ?? null;

  const client = {
    nbaPlayerGameStat: {
      async groupBy(args: {
        by: string[];
        where: { played?: boolean; game?: { season?: number; status?: string } };
      }) {
        const { played, game: gameWhere, ...rest } = args.where;
        if (args.by.join() !== 'playerId' || Object.keys(rest).length > 0) {
          unsupported('groupBy', args);
        }
        const groups = new Map<string, FakeStat[]>();
        for (const stat of data.stats) {
          const game = gameById.get(stat.gameId);
          if (!game) continue;
          if (played !== undefined && stat.played !== played) continue;
          if (gameWhere?.season !== undefined && game.season !== gameWhere.season) continue;
          if (gameWhere?.status !== undefined && game.status !== gameWhere.status) continue;
          groups.set(stat.playerId, [...(groups.get(stat.playerId) ?? []), stat]);
        }
        return [...groups].map(([playerId, rows]) => ({
          playerId,
          _count: { _all: rows.length },
          _sum: Object.fromEntries(
            ['secondsPlayed', ...NBA_STAT_KEYS].map((key) => [
              key,
              rows.reduce((sum, row) => sum + (row[key as keyof NbaStatLine] as number), 0),
            ])
          ),
        }));
      },
      async findMany(args: { where: { played?: boolean; gameId?: unknown; playerId?: unknown } }) {
        const { played, gameId, playerId, ...rest } = args.where;
        if (Object.keys(rest).length > 0) unsupported('stat findMany', args);
        return data.stats.filter(
          (stat) =>
            (played === undefined || stat.played === played) &&
            inList(gameId, stat.gameId) &&
            inList(playerId, stat.playerId)
        );
      },
    },
    nbaPlayer: {
      async findMany(args: { where: { OR?: unknown[]; id?: unknown } }) {
        const matches = (player: FakePlayer, where: Record<string, unknown>): boolean =>
          Object.entries(where).every(([key, filter]) => {
            if (key === 'active') return (player.active ?? true) === filter;
            if (key === 'id') return inList(filter, player.id);
            if (key === 'OR') {
              return (filter as Record<string, unknown>[]).some((branch) =>
                matches(player, branch)
              );
            }
            return unsupported('player filter', where);
          });
        return data.players
          .filter((player) => matches(player, args.where as Record<string, unknown>))
          .map((player) => ({
            id: player.id,
            fullName: player.fullName,
            positions: player.positions,
            teamId: player.teamId,
            team: player.teamId ? { code: teamCode(player.teamId) } : null,
            injury: player.injury
              ? {
                  status: player.injury.status,
                  detail: player.injury.detail ?? null,
                  expectedReturnOn: player.injury.expectedReturnOn
                    ? day(player.injury.expectedReturnOn)
                    : null,
                }
              : null,
          }));
      },
    },
    nbaGame: {
      async findMany(args: {
        where: { season: number; gameDate: { gte: Date; lte: Date }; [key: string]: unknown };
      }) {
        const { season, gameDate, ...rest } = args.where;
        if (Object.keys(rest).length > 0) unsupported('game findMany', args);
        return data.games
          .filter(
            (game) =>
              game.season === season &&
              day(game.gameDate) >= gameDate.gte &&
              day(game.gameDate) <= gameDate.lte
          )
          .map((game) => ({
            id: game.id,
            gameDate: day(game.gameDate),
            status: game.status,
            homeTeamId: game.homeTeamId,
            awayTeamId: game.awayTeamId,
            boxScoreIngestedAt:
              (game.boxScoreIngested ?? game.status === 'FINAL') ? day(game.gameDate) : null,
          }));
      },
    },
    nbaIngestRun: {
      async findFirst(args: { where: { job: { in: string[] }; outcome: string } }) {
        const runs = (data.runs ?? [])
          .filter(
            (run) =>
              args.where.job.in.includes(run.job) &&
              run.outcome === args.where.outcome &&
              run.finishedAt
          )
          .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0));
        return runs[0] ? { finishedAt: runs[0].finishedAt } : null;
      },
    },
  };
  return client as unknown as NbaReadClient;
}

/** A 9-cat, 2-team league profile for season 2027 (2026-27), week 1 starting Mon 19 Oct 2026. */
export function leagueFixture(
  overrides: Partial<BasketballLeagueDetail> = {}
): BasketballLeagueDetail {
  return {
    id: 'league-1',
    name: 'Test league',
    platform: 'YAHOO',
    format: 'H2H_MOST_CATEGORIES',
    season: 2027,
    categories: ['FG_PCT', 'FT_PCT', 'THREES', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO'],
    puntCategories: [],
    teamCount: 2,
    rosterSlots: YAHOO_DEFAULT_ROSTER_SLOTS,
    weekOneStartsOn: '2026-10-19',
    regularSeasonEndsOn: '2027-04-11',
    twoWeekMatchups: [],
    auctionBudget: null,
    myTeamId: 'team-me',
    teams: [
      { id: 'team-me', name: 'My Team', isMine: true, sortOrder: 0 },
      { id: 'team-opp', name: 'Rivals', isMine: false, sortOrder: 1 },
      { id: 'team-other', name: 'Others', isMine: false, sortOrder: 2 },
    ],
    rosterSpots: [],
    matchups: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A roster spot for `leagueFixture`; the player details are not read by the read models. */
export function spot(
  playerId: string,
  teamId: string | null,
  extra: { onInjuredList?: boolean; acquiredOn?: string } = {}
): BasketballLeagueDetail['rosterSpots'][number] {
  return {
    playerId,
    teamId,
    onInjuredList: extra.onInjuredList ?? false,
    acquiredOn: extra.acquiredOn ?? '2026-10-19',
    player: { fullName: playerId, teamCode: null, positions: [], active: true, injury: null },
  };
}
