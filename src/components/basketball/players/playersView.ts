/**
 * The Players page's view state, read from URL search params, and the filter and sort it applies
 * to the player pool. Pure and isomorphic.
 */

import { eligibleSlots } from '@/lib/basketball/lineupSimulator';
import type { PoolPlayer } from '@/server/basketball/readModels/playerPool';
import { isBasketballCategoryId, type BasketballCategoryId } from '@/types/basketball';

import { firstParam, type SearchParams } from '../analysis/searchParams';

export type PlayerSortKey =
  'value' | 'name' | 'gp' | 'mpg' | 'auction' | 'gamesLeft' | BasketballCategoryId;

export const PLAYER_POSITIONS = ['G', 'F', 'C'] as const;
export type PlayerPosition = (typeof PLAYER_POSITIONS)[number];
export const PLAYER_PAGE_SIZE = 100;
export const MINUTE_FLOORS = [0, 10, 15, 20, 25, 30] as const;

export interface PlayersQuery {
  freeAgentsOnly: boolean;
  position: PlayerPosition | null;
  minMinutes: number;
  search: string;
  sort: PlayerSortKey;
  descending: boolean;
  limit: number;
  /** A punt what-if; null uses the league's punts. */
  punts: BasketballCategoryId[] | null;
}

const PLAIN_SORTS: readonly PlayerSortKey[] = [
  'value',
  'name',
  'gp',
  'mpg',
  'auction',
  'gamesLeft',
];

/** Names sort A→Z first; every number sorts highest first. */
export function defaultDescending(sort: PlayerSortKey): boolean {
  return sort !== 'name';
}

export function parsePlayersQuery(
  params: SearchParams,
  categories: readonly BasketballCategoryId[]
): PlayersQuery {
  const sortParam = firstParam(params, 'sort');
  const sort: PlayerSortKey =
    sortParam &&
    (PLAIN_SORTS.includes(sortParam as PlayerSortKey) ||
      (isBasketballCategoryId(sortParam) && categories.includes(sortParam)))
      ? (sortParam as PlayerSortKey)
      : 'value';
  const dir = firstParam(params, 'dir');
  const position = firstParam(params, 'pos');
  const minutes = Number(firstParam(params, 'mpg'));
  const limit = Number(firstParam(params, 'limit'));

  const puntsParam = firstParam(params, 'punts');
  let punts: BasketballCategoryId[] | null = null;
  if (puntsParam !== undefined) {
    const wanted =
      puntsParam === 'none'
        ? []
        : categories.filter((category) => puntsParam.split(',').includes(category));
    punts = wanted.length < categories.length ? wanted : null;
  }

  return {
    freeAgentsOnly: firstParam(params, 'fa') === '1',
    position: PLAYER_POSITIONS.includes(position as PlayerPosition)
      ? (position as PlayerPosition)
      : null,
    minMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 48) : 0,
    search: (firstParam(params, 'q') ?? '').trim().slice(0, 60),
    sort,
    descending: dir === 'asc' ? false : dir === 'desc' ? true : defaultDescending(sort),
    limit:
      Number.isInteger(limit) && limit > PLAYER_PAGE_SIZE
        ? Math.min(limit, 1000)
        : PLAYER_PAGE_SIZE,
    punts,
  };
}

function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function sortValue(player: PoolPlayer, sort: PlayerSortKey, gamesLeft: number): number {
  switch (sort) {
    case 'value':
      return player.value;
    case 'gp':
      return player.gamesThisSeason;
    case 'mpg':
      return player.minutesPerGame;
    case 'auction':
      return player.auctionDollars ?? 0;
    case 'gamesLeft':
      return gamesLeft;
    case 'name':
      return 0;
    default:
      return player.categoryZ[sort];
  }
}

/** Filtered and sorted (ties by value), not yet limited. */
export function selectPlayers(
  players: readonly PoolPlayer[],
  query: PlayersQuery,
  gamesLeft: (player: PoolPlayer) => number
): PoolPlayer[] {
  const search = normalise(query.search);
  const filtered = players.filter(
    (player) =>
      (!query.freeAgentsOnly || player.owner.kind === 'FREE_AGENT') &&
      (!query.position || eligibleSlots(player.positions).includes(query.position)) &&
      player.minutesPerGame >= query.minMinutes &&
      (!search ||
        normalise(player.fullName).includes(search) ||
        normalise(player.teamCode ?? '').includes(search))
  );
  const direction = query.descending ? -1 : 1;
  return filtered.sort((a, b) => {
    const primary =
      query.sort === 'name'
        ? a.fullName.localeCompare(b.fullName)
        : sortValue(a, query.sort, gamesLeft(a)) - sortValue(b, query.sort, gamesLeft(b));
    return direction * primary || a.rank - b.rank;
  });
}
