import type { TradePlayerDto } from '@/server/leagues/trades/tradeContracts';
import { FANTASY_CATEGORIES, formatStatValue } from '@/types/fantasyCategories';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import {
  compareTradeSelections,
  summarizeTradeComparisons,
  type TradeCategoryComparison,
} from './tradeComparison';

export type TradeVerdictTone = 'good' | 'bad' | 'even' | 'unknown';

export interface TradeVerdict {
  tone: TradeVerdictTone;
  /** One line for the whole trade, from the viewer's side: "You win 5 of 9 categories". */
  headline: string;
  /** Short form for pills and trays: "5 of 9 for you". */
  short: string;
  gained: number;
  lost: number;
  even: number;
  counted: number;
  comparisons: TradeCategoryComparison[];
}

/** The trade's verdict across every league category, per game, from the receiving side. */
export function buildTradeVerdict(
  sendingPlayerIds: readonly string[],
  receivingPlayerIds: readonly string[],
  dataset: LeaguePlayerStatDatasetDto
): TradeVerdict {
  if (sendingPlayerIds.length === 0 || receivingPlayerIds.length === 0) {
    return {
      tone: 'unknown',
      headline: 'Pick from both teams',
      short: 'No verdict',
      gained: 0,
      lost: 0,
      even: 0,
      counted: 0,
      comparisons: [],
    };
  }
  const comparisons = compareTradeSelections(sendingPlayerIds, receivingPlayerIds, dataset);
  const { gained, lost, even } = summarizeTradeComparisons(comparisons);
  const counted = gained + lost + even;
  const base = { gained, lost, even, counted, comparisons };
  if (counted === 0) {
    return { ...base, tone: 'unknown', headline: 'No stats yet', short: 'No stats' };
  }
  if (gained > lost) {
    return {
      ...base,
      tone: 'good',
      headline: `You win ${gained} of ${counted} categories`,
      short: `Wins ${gained} of ${counted}`,
    };
  }
  if (lost > gained) {
    return {
      ...base,
      tone: 'bad',
      headline: `You lose ${lost} of ${counted} categories`,
      short: `Loses ${lost} of ${counted}`,
    };
  }
  return {
    ...base,
    tone: 'even',
    headline: `Categories split ${gained}–${lost}`,
    short: 'Even',
  };
}

export interface StandoutStat {
  label: string;
  shortLabel: string;
  formatted: string;
}

const averagesCache = new WeakMap<LeaguePlayerStatDatasetDto, Map<string, number>>();

function columnAverages(dataset: LeaguePlayerStatDatasetDto): Map<string, number> {
  const cached = averagesCache.get(dataset);
  if (cached) return cached;
  const averages = new Map<string, number>();
  const lines = Object.values(dataset.playersById);
  for (const column of dataset.columns) {
    const values = lines
      .map((line) => line.values[column.key])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (values.length > 0) {
      averages.set(column.key, values.reduce((sum, value) => sum + value, 0) / values.length);
    }
  }
  averagesCache.set(dataset, averages);
  return averages;
}

/** The category where a player stands furthest above the league's average. */
export function standoutStat(
  playerId: string,
  dataset: LeaguePlayerStatDatasetDto
): StandoutStat | null {
  const line = dataset.playersById[playerId];
  if (!line) return null;
  const averages = columnAverages(dataset);
  let best: {
    ratio: number;
    column: LeaguePlayerStatDatasetDto['columns'][number];
    value: number;
  } | null = null;
  for (const column of dataset.columns) {
    const value = line.values[column.key];
    const average = averages.get(column.key);
    if (typeof value !== 'number' || !Number.isFinite(value) || !average || average <= 0) continue;
    const ratio =
      column.direction === 'LOW_WINS' ? (value > 0 ? average / value : 0) : value / average;
    if (!best || ratio > best.ratio) best = { ratio, column, value };
  }
  if (!best || best.ratio <= 0) return null;
  const category = FANTASY_CATEGORIES[best.column.key];
  return {
    label: best.column.label,
    shortLabel: best.column.shortLabel,
    formatted: category ? formatStatValue(best.value, category) : String(best.value),
  };
}

export interface SquadPositionChange {
  position: string;
  before: number;
  after: number;
}

const POSITION_ORDER = ['DEF', 'MID', 'RUC', 'FWD'];

function eligibleCounts(players: readonly Pick<TradePlayerDto, 'position'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const player of players) {
    for (const position of player.position.split('/').map((part) => part.trim().toUpperCase())) {
      if (position) counts.set(position, (counts.get(position) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Players able to play each position before and after the trade. Dual-position players count for
 * both. Only positions that change are returned, in DEF, MID, RUC, FWD order.
 */
export function squadPositionImpact(
  squad: readonly Pick<TradePlayerDto, 'id' | 'position'>[],
  sending: readonly Pick<TradePlayerDto, 'id' | 'position'>[],
  receiving: readonly Pick<TradePlayerDto, 'id' | 'position'>[]
): SquadPositionChange[] {
  const leaving = new Set(sending.map((player) => player.id));
  const before = eligibleCounts(squad);
  const after = eligibleCounts([
    ...squad.filter((player) => !leaving.has(player.id)),
    ...receiving,
  ]);
  const positions = [...new Set([...before.keys(), ...after.keys()])].sort(
    (left, right) =>
      (POSITION_ORDER.indexOf(left) + 1 || 99) - (POSITION_ORDER.indexOf(right) + 1 || 99) ||
      left.localeCompare(right)
  );
  return positions
    .map((position) => ({
      position,
      before: before.get(position) ?? 0,
      after: after.get(position) ?? 0,
    }))
    .filter((change) => change.before !== change.after);
}
