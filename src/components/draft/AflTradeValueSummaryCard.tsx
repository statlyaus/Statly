import Link from 'next/link';

import { AflTradeValueUnavailablePanel } from '@/components/draft/AflTradeValueUnavailablePanel';
import type {
  AflTradeValueBearingSummary,
  AflTradeValueSummary,
} from '@/types/aflTradeIntelligence';

type AflTradeValueSummaryCardProps = {
  valuation: AflTradeValueSummary;
  calculationAsOf: string | null;
};

const viewLabels = {
  at_trade: 'At the trade',
  realized: 'Realized',
  remaining: 'Remaining',
  current: 'Outcome today',
} as const satisfies Record<AflTradeValueSummary['view'], string>;

const confidenceLabels = {
  low: 'Low confidence',
  moderate: 'Moderate confidence',
  high: 'High confidence',
} as const satisfies Record<AflTradeValueBearingSummary['confidence']['level'], string>;

function isValueBearing(valuation: AflTradeValueSummary): valuation is AflTradeValueBearingSummary {
  return 'clubValues' in valuation;
}

function formatValue(value: number): string {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 }).format(value);
}

function formatProbability(value: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatAsOf(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Melbourne',
  }).format(new Date(value));
}

function verdict(valuation: AflTradeValueBearingSummary): string {
  if (valuation.assessment.interpretation === 'balanced_within_uncertainty') {
    return 'Too close to call';
  }
  const favouredClub = valuation.clubValues.find(
    (club) => club.aflClubId === valuation.assessment.favouredAflClubId
  );
  const prefix =
    valuation.assessment.interpretation === 'strongly_leans_to_club' ? 'Strongly leans' : 'Leans';
  return `${prefix} ${favouredClub?.clubName ?? 'one side'}`;
}

export function AflTradeValueSummaryCard({
  valuation,
  calculationAsOf,
}: AflTradeValueSummaryCardProps) {
  if (!isValueBearing(valuation)) {
    return <AflTradeValueUnavailablePanel availability={valuation} variant="compact" />;
  }

  const asOfLabel = formatAsOf(calculationAsOf);
  const isLimited = valuation.availability !== 'available';

  return (
    <section
      aria-label={`${viewLabels[valuation.view]} trade value summary`}
      data-afl-trade-value-availability={valuation.availability}
      className="rounded-xl border border-border bg-card p-3 text-card-foreground shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {viewLabels[valuation.view]}
          </p>
          <h4 className="mt-1 text-sm font-semibold text-foreground">{verdict(valuation)}</h4>
        </div>
        <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {confidenceLabels[valuation.confidence.level]}
        </span>
      </div>

      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {valuation.clubValues.map((club) => (
          <div key={club.aflClubId} className="rounded-lg border border-border bg-background p-2.5">
            <dt className="truncate text-xs font-semibold text-foreground">{club.clubName}</dt>
            <dd className="mt-1 text-xs leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">
                {formatValue(club.expectedValue)} expected
              </span>
              {' · '}
              {formatValue(club.medianValue)} median
              <br />
              {formatProbability(club.finishesAheadProbability)} chance to finish ahead
              <br />
              {formatProbability(club.interval.level)} range {formatValue(club.interval.lower)}–
              {formatValue(club.interval.upper)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {formatProbability(valuation.practicalEquivalenceProbability)} practical-equivalence
          chance
          {asOfLabel ? ` · Calculated ${asOfLabel}` : ''}
        </span>
        <Link
          href={valuation.methodologyHref}
          className="font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Methodology
        </Link>
      </div>

      {isLimited ? (
        <p className="mt-2 rounded-lg border border-border bg-muted p-2 text-xs leading-5 text-muted-foreground">
          {valuation.message}
        </p>
      ) : null}
    </section>
  );
}
