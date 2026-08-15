import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { localWorkbookEvaluationService } from '@/server/aflTradeIntelligence/development/localWorkbookEvaluation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Private local trade evaluation | Statly',
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;
type AssetType = 'player' | 'pick' | 'future_pick';

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function yearParam(value: string): number | null {
  if (!/^\d{4}$/u.test(value)) return null;
  const year = Number(value);
  return year >= 1800 && year <= 2100 ? year : null;
}

function assetTypeParam(value: string): AssetType | undefined {
  return value === 'player' || value === 'pick' || value === 'future_pick' ? value : undefined;
}

function availabilityLabel(availability: string): string {
  if (availability === 'available') return 'Complete calculation';
  if (availability === 'available_partial') return 'Partial calculation';
  if (availability === 'lineage_unresolved') return 'Lineage unresolved';
  return 'Insufficient data';
}

function availabilityClass(availability: string): string {
  if (availability === 'available') return 'border-success/30 bg-success/10 text-success';
  if (availability === 'available_partial') {
    return 'border-warning/35 bg-warning/10 text-foreground';
  }
  return 'border-border bg-muted text-muted-foreground';
}

function signedScenarioValue(value: number): string {
  return `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(2)}`;
}

function scenarioViewLabel(view: string): string {
  if (view === 'at_trade') return 'At trade';
  if (view === 'realized') return 'Realized';
  if (view === 'remaining') return 'Remaining';
  return 'Current';
}

export default async function LocalWorkbookEvaluationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolved = await searchParams;
  const requestedYear = yearParam(first(resolved.year).trim());
  const clubSlug = first(resolved.club).trim().toLowerCase() || undefined;
  const q = first(resolved.q).trim() || undefined;
  const type = assetTypeParam(first(resolved.type).trim());
  const evaluation = await localWorkbookEvaluationService.loadArchive({
    year: requestedYear,
    clubSlug,
    type,
    q,
  });
  if (evaluation === null) notFound();

  const metrics = [
    {
      key: 'processed',
      label: 'Processed',
      value: evaluation.batch.processedTrades,
      detail: `${evaluation.year} selected · ${evaluation.batch.totalTrades} total trades`,
    },
    {
      key: 'available',
      label: 'Complete',
      value: evaluation.batch.availableTrades,
      detail: 'all included assets calculated this year',
    },
    {
      key: 'partial',
      label: 'Partial',
      value: evaluation.batch.partialTrades,
      detail: 'calculated with excluded assets this year',
    },
    {
      key: 'unresolved',
      label: 'Unresolved',
      value: evaluation.batch.unresolvedTrades,
      detail: 'no defensible comparison yet this year',
    },
    {
      key: 'scenario-ready',
      label: 'Scenario ready',
      value: evaluation.batch.scenarioReadyTrades,
      detail: 'production-shaped synthetic calculations available',
    },
    {
      key: 'scenario-unavailable',
      label: 'Scenario unavailable',
      value: evaluation.batch.scenarioUnavailableTrades,
      detail: 'malformed or unsupported workbook trades',
    },
  ];

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/40 px-5 py-6 sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Local development tool
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
                Private local trade evaluation
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
                Review real historical workbook transaction identities alongside explicit
                development-only scenarios. Scenario numbers are fabricated test inputs, kept
                separate from factual evidence, and prohibited from publication.
              </p>
            </div>
            <span className="rounded-full border border-warning/35 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-foreground">
              Not a factual release
            </span>
          </div>
        </div>
        <dl className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {metrics.map((metric) => (
            <div key={metric.key} className="bg-background p-5">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {metric.label}
              </dt>
              <dd
                data-metric={metric.key}
                className="mt-2 text-3xl font-bold tabular-nums text-foreground"
              >
                {metric.value}
              </dd>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{metric.detail}</p>
            </div>
          ))}
        </dl>
      </header>

      <section
        aria-labelledby="evaluation-input-heading"
        className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="evaluation-input-heading" className="text-lg font-semibold text-foreground">
              Pinned private input
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {evaluation.input.originalFilename} · SHA-256{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                {evaluation.input.sha256.slice(0, 12)}…
              </code>
            </p>
            <p className="mt-2 text-xs font-semibold text-foreground">
              Fabricated test evidence — not real AFL data · Publication prohibited
            </p>
          </div>
          <div className="text-right text-xs leading-5 text-muted-foreground">
            <p>Production authority: none</p>
            <p>Publication authority: none</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="evaluation-trades-heading" className="space-y-4">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="evaluation-trades-heading" className="text-xl font-semibold text-foreground">
                Real workbook trades · {evaluation.year}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {evaluation.trades.length} matching transactions. Open a trade to inspect calculated
                views, coverage, and unresolved asset evidence.
              </p>
            </div>
          </div>

          <form
            method="get"
            className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-5"
            aria-label="Filter private workbook trades"
          >
            <label className="text-sm font-medium text-foreground">
              Year
              <select
                name="year"
                defaultValue={String(evaluation.year)}
                className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {evaluation.years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-foreground">
              Club slug
              <input
                name="club"
                defaultValue={clubSlug ?? ''}
                placeholder="e.g. carlton"
                className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              Asset type
              <select
                name="type"
                defaultValue={type ?? ''}
                className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">All</option>
                <option value="player">Players</option>
                <option value="pick">Picks</option>
                <option value="future_pick">Future picks</option>
              </select>
            </label>
            <label className="text-sm font-medium text-foreground">
              Search
              <input
                name="q"
                type="search"
                defaultValue={q ?? ''}
                placeholder="Title or club"
                className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Apply
              </button>
              <Link
                href="/dev/afl-trade-evaluation"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Clear
              </Link>
            </div>
          </form>
        </div>

        {evaluation.trades.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No workbook trades match these filters.
          </div>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {evaluation.trades.map(({ trade, calculation, scenario }) => {
              return (
                <li
                  key={trade.tradeId}
                  className="rounded-2xl border border-border bg-card p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {trade.year} · Trade {trade.seqInYear}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold leading-snug text-foreground">
                        {trade.title}
                      </h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {trade.clubNames.join(' · ')} · {trade.assetCount} assets
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${availabilityClass(calculation.availability)}`}
                      >
                        {availabilityLabel(calculation.availability)}
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${scenario.state === 'ready' ? 'border-success/30 bg-success/10 text-success' : 'border-border bg-muted text-muted-foreground'}`}
                      >
                        {scenario.state === 'ready'
                          ? 'Synthetic scenario ready'
                          : 'Scenario unavailable'}
                      </span>
                    </div>
                  </div>
                  {scenario.state === 'ready' ? (
                    <div className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Synthetic net by view
                      </p>
                      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                        {scenario.summary.views.map((view) => (
                          <div
                            key={view.view}
                            className="rounded-md border border-border bg-background p-2"
                          >
                            <dt className="text-xs font-semibold text-muted-foreground">
                              {scenarioViewLabel(view.view)}
                            </dt>
                            <dd>
                              <ul className="mt-1 space-y-0.5 text-sm font-semibold text-foreground">
                                {view.parties.map((party) => (
                                  <li key={party.aflClubId}>
                                    {party.clubName} {signedScenarioValue(party.netAdvantage)}
                                  </li>
                                ))}
                              </ul>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ) : (
                    <p className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                      No synthetic value:{' '}
                      {scenario.state === 'unavailable'
                        ? scenario.reason.replaceAll('_', ' ')
                        : 'scenario summary missing'}
                      .
                    </p>
                  )}
                  <div className="mt-4 border-t border-border pt-4">
                    <Link
                      href={`/dev/afl-trade-evaluation/${encodeURIComponent(trade.tradeId)}`}
                      className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Review calculation
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
