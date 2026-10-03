/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Wide data tables need a named keyboard-scroll target. */

import { AlertTriangle } from 'lucide-react';
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
        className="rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] p-4"
      >
        <Heading id={headingId} className="text-base font-bold text-[color:var(--trade-text)]">
          Category comparison
        </Heading>
        <p className="mt-1 text-sm text-[color:var(--trade-text-muted)]">
          Pick from both teams to compare.
        </p>
      </section>
    );
  }

  const comparisons = compareTradeSelections(sendingPlayerIds, receivingPlayerIds, playerStats);
  const summary = summarizeTradeComparisons(comparisons);
  const unavailableSummary = summary.unavailable > 0 ? ` · ${summary.unavailable} no data` : '';
  const isHistorical = playerStats.context.season !== new Date().getFullYear();
  const sendingSample = formatPackageSample(sendingPlayerIds, playerStats);
  const receivingSample = formatPackageSample(receivingPlayerIds, playerStats);

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)]"
    >
      <div className="border-b border-[color:var(--trade-border)] px-4 py-3">
        <Heading id={headingId} className="text-base font-bold text-[color:var(--trade-text)]">
          Category comparison
        </Heading>
        <p className="mt-0.5 text-sm text-[color:var(--trade-text)]">
          For {sendingTeamName}: {summary.gained} up · {summary.lost} down · {summary.even} level
          {unavailableSummary}
        </p>
        {isHistorical && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-[color:var(--trade-warning)]">
            <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
            Based on {playerStats.context.season} stats, not this season.
          </p>
        )}
      </div>

      {/* A focus target is required so keyboard users can scroll the wide comparison table. */}
      <div
        tabIndex={0}
        aria-label="Category comparison, horizontally scrollable"
        className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--trade-focus)]"
      >
        <table className="w-full border-collapse text-left text-sm sm:min-w-[36rem]">
          <caption className="sr-only">
            Per-game category comparison of the players {sendingTeamName} and {receivingTeamName}
            each give up.
          </caption>
          <thead className="bg-[color:var(--trade-surface-subtle)] text-xs text-[color:var(--trade-text-muted)]">
            <tr className="h-10 border-b border-[color:var(--trade-border)]">
              <th scope="col" className="px-3 py-2 font-semibold sm:px-4">
                Category
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold sm:px-3">
                {sendingTeamName}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold sm:px-3">
                {receivingTeamName}
              </th>
              <th scope="col" className="px-3 py-2 font-semibold sm:px-4">
                Gap
              </th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((comparison) => {
              const direction = comparison.column.direction === 'LOW_WINS' ? 'lower' : 'higher';

              return (
                <tr
                  key={comparison.column.key}
                  className="h-11 border-b border-[color:var(--trade-border)] last:border-0"
                >
                  <th
                    scope="row"
                    className="px-3 py-2 text-sm font-semibold text-[color:var(--trade-text)] sm:px-4"
                  >
                    <abbr
                      title={`${comparison.column.label}, ${direction} is better`}
                      aria-label={`${comparison.column.label}, ${direction} is better`}
                      className="no-underline"
                    >
                      {comparison.column.label}
                    </abbr>
                  </th>
                  <td className="px-2 py-2 text-right text-sm tabular-nums text-[color:var(--trade-text)] sm:px-3">
                    {formatComparisonValue(comparison.sendingAverage, comparison.column.key)}
                  </td>
                  <td className="px-2 py-2 text-right text-sm tabular-nums text-[color:var(--trade-text)] sm:px-3">
                    {formatComparisonValue(comparison.receivingAverage, comparison.column.key)}
                  </td>
                  <td className="px-3 py-2 sm:px-4">
                    <PackageDifferenceLabel
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

      <p className="border-t border-[color:var(--trade-border)] px-4 py-2.5 text-xs leading-5 text-[color:var(--trade-text-muted)]">
        Per-game averages per player, {playerStats.context.season} season. {sendingTeamName}:{' '}
        {sendingSample}. {receivingTeamName}: {receivingSample}. For low-is-better categories a drop
        counts as up.
      </p>
    </section>
  );
}

const OUTCOME_STYLE: Record<
  ReturnType<typeof compareTradeSelections>[number]['outcome'],
  { valueClassName: string; label: string }
> = {
  favourable: {
    valueClassName: 'font-bold text-[color:var(--trade-positive)]',
    label: 'Up',
  },
  unfavourable: {
    valueClassName: 'font-bold text-[color:var(--trade-negative)]',
    label: 'Down',
  },
  even: { valueClassName: 'font-semibold text-[color:var(--trade-text)]', label: 'Level' },
  unavailable: {
    valueClassName: 'font-semibold text-[color:var(--trade-text-muted)]',
    label: 'No data',
  },
};

/** Signed value in the result colour, then the plain-language outcome; colour is never the only signal. */
function PackageDifferenceLabel({
  outcome,
  value,
}: {
  outcome: ReturnType<typeof compareTradeSelections>[number]['outcome'];
  value: string;
}): React.JSX.Element {
  const style = OUTCOME_STYLE[outcome];
  return (
    <span className="inline-flex items-baseline gap-2 text-sm">
      <span className={`min-w-10 tabular-nums ${style.valueClassName}`}>{value}</span>
      <span className="sr-only text-[color:var(--trade-text-muted)] sm:not-sr-only">
        {style.label}
      </span>
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

function formatPackageSample(playerIds: string[], playerStats: LeaguePlayerStatDatasetDto): string {
  const gamesPlayed = playerIds
    .map((playerId) => playerStats.playersById[playerId]?.gamesPlayed)
    .filter((value): value is number => typeof value === 'number');
  const playerLabel = `${playerIds.length} ${playerIds.length === 1 ? 'player' : 'players'}`;
  if (gamesPlayed.length !== playerIds.length) return `${playerLabel} · games unknown`;

  const minimum = Math.min(...gamesPlayed);
  const maximum = Math.max(...gamesPlayed);
  const gamesLabel = minimum === maximum ? `${minimum} GP each` : `${minimum}–${maximum} GP`;
  return `${playerLabel} · ${gamesLabel}`;
}
