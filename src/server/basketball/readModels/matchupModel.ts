import 'server-only';

import { cache } from 'react';

import {
  fantasyWeekOf,
  lastFantasyWeek,
  toEasternDate,
  type EasternDate,
} from '@/lib/basketball/fantasyWeeks';
import {
  countedActuals,
  type LineupDay,
  type LineupRosterEntry,
} from '@/lib/basketball/lineupSimulator';
import { projectMatchup, type MatchupProjection, type MatchupSide } from '@/lib/basketball/matchup';
import { emptyStatLine, scaleStatLine } from '@/lib/basketball/statLine';
import { prisma } from '@/lib/prisma';
import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';
import type { NbaStatLine } from '@/types/basketball';

import {
  loadPlayerPool,
  STAT_LINE_SELECT,
  toStatLine,
  type NbaReadClient,
  type PlayerPool,
  type PoolPlayer,
} from './playerPool';
import { loadWeekSchedule, type WeekSchedule } from './weekSchedule';

/** Lineup value for a rostered player with no projection: last in every lineup. */
const NO_VALUE = -1_000;

export interface MatchupPlayerRow {
  playerId: string;
  fullName: string;
  teamCode: string | null;
  positions: string[];
  injury: PoolPlayer['injury'];
  onInjuredList: boolean;
  acquiredOn: EasternDate;
  /** His NBA team's games on the week's remaining dates. */
  teamGamesLeft: number;
  /** Remaining games the lineup simulator starts him. */
  countedLeft: number;
  /** Played dates on which he was simulated into the lineup. */
  countedSoFar: number;
  actual: NbaStatLine;
  restOfWeek: NbaStatLine;
  /** False when he has no games in either season, so nothing can be projected. */
  hasProjection: boolean;
}

export interface TeamRef {
  id: string;
  name: string;
}

/** A side's inputs to the engine, plus what the tables need. */
export interface SideInputs {
  team: TeamRef;
  side: MatchupSide;
  /** Starts per player on played dates. */
  countedSoFar: Record<string, number>;
  /** Counted actual line per player. */
  actualByPlayer: Record<string, NbaStatLine>;
}

export interface MatchupContext {
  week: number;
  lastWeek: number;
  pool: PlayerPool;
  schedule: WeekSchedule;
  myTeam: TeamRef;
  opponentTeam: TeamRef | null;
  me: SideInputs;
  opponent: SideInputs | null;
  /** Current NBA team of every player on either side, projected or not. */
  teamIdByPlayer: Record<string, string | null>;
}

interface MatchupSideView {
  team: TeamRef;
  /** Highest value first. */
  players: MatchupPlayerRow[];
}

export type MatchupView =
  | {
      status: 'NO_OPPONENT';
      week: number;
      lastWeek: number;
      schedule: WeekSchedule;
      myTeam: TeamRef;
      pool: PlayerPool;
    }
  | {
      status: 'READY';
      week: number;
      lastWeek: number;
      schedule: WeekSchedule;
      myTeam: TeamRef;
      opponentTeam: TeamRef;
      pool: PlayerPool;
      projection: MatchupProjection;
      me: MatchupSideView;
      opponent: MatchupSideView;
    };

/** Week within 1…last week; the current week when none is given. */
export function resolveWeek(
  league: BasketballLeagueDetail,
  week: number | undefined,
  today: EasternDate
): { week: number; lastWeek: number } {
  const lastWeek = lastFantasyWeek(
    league.weekOneStartsOn,
    league.regularSeasonEndsOn,
    league.twoWeekMatchups
  );
  const wanted =
    week !== undefined && Number.isInteger(week)
      ? week
      : fantasyWeekOf(today, league.weekOneStartsOn, league.twoWeekMatchups);
  return { week: Math.min(lastWeek, Math.max(1, wanted)), lastWeek };
}

/** Per remaining date, the given players whose NBA team plays that day. */
export function playingDays(
  schedule: WeekSchedule,
  players: readonly { playerId: string; teamId: string | null }[]
): LineupDay[] {
  return schedule.remainingDates.map((date) => {
    const teams = new Set(schedule.teamsByDate[date]);
    return {
      date,
      playing: players
        .filter((player) => player.teamId !== null && teams.has(player.teamId))
        .map((player) => player.playerId),
    };
  });
}

function lineupEntry(
  spot: BasketballLeagueDetail['rosterSpots'][number],
  player: PoolPlayer | undefined
): LineupRosterEntry {
  return {
    playerId: spot.playerId,
    positions: player?.positions ?? spot.player.positions,
    value: player?.value ?? NO_VALUE,
    onInjuredList: spot.onInjuredList,
    out: (player?.injury ?? spot.player.injury)?.status === 'OUT',
    acquiredOn: spot.acquiredOn,
  };
}

/**
 * Everything the matchup and pickups pages compose: the pool, the week's schedule, and each side's
 * roster, per-game lines and counted actuals so far. A side is the league's roster spots for one
 * entered team; actuals are box-score lines from the week's played dates, run through the lineup
 * simulator from the date each player was acquired.
 */
export async function loadMatchupContext(
  league: BasketballLeagueDetail,
  options: { week?: number; today?: EasternDate; client?: NbaReadClient } = {}
): Promise<MatchupContext> {
  const client = options.client ?? prisma;
  const today = options.today ?? toEasternDate(new Date());
  const { week } = resolveWeek(league, options.week, today);
  // Resolved to primitives first so the overview's matchup and pickups loads share one build.
  return buildMatchupContext(league, week, today, client);
}

/** One build per (league, week, date, client) per request: the overview loads it twice. */
const buildMatchupContext = cache(async function buildMatchupContext(
  league: BasketballLeagueDetail,
  requestedWeek: number,
  today: EasternDate,
  client: NbaReadClient
): Promise<MatchupContext> {
  const { week, lastWeek } = resolveWeek(league, requestedWeek, today);
  const teamName = new Map(league.teams.map((team) => [team.id, team.name]));
  const opponentId = league.matchups.find(
    (matchup) => matchup.week === week && matchup.teamId === league.myTeamId
  )?.opponentTeamId;
  const sideTeams = [league.myTeamId, ...(opponentId ? [opponentId] : [])];
  const sideSpots = league.rosterSpots.filter(
    (spot) => spot.teamId !== null && sideTeams.includes(spot.teamId)
  );

  const [pool, schedule] = await Promise.all([
    loadPlayerPool(league, { today, client }),
    loadWeekSchedule(league, week, { today, client }),
  ]);
  const dateByGame = new Map(schedule.finalGames.map((game) => [game.gameId, game.date]));
  const lines =
    dateByGame.size > 0 && sideSpots.length > 0
      ? await client.nbaPlayerGameStat.findMany({
          where: {
            played: true,
            gameId: { in: [...dateByGame.keys()] },
            playerId: { in: sideSpots.map((spot) => spot.playerId) },
          },
          select: { gameId: true, playerId: true, ...STAT_LINE_SELECT },
        })
      : [];

  const poolById = new Map(pool.players.map((player) => [player.playerId, player]));
  // Rostered players the pool has no row for (no games in either season) still have a team.
  const unprojected = sideSpots
    .filter((spot) => !poolById.has(spot.playerId))
    .map((spot) => spot.playerId);
  const unprojectedTeams =
    unprojected.length > 0
      ? await client.nbaPlayer.findMany({
          where: { id: { in: unprojected } },
          select: { id: true, teamId: true },
        })
      : [];
  const teamIdByPlayer: Record<string, string | null> = Object.fromEntries([
    ...unprojectedTeams.map((player) => [player.id, player.teamId]),
    ...sideSpots.flatMap((spot) => {
      const player = poolById.get(spot.playerId);
      return player ? [[spot.playerId, player.teamId]] : [];
    }),
  ]);
  const buildSide = (teamId: string): SideInputs => {
    const spots = sideSpots.filter((spot) => spot.teamId === teamId);
    const roster = spots.map((spot) => lineupEntry(spot, poolById.get(spot.playerId)));
    const ids = new Set(roster.map((entry) => entry.playerId));
    const days = schedule.playedDates.map((date) => ({
      date,
      lines: Object.fromEntries(
        lines
          .filter((line) => ids.has(line.playerId) && dateByGame.get(line.gameId) === date)
          .map((line) => [line.playerId, toStatLine(line)])
      ),
    }));
    const counted = countedActuals({ roster, slots: league.rosterSlots, days });
    const countedSoFar: Record<string, number> = {};
    for (const lineup of counted.lineups) {
      for (const playerId of lineup.starters)
        countedSoFar[playerId] = (countedSoFar[playerId] ?? 0) + 1;
    }
    const perGame = Object.fromEntries(
      spots.flatMap((spot) => {
        const player = poolById.get(spot.playerId);
        return player ? [[spot.playerId, player.perGame]] : [];
      })
    );
    return {
      team: { id: teamId, name: teamName.get(teamId) ?? '' },
      side: { roster, perGame, actual: counted.total },
      countedSoFar,
      actualByPlayer: counted.byPlayer,
    };
  };

  return {
    week,
    lastWeek,
    pool,
    schedule,
    myTeam: { id: league.myTeamId, name: teamName.get(league.myTeamId) ?? '' },
    opponentTeam: opponentId ? { id: opponentId, name: teamName.get(opponentId) ?? '' } : null,
    me: buildSide(league.myTeamId),
    opponent: opponentId ? buildSide(opponentId) : null,
    teamIdByPlayer,
  };
});

function sideView(
  inputs: SideInputs,
  gamesLeft: Record<string, number>,
  context: MatchupContext,
  league: BasketballLeagueDetail
): MatchupSideView {
  const poolById = new Map(context.pool.players.map((player) => [player.playerId, player]));
  const spotById = new Map(league.rosterSpots.map((spot) => [spot.playerId, spot]));
  const players = [...inputs.side.roster]
    .sort((a, b) => b.value - a.value)
    .map((entry): MatchupPlayerRow => {
      const spot = spotById.get(entry.playerId)!;
      const player = poolById.get(entry.playerId);
      const perGame = inputs.side.perGame[entry.playerId];
      const countedLeft = gamesLeft[entry.playerId] ?? 0;
      const teamId = context.teamIdByPlayer[entry.playerId] ?? null;
      return {
        playerId: entry.playerId,
        fullName: player?.fullName ?? spot.player.fullName,
        teamCode: player?.teamCode ?? spot.player.teamCode,
        positions: entry.positions as string[],
        injury: player?.injury ?? spot.player.injury,
        onInjuredList: entry.onInjuredList,
        acquiredOn: entry.acquiredOn,
        teamGamesLeft: teamId ? (context.schedule.gamesByTeam[teamId]?.remaining ?? 0) : 0,
        countedLeft,
        countedSoFar: inputs.countedSoFar[entry.playerId] ?? 0,
        actual: inputs.actualByPlayer[entry.playerId] ?? emptyStatLine(),
        restOfWeek: perGame ? scaleStatLine(perGame, countedLeft) : emptyStatLine(),
        hasProjection: Boolean(perGame),
      };
    });
  return { team: inputs.team, players };
}

/** The week's head-to-head projection against this week's opponent (default: the current week). */
export async function loadMatchup(
  league: BasketballLeagueDetail,
  options: { week?: number; today?: EasternDate; client?: NbaReadClient } = {}
): Promise<MatchupView> {
  const context = await loadMatchupContext(league, options);
  const { week, lastWeek, schedule, myTeam, pool } = context;
  if (!context.opponent || !context.opponentTeam) {
    return { status: 'NO_OPPONENT', week, lastWeek, schedule, myTeam, pool };
  }

  const rostered = [...context.me.side.roster, ...context.opponent.side.roster].map((entry) => ({
    playerId: entry.playerId,
    teamId: context.teamIdByPlayer[entry.playerId] ?? null,
  }));
  const projection = projectMatchup({
    categories: league.categories,
    format: league.format,
    slots: league.rosterSlots,
    remainingDays: playingDays(schedule, rostered),
    me: context.me.side,
    opponent: context.opponent.side,
  });

  return {
    status: 'READY',
    week,
    lastWeek,
    schedule,
    myTeam,
    opponentTeam: context.opponentTeam,
    pool,
    projection,
    me: sideView(context.me, projection.me.gamesLeft, context, league),
    opponent: sideView(context.opponent, projection.opponent.gamesLeft, context, league),
  };
}
