/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Wide data tables need a named keyboard-scroll target. */

import { ArrowDownRight, ArrowUpRight, CircleHelp, Minus } from 'lucide-react';

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
    <section
      aria-labelledby="trade-comparison-heading"
      className="overflow-hidden rounded-xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)]"
    >
      <div className="border-b border-[color:var(--trade-border)] bg-[color:var(--trade-action-soft)] px-4 py-3">
        <h4
          id="trade-comparison-heading"
          className="text-sm font-bold text-[color:var(--trade-text)]"
        >
          Package comparison
        </h4>
        <p className="mt-0.5 text-xs leading-4 text-[color:var(--trade-text-muted)]">
          Season {playerStats.context.season} average per selected player, per game. This is not a
          category total or a fairness score.
        </p>
      </div>
      {/* A focus target is required so keyboard users can scroll the wide comparison table. */}
      <div
        tabIndex={0}
        aria-label="Trade package comparison, horizontally scrollable"
        className="overflow-x-auto focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[color:var(--trade-focus)]"
      >
        <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Average category comparison for the selected trade packages.
          </caption>
          <thead className="bg-[color:var(--trade-surface-subtle)] text-xs text-[color:var(--trade-text-muted)]">
            <tr className="h-11 border-b border-[color:var(--trade-border-strong)]">
              <th scope="col" className="px-4 py-2 font-bold">
                Category
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                You send
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                You receive
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                Difference
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((comparison) => (
              <tr
                key={comparison.column.key}
                className="h-12 border-b border-[color:var(--trade-border)] last:border-0 hover:bg-[color:var(--trade-surface-subtle)]"
              >
                <th
                  scope="row"
                  className="px-4 py-2 text-sm font-semibold text-[color:var(--trade-text)]"
                >
                  {comparison.column.label}
                  <span className="ml-1 block text-xs font-normal text-[color:var(--trade-text-muted)] sm:inline">
                    ({comparison.column.direction === 'LOW_WINS' ? 'lower' : 'higher'} is better)
                  </span>
                </th>
                <td className="px-3 py-2 text-right text-[13px] font-medium tabular-nums text-[color:var(--trade-text)]">
                  {formatComparisonValue(comparison.sendingAverage, comparison.column.key)}
                </td>
                <td className="px-3 py-2 text-right text-[13px] font-medium tabular-nums text-[color:var(--trade-text)]">
                  {formatComparisonValue(comparison.receivingAverage, comparison.column.key)}
                </td>
                <td className="px-3 py-2 text-right text-[13px] font-bold tabular-nums text-[color:var(--trade-text)]">
                  {formatSignedValue(comparison.favourableDifference, comparison.column.key)}
                </td>
                <td className="px-4 py-2">
                  <OutcomeLabel outcome={comparison.outcome} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OutcomeLabel({
  outcome,
}: {
  outcome: ReturnType<typeof compareTradeSelections>[number]['outcome'];
}): React.JSX.Element {
  if (outcome === 'favourable') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-[color:var(--trade-positive)]/25 bg-[color:var(--trade-positive)]/8 px-2 py-1 text-xs font-bold text-[color:var(--trade-positive)]">
        <ArrowUpRight aria-hidden="true" className="size-3.5" />
        Favourable
      </span>
    );
  }
  if (outcome === 'unfavourable') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-[color:var(--trade-negative)]/25 bg-[color:var(--trade-error-soft)] px-2 py-1 text-xs font-bold text-[color:var(--trade-negative)]">
        <ArrowDownRight aria-hidden="true" className="size-3.5" />
        Unfavourable
      </span>
    );
  }
  if (outcome === 'even') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface-subtle)] px-2 py-1 text-xs font-bold text-[color:var(--trade-text-muted)]">
        <Minus aria-hidden="true" className="size-3.5" />
        Even
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] px-2 py-1 text-xs font-bold text-[color:var(--trade-text-muted)]">
      <CircleHelp aria-hidden="true" className="size-3.5" />
      Unavailable
    </span>
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
