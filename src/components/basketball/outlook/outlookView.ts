/**
 * The Outlook page's view state, read from URL search params, and the filter, sort and ranked
 * lists it shows. Pure and isomorphic.
 */

import type { OutlookPlayer } from '@/server/basketball/readModels/roleOutlook';

import { firstParam, type SearchParams } from '../analysis/searchParams';

export type OutlookTableView = 'NEXT5' | 'ROS';
export type OutlookShow = 'RELEVANT' | 'MINE' | 'OPPONENT' | 'FREE_AGENTS' | 'ROSTERED' | 'ALL';

export interface OutlookQuery {
  view: OutlookTableView;
  show: OutlookShow;
  sort: string;
  descending: boolean;
}

const STAT_SORTS = ['pts', 'fg3m', 'reb', 'ast', 'stl', 'blk', 'tov'] as const;

type SortValue = (player: OutlookPlayer) => number;

/** Sortable columns per view; the stat columns share keys so a sort survives a view change. */
export const SORTS: Record<OutlookTableView, Record<string, SortValue>> = {
  NEXT5: {
    gp: (p) => p.role.gamesPlayed,
    minL5: (p) => p.role.minutesLast5,
    min: (p) => p.role.minutesNext5,
    up3: (p) => p.role.chanceMinutesUp3,
    down3: (p) => p.role.chanceMinutesDown3,
    usg: (p) => p.role.usageNext5,
    usage: (p) => p.role.totalUsageNext5,
    shift: (p) => p.role.injuryMinutesShift,
    bigger: (p) => p.role.biggerRoleGames,
    games: (p) => p.next5.expectedGames,
    week: (p) => p.expectedGamesThisWeek,
    ...Object.fromEntries(
      STAT_SORTS.map((stat) => [stat, (p: OutlookPlayer) => p.next5.stats[stat]])
    ),
    fgPct: (p) => p.next5.fgPct,
    ftPct: (p) => p.next5.ftPct,
    opp: (p) => p.next5.oppDefence,
  },
  ROS: {
    min: (p) => p.restOfSeason.minutes,
    shift: (p) => p.restOfSeason.teammateShift,
    games: (p) => p.restOfSeason.expectedGames,
    left: (p) => p.restOfSeason.teamGamesLeft,
    ...Object.fromEntries(
      STAT_SORTS.map((stat) => [stat, (p: OutlookPlayer) => p.restOfSeason.stats[stat]])
    ),
    fgPct: (p) => p.restOfSeason.fgPct,
    ftPct: (p) => p.restOfSeason.ftPct,
  },
};

/** The sheet's order for the next 5; the rest of season leads with its minutes. */
export const DEFAULT_SORT: Record<OutlookTableView, string> = { NEXT5: 'usage', ROS: 'min' };

const SHOW_PARAMS: Record<string, OutlookShow> = {
  mine: 'MINE',
  opponent: 'OPPONENT',
  fa: 'FREE_AGENTS',
  rostered: 'ROSTERED',
  all: 'ALL',
};

/** Names sort A→Z first; everything else most first. */
export const defaultDescending = (sort: string) => sort !== 'name';

export function parseOutlookQuery(params: SearchParams): OutlookQuery {
  const view: OutlookTableView = firstParam(params, 'view') === 'ros' ? 'ROS' : 'NEXT5';
  const sortParam = firstParam(params, 'sort') ?? '';
  const sort =
    sortParam === 'name' || Object.hasOwn(SORTS[view], sortParam) ? sortParam : DEFAULT_SORT[view];
  const dir = firstParam(params, 'dir');
  return {
    view,
    show: SHOW_PARAMS[firstParam(params, 'show') ?? ''] ?? 'RELEVANT',
    sort,
    descending: dir === 'asc' ? false : dir === 'desc' ? true : defaultDescending(sort),
  };
}

const SHOWN: Record<OutlookShow, (player: OutlookPlayer) => boolean> = {
  RELEVANT: (player) => player.relevant,
  MINE: (player) => player.owner.kind === 'MINE',
  OPPONENT: (player) => player.owner.kind === 'OPPONENT',
  FREE_AGENTS: (player) => player.owner.kind === 'FREE_AGENT',
  ROSTERED: (player) => player.owner.kind !== 'FREE_AGENT',
  ALL: () => true,
};

/** The table's rows; ties keep the season order (the sort is stable). */
export function selectOutlookPlayers(
  players: readonly OutlookPlayer[],
  query: OutlookQuery
): OutlookPlayer[] {
  const direction = query.descending ? -1 : 1;
  const value = SORTS[query.view][query.sort];
  return players
    .filter(SHOWN[query.show])
    .sort(
      (a, b) => direction * (value ? value(a) - value(b) : a.fullName.localeCompare(b.fullName))
    );
}

export interface OutlookPanels {
  /** Minutes next 5 vs last 5: the 10 biggest rises and the 10 biggest falls. */
  gaining: OutlookPlayer[];
  losing: OutlookPlayer[];
  /** Injury minutes shift, the 15 largest either way. */
  injuryShifts: OutlookPlayer[];
  /** Projected points next 5 minus his season average, the 15 largest either way. */
  pointsVsAverage: OutlookPlayer[];
}

/** Largest first by `value`; ties keep the season order. */
const top = (players: OutlookPlayer[], value: SortValue, count: number) =>
  [...players].sort((a, b) => value(b) - value(a)).slice(0, count);

/**
 * The sheet's 'Role Model Charts' as ranked lists, over every player: players expected to miss
 * most of the next 5 (under 1 expected game) are left out, and the minutes and points lists need
 * 15+ minutes a game over the last 5.
 */
export function outlookPanels(players: readonly OutlookPlayer[]): OutlookPanels {
  const playing = players.filter((p) => p.next5.expectedGames >= 1);
  const regulars = playing.filter((p) => p.role.minutesLast5 >= 15);
  return {
    gaining: top(regulars, (p) => p.role.minutesChange, 10).filter((p) => p.role.minutesChange > 0),
    losing: top(regulars, (p) => -p.role.minutesChange, 10).filter((p) => p.role.minutesChange < 0),
    injuryShifts: top(
      playing.filter((p) => Math.abs(p.role.injuryMinutesShift) >= 0.5),
      (p) => Math.abs(p.role.injuryMinutesShift),
      15
    ),
    pointsVsAverage: top(regulars, (p) => Math.abs(p.next5.vsSeason.pts), 15),
  };
}
