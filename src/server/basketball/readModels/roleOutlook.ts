import 'server-only';

import type { PrismaClient } from '@prisma/client';
import { unstable_cache } from 'next/cache';

import {
  dateOnlyToString,
  toEasternDate,
  type EasternDate,
  type FantasyWeekRange,
} from '@/lib/basketball/fantasyWeeks';
import { injuryOutlook, type InjuryOutlook } from '@/lib/basketball/injuryOutlook';
import {
  backToBackHistory,
  careerPriors,
  lastSeasonLines,
  type HistoryGame,
  type PlayerHistory,
  type Presence,
  type SeasonTotals,
} from '@/lib/basketball/playerHistory';
import { projectRestOfSeason, type RestOfSeasonProjection } from '@/lib/basketball/restOfSeason';
import { toRoleGameRows, type RoleBoxRow } from '@/lib/basketball/roleGameRows';
import { round1, runRoleModel, type RoleDriver, type RoleRow } from '@/lib/basketball/roleModel';
import {
  buildScheduleContext,
  clamp,
  upcomingGames,
  type ScheduleGame,
} from '@/lib/basketball/roleSchedule';
import { projectNextFive, type NextFiveProjection } from '@/lib/basketball/roleStatProjection';
import { prisma } from '@/lib/prisma';
import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';

import { currentFantasyWeek, OVERVIEW_STALE_AFTER_MS } from './overview';
import {
  loadStatsUpdatedAt,
  ownerLabels,
  type PlayerOwner,
  type PoolPlayerInjury,
} from './playerPool';

/**
 * The role outlook (the sheet's Role Model, `docs/domain/basketball.md#role-outlook`) for every
 * player in a season, computed once and shared by every league on that season, then labelled per
 * league. NBA data is read by season only; ownership comes from the already-authorised league.
 */

/** The reads the outlook makes; tests pass an in-memory fake. */
export type OutlookReadClient = Pick<
  PrismaClient,
  '$queryRaw' | 'nbaGame' | 'nbaPlayer' | 'nbaPlayerInjury' | 'nbaIngestRun'
>;

export interface OutlookInjury extends PoolPlayerInjury {
  seasonEnding: boolean;
}

export interface OutlookDriver extends RoleDriver {
  name: string;
}

export interface SeasonOutlookPlayer {
  playerId: string;
  fullName: string;
  positions: string[];
  /** The team of his latest box score; a traded player is shown for that team only. */
  teamCode: string;
  injury: OutlookInjury | null;
  role: Omit<RoleRow, 'playerId' | 'teamCode' | 'drivers' | 'raw'> & { drivers: OutlookDriver[] };
  next5: Omit<NextFiveProjection, 'playerId' | 'teamCode' | 'raw'>;
  restOfSeason: Omit<RestOfSeasonProjection, 'playerId' | 'teamCode' | 'raw'>;
}

export interface SeasonOutlook {
  season: number;
  today: EasternDate;
  /** When the latest successful box-score ingest finished (ISO), or null. */
  statsUpdatedAt: string | null;
  /** When the injury report in use was fetched (ISO), or null when it is empty. */
  injuriesFetchedAt: string | null;
  /** By total usage next 5, highest first (the sheet's order). */
  players: SeasonOutlookPlayer[];
}

export interface OutlookPlayer extends SeasonOutlookPlayer {
  owner: PlayerOwner;
  /** Expected games in the league's current fantasy week from today, to 0.1. */
  expectedGamesThisWeek: number;
  /** In the default view: on a roster in this league, or a top free agent. */
  relevant: boolean;
}

export interface OutlookView {
  season: number;
  today: EasternDate;
  /** The league's current fantasy week. */
  week: FantasyWeekRange;
  opponentName: string | null;
  statsUpdatedAt: string | null;
  injuriesFetchedAt: string | null;
  /** The injury report is over a day old (still used) or was never fetched. */
  injuriesStale: boolean;
  /** Every player with an outlook (the "All" filter), in the season order. */
  players: OutlookPlayer[];
}

/** Free agents in the default view: the most total usage next 5 among those expected to play. */
export const RELEVANT_FREE_AGENTS = 25;

interface InjuryRow {
  playerId: string;
  status: 'OUT' | 'DAY_TO_DAY';
  detail: string | null;
  expectedReturnOn: Date | null;
  seasonEnding: boolean;
  fetchedAt: Date;
}

/** Every listed player's line in the season's final games, played or not. */
function readSeasonRows(client: OutlookReadClient, season: number): Promise<RoleBoxRow[]> {
  return client.$queryRaw<RoleBoxRow[]>`
    SELECT s."gameId", to_char(g."gameDate", 'YYYY-MM-DD') AS "gameDate", t.code AS "teamCode",
      s."playerId", s.played, s."secondsPlayed", s."plusMinus", s.points, s.rebounds, s.assists,
      s.steals, s.blocks, s.turnovers, s."threePointersMade", s."fieldGoalsMade",
      s."fieldGoalsAttempted", s."freeThrowsMade", s."freeThrowsAttempted",
      CASE WHEN s."teamId" = g."homeTeamId" THEN g."homeScore" ELSE g."awayScore" END AS "teamScore",
      CASE WHEN s."teamId" = g."homeTeamId" THEN g."awayScore" ELSE g."homeScore" END AS "opponentScore"
    FROM "NbaPlayerGameStat" s
    JOIN "NbaGame" g ON g.id = s."gameId"
    JOIN "NbaTeam" t ON t.id = s."teamId"
    WHERE g.season = ${season} AND g.status = 'FINAL'`;
}

async function readSeasonGames(client: OutlookReadClient, season: number): Promise<ScheduleGame[]> {
  const games = await client.nbaGame.findMany({
    where: { season, status: { notIn: ['POSTPONED', 'CANCELLED'] } },
    select: {
      gameDate: true,
      status: true,
      homeTeam: { select: { code: true } },
      awayTeam: { select: { code: true } },
    },
    orderBy: [{ gameDate: 'asc' }, { id: 'asc' }],
  });
  return games.map((game) => ({
    date: dateOnlyToString(game.gameDate),
    home: game.homeTeam.code,
    away: game.awayTeam.code,
    final: game.status === 'FINAL',
  }));
}

/**
 * The history tables from earlier seasons' final games: season totals for up to 13 seasons (cameos
 * as 0.25 minutes), and the game list and played tuples of the last 3 for back-to-backs. Totals are
 * ordered so the career sums always add in the same order. Read on every miss of the season's
 * cache: an `unstable_cache` nested in another never reads its entry, and a separate daily entry
 * would cost every page view a read for a 0.2 s saving every half hour.
 */
async function readHistory(client: OutlookReadClient, season: number): Promise<PlayerHistory> {
  const [totals, games, presence] = await Promise.all([
    client.$queryRaw<SeasonTotals[]>`
      SELECT s."playerId", g.season, count(*)::int AS games,
        (sum(CASE WHEN s."secondsPlayed" = 0 THEN 15 ELSE s."secondsPlayed" END) / 60.0)::float8 AS minutes,
        sum(s.points)::int AS pts, sum(s."threePointersMade")::int AS fg3m,
        sum(s.rebounds)::int AS reb, sum(s.assists)::int AS ast, sum(s.steals)::int AS stl,
        sum(s.blocks)::int AS blk, sum(s.turnovers)::int AS tov,
        sum(s."fieldGoalsMade")::int AS fgm, sum(s."fieldGoalsAttempted")::int AS fga,
        sum(s."freeThrowsMade")::int AS ftm, sum(s."freeThrowsAttempted")::int AS fta
      FROM "NbaPlayerGameStat" s
      JOIN "NbaGame" g ON g.id = s."gameId"
      WHERE s.played AND g.status = 'FINAL' AND g.season < ${season} AND g.season >= ${season - 13}
      GROUP BY s."playerId", g.season
      ORDER BY s."playerId", g.season`,
    client.$queryRaw<HistoryGame[]>`
      SELECT g.season, to_char(g."gameDate", 'YYYY-MM-DD') AS date, h.code AS home, a.code AS away
      FROM "NbaGame" g
      JOIN "NbaTeam" h ON h.id = g."homeTeamId"
      JOIN "NbaTeam" a ON a.id = g."awayTeamId"
      WHERE g.status = 'FINAL' AND g.season < ${season} AND g.season >= ${season - 3}`,
    client.$queryRaw<Presence[]>`
      SELECT t.code AS team, to_char(g."gameDate", 'YYYY-MM-DD') AS date, s."playerId"
      FROM "NbaPlayerGameStat" s
      JOIN "NbaGame" g ON g.id = s."gameId"
      JOIN "NbaTeam" t ON t.id = s."teamId"
      WHERE s.played AND g.status = 'FINAL' AND g.season < ${season} AND g.season >= ${season - 3}`,
  ]);
  return {
    priors: careerPriors(totals, season),
    lastSeason: lastSeasonLines(totals, season),
    backToBack: backToBackHistory(games, presence, season),
  };
}

/** An engine row without the ids the outlook row already carries and its unrounded values. */
const shown = <T extends { playerId: string; teamCode: string; raw: unknown }>({
  playerId: _playerId,
  teamCode: _teamCode,
  raw: _raw,
  ...rest
}: T) => rest;

/**
 * The engine takes an injury off the first 5 games only (the sheet never shows more), but a
 * two-week fantasy week can hold more: from the 6th game on, his expected games out apply.
 */
const upcoming = (projection: NextFiveProjection, injury: InjuryOutlook | undefined) =>
  projection.upcoming.map((game, i) =>
    i < 5 || !injury
      ? game
      : { ...game, chancePlays: game.chancePlays * (1 - clamp(injury.gamesOut - i, 0, 1)) }
  );

async function computeSeasonOutlook(
  client: OutlookReadClient,
  season: number,
  today: EasternDate,
  injuries: readonly InjuryRow[]
): Promise<SeasonOutlookPlayer[]> {
  const [box, games, history] = await Promise.all([
    readSeasonRows(client, season),
    readSeasonGames(client, season),
    readHistory(client, season),
  ]);
  // Sorted by date, game, team and player whatever order the database returns.
  const rows = toRoleGameRows(box);
  const context = buildScheduleContext(rows, games, today);

  const currentTeam = new Map<string, { team: string; date: EasternDate }>();
  for (const row of box) {
    const seen = currentTeam.get(row.playerId);
    if (!seen || row.gameDate > seen.date) {
      currentTeam.set(row.playerId, { team: row.teamCode, date: row.gameDate });
    }
  }
  // A listed player with no box score this season is in no team's games, so the model never
  // reads him. Return dates count his current team's games. Stale rows are still used.
  const injuryInputs = new Map<string, InjuryOutlook>();
  for (const injury of injuries) {
    const team = currentTeam.get(injury.playerId)?.team;
    if (!team) continue;
    const dates = upcomingGames(context, team).map((game) => game.date);
    const returnOn = injury.expectedReturnOn && dateOnlyToString(injury.expectedReturnOn);
    injuryInputs.set(
      injury.playerId,
      injuryOutlook({ ...injury, expectedReturnOn: returnOn }, dates, today)
    );
  }

  const roles = runRoleModel(rows, injuryInputs).filter(
    (role) => role.teamCode === currentTeam.get(role.playerId)?.team
  );
  // Every role row has 3+ of his games for that team in `rows`: the projections return NaN for a
  // player-team with none, so they must be given the same rows the model ran on.
  const next5 = projectNextFive(rows, roles, context, history, injuryInputs);
  const ros = projectRestOfSeason(rows, roles, context, history, injuryInputs);

  const ids = [
    ...new Set(roles.flatMap((role) => [role.playerId, ...role.drivers.map((d) => d.playerId)])),
  ];
  const identities = ids.length
    ? await client.nbaPlayer.findMany({
        where: { id: { in: ids } },
        select: { id: true, fullName: true, positions: true },
      })
    : [];
  const identityById = new Map(identities.map((player) => [player.id, player]));
  const nameOf = (playerId: string) => identityById.get(playerId)?.fullName ?? 'Unknown player';
  const injuryById = new Map(injuries.map((injury) => [injury.playerId, injury]));

  return roles.map((role, i): SeasonOutlookPlayer => {
    const { playerId, teamCode, drivers } = role;
    const injury = injuryById.get(playerId);
    return {
      playerId,
      fullName: nameOf(playerId),
      positions: identityById.get(playerId)?.positions ?? [],
      teamCode,
      injury: injury
        ? {
            status: injury.status,
            detail: injury.detail,
            expectedReturnOn: injury.expectedReturnOn && dateOnlyToString(injury.expectedReturnOn),
            seasonEnding: injury.seasonEnding,
          }
        : null,
      role: { ...shown(role), drivers: drivers.map((d) => ({ ...d, name: nameOf(d.playerId) })) },
      next5: { ...shown(next5[i]), upcoming: upcoming(next5[i], injuryInputs.get(playerId)) },
      restOfSeason: shown(ros[i]),
    };
  });
}

/**
 * The season's outlook for every player, cached as computed output (the rows would be several
 * times the data cache's 2 MB entry limit) under the season, the latest box-score ingest, the
 * injury report's fetch time and the Eastern date; the revalidate is a backstop for schedule
 * changes. The injury report is read on every call: it keys the cache and is small.
 */
export async function loadSeasonOutlook(
  client: OutlookReadClient,
  season: number,
  today: EasternDate
): Promise<SeasonOutlook> {
  const [statsUpdatedAt, injuries] = await Promise.all([
    loadStatsUpdatedAt(client),
    client.nbaPlayerInjury.findMany({
      select: {
        playerId: true,
        status: true,
        detail: true,
        expectedReturnOn: true,
        seasonEnding: true,
        fetchedAt: true,
      },
    }),
  ]);
  const fetched = Math.max(...injuries.map((injury) => injury.fetchedAt.getTime()));
  const injuriesFetchedAt = injuries.length ? new Date(fetched).toISOString() : null;
  const players = await unstable_cache(
    () => computeSeasonOutlook(client, season, today, injuries),
    [
      'basketball:role-outlook',
      String(season),
      statsUpdatedAt ?? 'never',
      injuriesFetchedAt ?? 'never',
      today,
    ],
    { revalidate: 300 }
  )();
  return { season, today, statsUpdatedAt, injuriesFetchedAt, players };
}

/**
 * The Outlook page for one authorised league: the season's outlook labelled with who holds each
 * player, his expected games in the league's fantasy week, and the default view (every rostered
 * player and the top free agents by total usage next 5 among those expected to play at least once).
 */
export async function loadOutlook(
  league: BasketballLeagueDetail,
  options: { now?: Date; today?: EasternDate; client?: OutlookReadClient } = {}
): Promise<OutlookView> {
  const now = options.now ?? new Date();
  const today = options.today ?? toEasternDate(now);
  const season = await loadSeasonOutlook(options.client ?? prisma, league.season, today);
  const { owners, opponentName } = ownerLabels(league, today);
  const { week } = currentFantasyWeek(league, today);

  let freeAgents = 0;
  const players = season.players.map((player): OutlookPlayer => {
    const owner = owners.get(player.playerId) ?? { kind: 'FREE_AGENT', teamName: null };
    let relevant = owner.kind !== 'FREE_AGENT';
    if (!relevant && player.next5.expectedGames >= 1 && freeAgents < RELEVANT_FREE_AGENTS) {
      freeAgents += 1;
      relevant = true;
    }
    const thisWeek = player.next5.upcoming
      .filter((game) => game.date >= week.start && game.date <= week.end)
      .reduce((sum, game) => sum + game.chancePlays, 0);
    return { ...player, owner, expectedGamesThisWeek: round1(thisWeek), relevant };
  });

  const fetchedAt = season.injuriesFetchedAt;
  return {
    season: league.season,
    today,
    week,
    opponentName,
    statsUpdatedAt: season.statsUpdatedAt,
    injuriesFetchedAt: fetchedAt,
    injuriesStale:
      fetchedAt === null || now.getTime() - Date.parse(fetchedAt) > OVERVIEW_STALE_AFTER_MS,
    players,
  };
}
