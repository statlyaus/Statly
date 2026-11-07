import 'server-only';

import { planAddDrop, type AddDropOption, type NeedComparison } from '@/lib/basketball/addDrop';
import { addDays, toEasternDate, type EasternDate } from '@/lib/basketball/fantasyWeeks';
import { projectRestOfWeek } from '@/lib/basketball/matchup';
import { addStatLines } from '@/lib/basketball/statLine';
import { prisma } from '@/lib/prisma';
import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';
import type { NbaStatLine } from '@/types/basketball';

import { loadMatchupContext, playingDays, type TeamRef } from './matchupModel';
import type { NbaReadClient, PlayerPool, PoolPlayer } from './playerPool';
import type { WeekSchedule } from './weekSchedule';

/** Free agents need at least this many blended minutes per game (the sheet's Add/Drop default). */
export const PICKUP_MIN_MINUTES = 15;
/** How many free agents, by season value, the planner ranks. */
export const PICKUP_LIMIT = 80;

export interface DropOption {
  playerId: string;
  fullName: string;
  value: number | null;
  onInjuredList: boolean;
}

export interface PickupOption extends Omit<AddDropOption, 'playerId'> {
  player: PoolPlayer;
}

interface PickupsBase {
  week: number;
  schedule: WeekSchedule;
  /** Adds take effect the next Eastern date. */
  addFrom: EasternDate;
  myTeam: TeamRef;
  pool: PlayerPool;
  /** My roster, highest value first. */
  dropOptions: DropOption[];
  /** null: no drop (an open roster spot). */
  drop: DropOption | null;
}

export type PickupsView =
  | (PickupsBase & {
      status: 'READY';
      opponentTeam: TeamRef;
      now: { categories: NeedComparison[]; categoriesWon: number };
      opponentTotal: NbaStatLine;
      dropRestOfWeek: NbaStatLine;
      /** Sorted by category change, then fit. */
      options: PickupOption[];
    })
  | (PickupsBase & {
      status: 'NO_OPPONENT';
      /** Highest season value first. */
      freeAgents: PoolPlayer[];
    });

/**
 * This week's streaming planner. Free agents are players not rostered anywhere in the profile,
 * healthy or day-to-day, with blended minutes of at least `minMinutes`, best `limit` by season
 * value. `drop` undefined picks my lowest-valued player not on the IL; null drops nobody; an id
 * not on my roster falls back to the default.
 */
export async function loadPickups(
  league: BasketballLeagueDetail,
  options: {
    drop?: string | null;
    minMinutes?: number;
    limit?: number;
    today?: EasternDate;
    client?: NbaReadClient;
  } = {}
): Promise<PickupsView> {
  const client = options.client ?? prisma;
  const today = options.today ?? toEasternDate(new Date());
  const context = await loadMatchupContext(league, { today, client });
  const { pool, schedule, week, myTeam, me } = context;
  const poolById = new Map(pool.players.map((player) => [player.playerId, player]));

  const dropOptions = [...me.side.roster]
    .sort((a, b) => b.value - a.value)
    .map((entry): DropOption => {
      const player = poolById.get(entry.playerId);
      const spot = league.rosterSpots.find((candidate) => candidate.playerId === entry.playerId);
      return {
        playerId: entry.playerId,
        fullName: player?.fullName ?? spot?.player.fullName ?? entry.playerId,
        value: player?.value ?? null,
        onInjuredList: entry.onInjuredList,
      };
    });
  const defaultDrop = [...dropOptions].reverse().find((option) => !option.onInjuredList) ?? null;
  const drop =
    options.drop === null
      ? null
      : (dropOptions.find((option) => option.playerId === options.drop) ?? defaultDrop);

  const minMinutes = options.minMinutes ?? PICKUP_MIN_MINUTES;
  const freeAgents = pool.players
    .filter(
      (player) =>
        player.owner.kind === 'FREE_AGENT' &&
        player.injury?.status !== 'OUT' &&
        player.minutesPerGame >= minMinutes
    )
    .slice(0, options.limit ?? PICKUP_LIMIT);
  const addFrom = addDays(today, 1);
  const base = { week, schedule, addFrom, myTeam, pool, dropOptions, drop };

  if (!context.opponent || !context.opponentTeam) {
    return { ...base, status: 'NO_OPPONENT', freeAgents };
  }

  const teamOf = (playerId: string) => poolById.get(playerId)?.teamId ?? null;
  const remainingDays = playingDays(schedule, [
    ...[...me.side.roster, ...context.opponent.side.roster].map((entry) => ({
      playerId: entry.playerId,
      teamId: teamOf(entry.playerId),
    })),
    ...freeAgents.map((player) => ({ playerId: player.playerId, teamId: player.teamId })),
  ]);
  const opponentRest = projectRestOfWeek({
    ...context.opponent.side,
    slots: league.rosterSlots,
    days: remainingDays,
  });
  const opponentTotal = addStatLines(context.opponent.side.actual, opponentRest.restOfWeek);

  const plan = planAddDrop({
    categories: league.categories,
    slots: league.rosterSlots,
    remainingDays,
    me: me.side,
    opponentTotal,
    dropPlayerId: drop?.playerId ?? null,
    addFrom,
    freeAgents: freeAgents.map((player) => ({
      playerId: player.playerId,
      positions: player.positions,
      value: player.value,
      perGame: player.perGame,
    })),
  });

  return {
    ...base,
    status: 'READY',
    opponentTeam: context.opponentTeam,
    now: plan.now,
    opponentTotal,
    dropRestOfWeek: plan.dropRestOfWeek,
    options: plan.options.map(({ playerId, ...option }) => ({
      ...option,
      player: poolById.get(playerId)!,
    })),
  };
}
