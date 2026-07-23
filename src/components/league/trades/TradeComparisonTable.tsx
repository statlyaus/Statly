/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Wide data tables need a named keyboard-scroll target. */

import { ArrowDownRight, ArrowUpRight, CircleHelp, Minus } from 'lucide-react';
import { useId } from 'react';

import { FANTASY_CATEGORIES, formatStatValue } from '@/types/fantasyCategories';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { compareTradeSelections, summarizeTradeComparisons } from './tradeComparison';

interface TradeComparisonTableProps {
  sendingTeamName: string;
  receivingTeamName: string;
  sendingPlayerIds: string[];
  receivingPlayerIds: string[];
  playerStats: LeaguePlayerStatDatasetDto;
  headingLevel?: 4 | 5;
}

export function TradeComparisonTable({
  sendingTeamName,
  receivingTeamName,
  sendingPlayerIds,
  receivingPlayerIds,
  playerStats,
  headingLevel = 4,
}: TradeComparisonTableProps): React.JSX.Element {
  const headingId = useId();
  const Heading = headingLevel === 5 ? 'h5' : 'h4';
  const selectionComplete = sendingPlayerIds.length > 0 && receivingPlayerIds.length > 0;

  if (!selectionComplete) {
    return (
      <section
        aria-labelledby={headingId}
        className="rounded-xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] p-4"
      >
        <Heading id={headingId} className="text-base font-bold text-[color:var(--trade-text)]">
          Package comparison
        </Heading>
        <p className="mt-1 text-sm text-[color:var(--trade-text-muted)]">
          Select players from both teams to compare
        </p>
      </section>
    );
  }

  const comparisons = compareTradeSelections(sendingPlayerIds, receivingPlayerIds, playerStats);
  const summary = summarizeTradeComparisons(comparisons);
  const unavailableSummary = summary.unavailable > 0 ? ` · ${summary.unavailable} unavailable` : '';

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)]"
    >
      <div className="border-b border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface-dark)] px-4 py-3 text-white">
        <Heading id={headingId} className="text-base font-bold">
          Package comparison
        </Heading>
        <p className="mt-1 text-xs font-semibold leading-4">
          Category impact: {summary.gained} gained · {summary.lost} lost · {summary.even} even
          {unavailableSummary}
        </p>
        <p className="mt-1 text-xs leading-4 text-white/70">
          Season {playerStats.context.season} average per selected player, per game. Not category
          totals or projected lineup impact.
        </p>
      </div>

      <p className="border-b border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] px-4 py-2 text-xs leading-4 text-[color:var(--trade-text-muted)]">
        Higher- and lower-is-better categories are normalized. Positive impact means the receiving
        package is better after category direction is normalized.
      </p>

      {/* A focus target is required so keyboard users can scroll the wide comparison table. */}
      <div
        tabIndex={0}
        aria-label="Trade package comparison, horizontally scrollable"
        className="overflow-x-auto focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[color:var(--trade-focus)]"
      >
        <table className="w-full min-w-[38rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Average category comparison between {sendingTeamName} and {receivingTeamName} for the
            selected trade packages.
          </caption>
          <thead className="bg-[color:var(--trade-surface-dark)] text-xs text-white">
            <tr className="h-11 border-b border-[color:var(--trade-border-strong)]">
              <th scope="col" className="px-4 py-2 font-bold">
                Category
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                {sendingTeamName}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                {receivingTeamName}
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Impact
              </th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((comparison) => {
              const direction = comparison.column.direction === 'LOW_WINS' ? 'lower' : 'higher';

              return (
                <tr
                  key={comparison.column.key}
                  className="h-12 border-b border-[color:var(--trade-border)] last:border-0 hover:bg-[color:var(--trade-surface-subtle)]"
                >
                  <th
                    scope="row"
                    className="px-4 py-2 text-sm font-semibold text-[color:var(--trade-text)]"
                  >
                    <abbr
                      title={`${comparison.column.label}, ${direction} is better`}
                      aria-label={`${comparison.column.label}, ${direction} is better`}
                      className="no-underline"
                    >
                      {comparison.column.label}
                    </abbr>
                  </th>
                  <td className="px-3 py-2 text-right text-sm font-medium tabular-nums text-[color:var(--trade-text)]">
                    {formatComparisonValue(comparison.sendingAverage, comparison.column.key)}
                  </td>
                  <td className="px-3 py-2 text-right text-sm font-medium tabular-nums text-[color:var(--trade-text)]">
                    {formatComparisonValue(comparison.receivingAverage, comparison.column.key)}
                  </td>
                  <td className="px-4 py-2">
                    <ImpactLabel
                      outcome={comparison.outcome}
                      value={formatImpactValue(
                        comparison.favourableDifference,
                        comparison.column.key,
                        comparison.outcome
                      )}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ImpactLabel({
  outcome,
  value,
}: {
  outcome: ReturnType<typeof compareTradeSelections>[number]['outcome'];
  value: string;
}): React.JSX.Element {
  if (outcome === 'favourable') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--trade-positive)]/25 bg-[color:var(--trade-positive)]/8 px-2 py-1 text-sm font-bold text-[color:var(--trade-positive)]">
        <ArrowUpRight aria-hidden="true" className="size-3.5" />
        <span className="tabular-nums">{value}</span>
        <span>Gained</span>
      </span>
    );
  }

  if (outcome === 'unfavourable') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--trade-negative)]/25 bg-[color:var(--trade-negative-soft)] px-2 py-1 text-sm font-bold text-[color:var(--trade-negative)]">
        <ArrowDownRight aria-hidden="true" className="size-3.5" />
        <span className="tabular-nums">{value}</span>
        <span>Lost</span>
      </span>
    );
  }

  if (outcome === 'even') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface-subtle)] px-2 py-1 text-sm font-bold text-[color:var(--trade-text-muted)]">
        <Minus aria-hidden="true" className="size-3.5" />
        <span className="tabular-nums">{value}</span>
        <span>Even</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] px-2 py-1 text-sm font-bold text-[color:var(--trade-text-muted)]">
      <CircleHelp aria-hidden="true" className="size-3.5" />
      <span className="tabular-nums">{value}</span>
      <span>Unavailable</span>
    </span>
  );
}

function formatComparisonValue(
  value: number | null,
  category: keyof typeof FANTASY_CATEGORIES
): string {
  return formatStatValue(value, FANTASY_CATEGORIES[category]);
}

function formatImpactValue(
  value: number | null,
  category: keyof typeof FANTASY_CATEGORIES,
  outcome: ReturnType<typeof compareTradeSelections>[number]['outcome']
): string {
  if (value === null || outcome === 'unavailable') return '—';
  if (outcome === 'even') return formatComparisonValue(0, category);

  const magnitude = Math.abs(value);
  const normallyFormatted = formatComparisonValue(magnitude, category);
  const formattedMagnitude =
    Number.parseFloat(normallyFormatted) === 0
      ? formatSmallMagnitude(magnitude, category)
      : normallyFormatted;
  return `${outcome === 'favourable' ? '+' : '−'}${formattedMagnitude}`;
}

function formatSmallMagnitude(value: number, category: keyof typeof FANTASY_CATEGORIES): string {
  const decimalPlaces = Math.min(8, Math.max(3, Math.ceil(-Math.log10(value)) + 2));
  const formatted = value.toFixed(decimalPlaces).replace(/0+$/, '').replace(/\.$/, '');
  return FANTASY_CATEGORIES[category].format === 'percentage' ? `${formatted}%` : formatted;
}
