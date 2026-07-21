/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Wide data tables need a named keyboard-scroll target. */

import { FANTASY_CATEGORIES, formatStatValue } from '@/types/fantasyCategories';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { compareTradeSelections } from './tradeComparison';

interface TradeComparisonTableProps {
  sendingPlayerIds: string[];
  receivingPlayerIds: string[];
  playerStats: LeaguePlayerStatDatasetDto;
}

export function TradeComparisonTable({
  sendingPlayerIds,
  receivingPlayerIds,
  playerStats,
}: TradeComparisonTableProps): React.JSX.Element | null {
  if (sendingPlayerIds.length === 0 && receivingPlayerIds.length === 0) return null;
  const comparisons = compareTradeSelections(sendingPlayerIds, receivingPlayerIds, playerStats);

  return (
    <section aria-labelledby="trade-comparison-heading" className="rounded-lg border border-border">
      <div className="border-b border-border bg-muted/20 p-3">
        <h4 id="trade-comparison-heading" className="text-sm font-semibold text-foreground">
          Package comparison
        </h4>
        <p className="text-xs text-muted-foreground">
          Season {playerStats.context.season} average per selected player, per game. This is not a
          category total or a fairness score.
        </p>
      </div>
      {/* A focus target is required so keyboard users can scroll the wide comparison table. */}
      <div
        tabIndex={0}
        aria-label="Trade package comparison, horizontally scrollable"
        className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <table className="w-full min-w-[42rem] text-left text-sm">
          <caption className="sr-only">
            Average category comparison for the selected trade packages.
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="px-3 py-2">
                Category
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                You send
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                You receive
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Difference
              </th>
              <th scope="col" className="px-3 py-2">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((comparison) => (
              <tr key={comparison.column.key} className="border-b border-border last:border-0">
                <th scope="row" className="px-3 py-2 font-medium text-foreground">
                  {comparison.column.label}
                  <span className="ml-1 block text-xs font-normal text-muted-foreground sm:inline">
                    ({comparison.column.direction === 'LOW_WINS' ? 'lower' : 'higher'} is better)
                  </span>
                </th>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatComparisonValue(comparison.sendingAverage, comparison.column.key)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatComparisonValue(comparison.receivingAverage, comparison.column.key)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatSignedValue(comparison.favourableDifference, comparison.column.key)}
                </td>
                <td className="px-3 py-2 font-medium text-foreground">
                  {comparison.outcome === 'unavailable'
                    ? 'Unavailable'
                    : comparison.outcome === 'favourable'
                      ? 'Favourable'
                      : comparison.outcome === 'unfavourable'
                        ? 'Unfavourable'
                        : 'Even'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatComparisonValue(
  value: number | null,
  category: keyof typeof FANTASY_CATEGORIES
): string {
  return formatStatValue(value, FANTASY_CATEGORIES[category]);
}

function formatSignedValue(
  value: number | null,
  category: keyof typeof FANTASY_CATEGORIES
): string {
  if (value === null) return '—';
  const formatted = formatComparisonValue(Math.abs(value), category);
  if (value === 0) return formatted;
  return `${value > 0 ? '+' : '−'}${formatted}`;
}
