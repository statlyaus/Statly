import { ArrowRight } from 'lucide-react';
import { useId } from 'react';

import { resultStyle, type CategoryResult } from '@/components/scores/MatchupScore';
import { FANTASY_CATEGORIES, formatStatValue } from '@/types/fantasyCategories';

import type { SquadPositionChange, TradeVerdict, TradeVerdictTone } from './tradeVerdict';

export const VERDICT_TONE_CLASS: Record<TradeVerdictTone, string> = {
  good: 'text-[color:var(--trade-positive)]',
  bad: 'text-[color:var(--trade-negative)]',
  even: 'text-[color:var(--trade-text)]',
  unknown: 'text-[color:var(--trade-text-muted)]',
};

const TONE_RESULT: Record<TradeVerdictTone, CategoryResult | null> = {
  good: 'won',
  bad: 'lost',
  even: 'drawn',
  unknown: null,
};

/** The verdict line with a W, L or D mark, so the result never depends on colour alone. */
export function TradeVerdictHeadline({
  verdict,
  className = '',
}: {
  verdict: TradeVerdict;
  className?: string;
}): React.JSX.Element {
  const result = TONE_RESULT[verdict.tone];
  const style = result ? resultStyle[result] : null;
  return (
    <p
      className={`flex items-center gap-2 text-sm font-bold ${VERDICT_TONE_CLASS[verdict.tone]} ${className}`}
    >
      {style ? (
        <span
          aria-hidden="true"
          className={`inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-xs ${style.className}`}
        >
          {style.letter}
        </span>
      ) : null}
      <span>{verdict.headline}</span>
    </p>
  );
}

/**
 * The trade category by category: one row per category with a bar that grows from a shared centre
 * line toward whoever it favours, the other team on the left and you on the right.
 */
export function TradeVerdictStrip({
  verdict,
  otherSide,
  youLabel = 'you',
  season,
  headingLevel = 4,
  compact = false,
}: {
  verdict: TradeVerdict;
  /** Who the right side favours; "you" unless a commissioner is looking at someone else's trade. */
  youLabel?: string;
  /** Who the left side of each bar favours. */
  otherSide: string;
  season: number;
  headingLevel?: 4 | 5;
  /** Borderless version for the trade panel, which prints the season basis once at its foot. */
  compact?: boolean;
}): React.JSX.Element {
  const headingId = useId();
  const grid = compact
    ? 'grid-cols-[8.75rem_minmax(0,1fr)_2.75rem]'
    : 'grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_3.5rem] sm:grid-cols-[11rem_minmax(0,1fr)_3.5rem]';
  const inset = compact ? '' : 'px-4';
  const Heading = headingLevel === 5 ? 'h5' : 'h4';
  const rows = verdict.comparisons.filter((comparison) => comparison.outcome !== 'unavailable');
  const rightLabel = youLabel === 'you' ? 'You' : youLabel;

  return (
    <section
      aria-labelledby={headingId}
      className={
        compact
          ? 'min-w-0'
          : 'overflow-hidden rounded-lg border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)]'
      }
    >
      <div
        className={
          compact
            ? 'space-y-1'
            : 'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[color:var(--trade-border)] px-4 py-3'
        }
      >
        <Heading id={headingId} className="text-sm font-semibold text-[color:var(--trade-text)]">
          Verdict
        </Heading>
        <TradeVerdictHeadline verdict={verdict} />
      </div>
      {rows.length > 0 ? (
        <>
          <div
            aria-hidden="true"
            className={`grid ${grid} ${inset} gap-x-2 pb-1 pt-3 text-[0.6875rem] font-medium text-[color:var(--trade-text-muted)]`}
          >
            <span />
            <span className="flex min-w-0 justify-between gap-2">
              <span className="truncate">{otherSide}</span>
              <span className="truncate text-right">{rightLabel}</span>
            </span>
            <span />
          </div>
          <ul className={`${inset} ${compact ? '' : 'pb-3'}`}>
            {rows.map((comparison) => {
              const difference = comparison.favourableDifference ?? 0;
              const scale = Math.max(
                Math.abs(comparison.sendingAverage ?? 0),
                Math.abs(comparison.receivingAverage ?? 0),
                0.000001
              );
              const width = `${Math.max(4, Math.min(1, Math.abs(difference) / scale) * 100)}%`;
              const category = FANTASY_CATEGORIES[comparison.column.key];
              const magnitude = category
                ? formatStatValue(Math.abs(difference), category)
                : Math.abs(difference).toFixed(1);
              const negligible = Number.parseFloat(magnitude) === 0;
              const signed =
                comparison.outcome === 'even'
                  ? '0'
                  : negligible
                    ? '≈0'
                    : `${comparison.outcome === 'favourable' ? '+' : '−'}${magnitude}`;
              const meaning =
                comparison.outcome === 'even'
                  ? 'level'
                  : comparison.outcome === 'favourable'
                    ? `better for ${youLabel}`
                    : `better for ${otherSide}`;
              return (
                <li
                  key={comparison.column.key}
                  aria-label={`${comparison.column.label}: ${meaning}${comparison.outcome === 'even' ? '' : ` by ${magnitude} per game`}`}
                  className={`grid min-h-7 ${grid} items-stretch gap-x-2`}
                >
                  <span className="self-center text-xs leading-tight text-[color:var(--trade-text)]">
                    {comparison.column.label}
                  </span>
                  {/* Rows sit flush, so the halves meet at one continuous centre line. */}
                  <span className="grid grid-cols-2">
                    <span className="flex items-center justify-end border-r border-[color:var(--trade-border-strong)]">
                      {comparison.outcome === 'unfavourable' ? (
                        <span
                          className="h-2 rounded-l-[2px] bg-[color:var(--trade-negative)]"
                          style={{ width }}
                        />
                      ) : null}
                    </span>
                    <span className="flex items-center">
                      {comparison.outcome === 'favourable' ? (
                        <span
                          className="h-2 rounded-r-[2px] bg-[color:var(--trade-positive)]"
                          style={{ width }}
                        />
                      ) : null}
                    </span>
                  </span>
                  <span className="self-center text-right text-xs font-semibold tabular-nums text-[color:var(--trade-text)]">
                    {signed}
                  </span>
                </li>
              );
            })}
          </ul>
          {compact ? null : (
            <p className="border-t border-[color:var(--trade-border)] px-4 py-2 text-xs text-[color:var(--trade-text-muted)]">
              Per-game averages, {season} season.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}

/** Players able to play each position, before and after the trade. */
export function TradeSquadImpact({
  changes,
  teamLabel = 'Your squad',
  showBasis = true,
}: {
  changes: SquadPositionChange[];
  teamLabel?: string;
  /** Hide the dual-position note when the surrounding panel prints it once at its foot. */
  showBasis?: boolean;
}): React.JSX.Element {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h4 id={headingId} className="text-sm font-semibold text-[color:var(--trade-text)]">
        {teamLabel} after trade
      </h4>
      {changes.length === 0 ? (
        <p className="mt-1 text-sm text-[color:var(--trade-text-muted)]">
          No change to position depth.
        </p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-[color:var(--trade-text)]">
          {changes.map((change) => (
            <li key={change.position} className="inline-flex items-center gap-1">
              <span className="font-semibold">{change.position}</span>
              <span className="text-[color:var(--trade-text-muted)]">{change.before}</span>
              <ArrowRight
                aria-hidden="true"
                className="size-3 text-[color:var(--trade-text-muted)]"
              />
              <span className="sr-only">to</span>
              <span
                className={`font-bold ${change.after < change.before ? VERDICT_TONE_CLASS.bad : VERDICT_TONE_CLASS.good}`}
              >
                {change.after}
              </span>
            </li>
          ))}
        </ul>
      )}
      {showBasis ? (
        <p className="mt-1 text-xs text-[color:var(--trade-text-muted)]">
          Dual-position players count in both.
        </p>
      ) : null}
    </section>
  );
}
