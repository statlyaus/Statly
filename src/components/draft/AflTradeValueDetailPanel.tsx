import Link from 'next/link';

import { AflTradeValueUnavailablePanel } from '@/components/draft/AflTradeValueUnavailablePanel';
import { deriveAflTradeStatlyGradesFromDetail } from '@/server/aflTradeIntelligence/valuation/statlyGradePolicy';
import type {
  AflTradeAssetValueResult,
  AflTradeClubValue,
  AflTradeValueBearing,
  AflTradeValueDetailResponse,
  AflTradeValueResult,
} from '@/types/aflTradeIntelligence';

type AflTradeValueDetailPanelProps = {
  analysis: AflTradeValueDetailResponse;
};

const viewLabels = {
  at_trade: 'At the time',
  realized: 'Realized value',
  remaining: 'Remaining value',
  current: 'Outcome today',
} as const satisfies Record<AflTradeValueResult['view'], string>;

function isValueBearing(value: AflTradeValueResult): value is AflTradeValueBearing {
  return 'clubValues' in value;
}

function formatValue(value: number): string {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 }).format(value);
}

function formatSignedValue(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return `${normalized > 0 ? '+' : ''}${formatValue(normalized)}`;
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

function verdict(value: AflTradeValueBearing): string {
  if (value.assessment.interpretation === 'balanced_within_uncertainty') {
    return 'Too close to call within the model uncertainty';
  }
  const club = value.clubValues.find(
    (entry) => entry.aflClubId === value.assessment.favouredAflClubId
  );
  return `${
    value.assessment.interpretation === 'strongly_leans_to_club' ? 'Strongly leans' : 'Leans'
  } ${club?.clubName ?? 'one side'}`;
}

function statusCaveat(value: AflTradeValueBearing): string | null {
  return value.availability === 'available' ? null : value.message;
}

function AssetValue({ value }: { value: AflTradeAssetValueResult }) {
  if (value.status === 'excluded') {
    return (
      <div className="rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{viewLabels[value.view]}:</span>{' '}
        {value.message}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h5 className="text-sm font-semibold text-foreground">{viewLabels[value.view]}</h5>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {formatValue(value.estimate)}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Median {formatValue(value.uncertainty.median)} ·{' '}
        {formatProbability(value.uncertainty.intervalLevel)} range{' '}
        {formatValue(value.uncertainty.lower)}–{formatValue(value.uncertainty.upper)}
      </p>
      {value.currentComponents ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {formatValue(value.currentComponents.realizedValue)} realized +{' '}
          {formatValue(value.currentComponents.remainingValue)} remaining
        </p>
      ) : null}
    </div>
  );
}

function PackageValueBreakdown({
  packageValue,
  unitLabel,
}: {
  packageValue: NonNullable<AflTradeClubValue['packageValue']>;
  unitLabel: string;
}) {
  return (
    <div className="mt-2 text-sm leading-6 text-muted-foreground">
      <p>
        {formatValue(packageValue.received.median)} received −{' '}
        {formatValue(packageValue.givenUp.median)} given up
      </p>
      <details className="group mt-2 border-t border-border pt-2">
        <summary className="cursor-pointer font-semibold text-foreground marker:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          How this is calculated
        </summary>
        <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs">
          <dt>Received value</dt>
          <dd className="text-right tabular-nums text-foreground">
            {formatValue(packageValue.received.interval.lower)}–
            {formatValue(packageValue.received.interval.upper)}
          </dd>
          <dt>Given-up value</dt>
          <dd className="text-right tabular-nums text-foreground">
            {formatValue(packageValue.givenUp.interval.lower)}–
            {formatValue(packageValue.givenUp.interval.upper)}
          </dd>
          <dt>Net advantage</dt>
          <dd className="text-right tabular-nums text-foreground">
            {formatSignedValue(packageValue.net.interval.lower)}–
            {formatSignedValue(packageValue.net.interval.upper)}
          </dd>
        </dl>
        <p className="mt-2 text-xs">
          Net is received value minus given-up value in {unitLabel} units. Ranges show uncertainty
          in the complete package rather than a precise point score.
        </p>
      </details>
    </div>
  );
}

export function AflTradeValueDetailPanel({ analysis }: AflTradeValueDetailPanelProps) {
  const numerical = analysis.valuations.filter(isValueBearing);
  if (numerical.length === 0) {
    const unavailable =
      analysis.valuations.find((value) => value.view === 'current') ?? analysis.valuations[0];
    if (!unavailable || isValueBearing(unavailable)) return null;
    return <AflTradeValueUnavailablePanel availability={unavailable} variant="detail" />;
  }

  const headline = numerical.find((value) => value.view === 'current') ?? numerical[0];
  const methodologyHref = headline.methodologyHref;
  const caveat = statusCaveat(headline);
  const calculationAsOf = formatAsOf(analysis.consistency.calculationAsOf);
  const clubNames = new Map(
    numerical.flatMap((value) =>
      value.clubValues.map((club) => [club.aflClubId, club.clubName] as const)
    )
  );
  const factors = headline.clubValues.flatMap((club) =>
    club.factors.map((factor) => ({ ...factor, clubName: club.clubName }))
  );

  return (
    <section aria-labelledby="statly-trade-verdict-heading" className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Statly verdict · {viewLabels[headline.view]}
            </p>
            <h3
              id="statly-trade-verdict-heading"
              className="mt-2 text-xl font-semibold tracking-tight text-foreground"
            >
              {verdict(headline)}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {headline.confidence.level} confidence · {headline.coverage.valuedAssetCount} of{' '}
              {headline.coverage.totalAssetCount} assets valued ·{' '}
              {formatProbability(headline.comparison.practicalEquivalenceProbability)} practical
              equivalence
            </p>
            {calculationAsOf ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Calculated as at {calculationAsOf}
              </p>
            ) : null}
            {caveat ? (
              <p className="mt-3 rounded-lg border border-border bg-muted p-3 text-sm leading-6 text-muted-foreground">
                {caveat}
              </p>
            ) : null}
          </div>
          <Link
            href={methodologyHref}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Methodology and limits
          </Link>
        </div>
      </div>

      <section
        aria-labelledby="trade-value-views-heading"
        className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6"
      >
        <h3 id="trade-value-views-heading" className="text-lg font-semibold text-foreground">
          Value by AFL club
        </h3>
        <div className="mt-4 space-y-4">
          {numerical.map((value) => {
            const statlyGrades = deriveAflTradeStatlyGradesFromDetail(value);
            return (
              <section key={value.view} aria-labelledby={`trade-value-${value.view}-heading`}>
                <h4
                  id={`trade-value-${value.view}-heading`}
                  className="text-sm font-semibold text-foreground"
                >
                  {viewLabels[value.view]}
                </h4>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  {value.clubValues.map((club) => {
                    const finishesAhead = value.comparison.probabilities.find(
                      (probability) => probability.aflClubId === club.aflClubId
                    )?.finishesAhead;
                    const statlyGrade = statlyGrades.clubs.find(
                      (candidate) => candidate.aflClubId === club.aflClubId
                    );
                    return (
                      <article
                        key={club.aflClubId}
                        className="rounded-xl border border-border bg-background p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h5 className="font-semibold text-foreground">{club.clubName}</h5>
                          <span className="inline-flex shrink-0 items-center gap-2">
                            {statlyGrade?.grade ? (
                              <span className="inline-flex flex-col items-end gap-0.5">
                                <span
                                  className="badge badge-primary badge-outline min-w-10 justify-center font-semibold"
                                  aria-label={`${club.clubName} Statly grade ${statlyGrade.grade}`}
                                >
                                  {statlyGrade.grade}
                                </span>
                                {statlyGrade.state === 'provisional' ? (
                                  <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Provisional
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium text-muted-foreground">
                                Grade unavailable
                              </span>
                            )}
                            <span className="font-semibold tabular-nums text-foreground">
                              {club.packageValue
                                ? `Net ${formatSignedValue(club.packageValue.net.median)}`
                                : formatValue(club.estimate)}
                            </span>
                          </span>
                        </div>
                        {club.packageValue ? (
                          <>
                            <PackageValueBreakdown
                              packageValue={club.packageValue}
                              unitLabel={value.unit.label}
                            />
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">
                              {finishesAhead === undefined
                                ? 'Finish-ahead probability unavailable'
                                : `${formatProbability(finishesAhead)} chance to finish ahead`}
                            </p>
                          </>
                        ) : (
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            Median {formatValue(club.uncertainty.median)} ·{' '}
                            {formatProbability(club.uncertainty.intervalLevel)} range{' '}
                            {formatValue(club.uncertainty.lower)}–
                            {formatValue(club.uncertainty.upper)}
                            <br />
                            {finishesAhead === undefined
                              ? 'Winner probability unavailable'
                              : `${formatProbability(finishesAhead)} chance to finish ahead`}
                            <br />
                            {formatProbability(club.distribution.lowReturn.probability)} low-return
                            · {formatProbability(club.distribution.eliteOutcome.probability)} elite
                            outcome
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      <section
        aria-labelledby="trade-asset-breakdown-heading"
        className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="trade-asset-breakdown-heading" className="text-lg font-semibold text-foreground">
            Club-by-club asset breakdown
          </h3>
          <span className="text-xs text-muted-foreground">
            Lineage {analysis.lineageSummary.status}
          </span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {analysis.assets.map((asset) => (
            <article
              key={asset.assetId}
              className="rounded-xl border border-border bg-background p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {asset.assetKind.replaceAll('_', ' ')} · received by{' '}
                {clubNames.get(asset.receivedByAflClubId) ?? asset.receivedByAflClubId}
              </p>
              <h4 className="mt-1 font-semibold text-foreground">{asset.label}</h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {asset.lineage.summary}
              </p>
              <div className="mt-3 space-y-2">
                {asset.values.map((value) => (
                  <AssetValue key={value.view} value={value} />
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      {factors.length > 0 ? (
        <section
          aria-labelledby="trade-value-factors-heading"
          className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6"
        >
          <h3 id="trade-value-factors-heading" className="text-lg font-semibold text-foreground">
            Why the model says this
          </h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
            {factors.map((factor) => (
              <li
                key={`${factor.clubName}-${factor.code}`}
                className="rounded-lg border border-border bg-background p-3"
              >
                <span className="font-semibold text-foreground">
                  {factor.clubName}: {factor.label}.
                </span>{' '}
                {factor.explanation}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
