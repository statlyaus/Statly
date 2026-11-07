/**
 * The Rotation page's player-table view state, read from URL search params, and the filter and
 * sort it applies. Pure and isomorphic.
 */

import { isRoleUp, type AlertLevel } from '@/lib/basketball/rotation';
import type { RotationPlayerView } from '@/server/basketball/readModels/rotationModel';

import { firstParam, type SearchParams } from '../analysis/searchParams';

export type RotationShow = 'ALL' | 'MINE' | 'FREE_AGENTS' | 'RISING';
export type RotationSortKey = 'alert' | 'name' | 'gp' | 'gs' | 'starts' | 'dnp' | 'mpg';

export const ROTATION_PAGE_SIZE = 100;

export interface RotationQuery {
  show: RotationShow;
  team: string | null;
  sort: RotationSortKey;
  descending: boolean;
  limit: number;
}

const SHOW_PARAMS: Record<string, RotationShow> = {
  mine: 'MINE',
  fa: 'FREE_AGENTS',
  rising: 'RISING',
};

const SHOWN: Record<RotationShow, (player: RotationPlayerView) => boolean> = {
  ALL: () => true,
  MINE: (player) => player.owner.kind === 'MINE',
  FREE_AGENTS: (player) => player.owner.kind === 'FREE_AGENT',
  /** The page's "Free agents moving up". */
  RISING: (player) => player.owner.kind === 'FREE_AGENT' && isRoleUp(player.alert),
};
const SORTS: readonly RotationSortKey[] = ['alert', 'name', 'gp', 'gs', 'starts', 'dnp', 'mpg'];
const LEVEL_RANK: Record<AlertLevel, number> = { RED: 3, AMBER: 2, GREEN: 1 };

/** Names sort A→Z first; everything else most first. */
export function defaultDescending(sort: RotationSortKey): boolean {
  return sort !== 'name';
}

export function parseRotationQuery(
  params: SearchParams,
  teamCodes: readonly string[]
): RotationQuery {
  const sortParam = firstParam(params, 'sort') as RotationSortKey | undefined;
  const sort = sortParam && SORTS.includes(sortParam) ? sortParam : 'alert';
  const dir = firstParam(params, 'dir');
  const team = firstParam(params, 'team');
  const limit = Number(firstParam(params, 'limit'));
  return {
    show: SHOW_PARAMS[firstParam(params, 'show') ?? ''] ?? 'ALL',
    team: team && teamCodes.includes(team) ? team : null,
    sort,
    descending: dir === 'asc' ? false : dir === 'desc' ? true : defaultDescending(sort),
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : ROTATION_PAGE_SIZE,
  };
}

const SORT_VALUE: Record<
  Exclude<RotationSortKey, 'name' | 'alert'>,
  (p: RotationPlayerView) => number
> = {
  gp: (player) => player.gamesPlayed,
  gs: (player) => player.gamesStarted,
  starts: (player) => player.startsLast5,
  dnp: (player) => player.coachDnpsLast10,
  mpg: (player) => player.minutesPerGame,
};

function compare(a: RotationPlayerView, b: RotationPlayerView, sort: RotationSortKey): number {
  if (sort === 'name') return a.fullName.localeCompare(b.fullName);
  if (sort === 'alert') {
    const level = (player: RotationPlayerView) =>
      player.alert ? LEVEL_RANK[player.alert.level] : 0;
    return level(a) - level(b) || a.minutesPerGame - b.minutesPerGame;
  }
  return SORT_VALUE[sort](a) - SORT_VALUE[sort](b);
}

export function selectRotationPlayers(
  players: readonly RotationPlayerView[],
  query: RotationQuery
): RotationPlayerView[] {
  const direction = query.descending ? -1 : 1;
  return players
    .filter(
      (player) =>
        SHOWN[query.show](player) && (query.team === null || player.teamCode === query.team)
    )
    .sort((a, b) => direction * compare(a, b, query.sort) || a.fullName.localeCompare(b.fullName));
}
