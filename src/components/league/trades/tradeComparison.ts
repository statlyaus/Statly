import type {
  LeagueCategoryColumnDto,
  LeaguePlayerStatDatasetDto,
} from '@/types/leaguePlayerStats';

export type TradeComparisonOutcome = 'favourable' | 'unfavourable' | 'even' | 'unavailable';

export interface TradeCategoryComparison {
  column: LeagueCategoryColumnDto;
  sendingAverage: number | null;
  receivingAverage: number | null;
  favourableDifference: number | null;
  outcome: TradeComparisonOutcome;
}

function averageSelected(
  playerIds: readonly string[],
  category: LeagueCategoryColumnDto['key'],
  dataset: LeaguePlayerStatDatasetDto
): number | null {
  if (playerIds.length === 0) return null;
  const values = playerIds.map((playerId) => dataset.playersById[playerId]?.values[category]);
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null;
  return (values as number[]).reduce((sum, value) => sum + value, 0) / values.length;
}

export function compareTradeSelections(
  sendingPlayerIds: readonly string[],
  receivingPlayerIds: readonly string[],
  dataset: LeaguePlayerStatDatasetDto
): TradeCategoryComparison[] {
  return dataset.columns.map((column) => {
    const sendingAverage = averageSelected(sendingPlayerIds, column.key, dataset);
    const receivingAverage = averageSelected(receivingPlayerIds, column.key, dataset);
    if (sendingAverage === null || receivingAverage === null) {
      return {
        column,
        sendingAverage,
        receivingAverage,
        favourableDifference: null,
        outcome: 'unavailable',
      };
    }

    const favourableDifference =
      column.direction === 'LOW_WINS'
        ? sendingAverage - receivingAverage
        : receivingAverage - sendingAverage;
    const outcome =
      Math.abs(favourableDifference) < 0.000001
        ? 'even'
        : favourableDifference > 0
          ? 'favourable'
          : 'unfavourable';

    return { column, sendingAverage, receivingAverage, favourableDifference, outcome };
  });
}
