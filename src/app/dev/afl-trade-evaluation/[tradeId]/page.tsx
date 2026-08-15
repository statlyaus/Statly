import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AflTradeValueSummaryCard } from '@/components/draft/AflTradeValueSummaryCard';
import { privateLocalWorkbookReads } from '@/server/aflTradeIntelligence/development/privateLocalWorkbookReads';
import type { AflTradeDevelopmentReconciledOutcomeMetric } from '@/server/aflTradeIntelligence/modeling/developmentWorkbookValueProjection';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Private local trade calculation | Statly',
  robots: { index: false, follow: false },
};

const assetStateLabels = {
  valued: 'Valued',
  right_censored: 'Right-censored',
  outcome_unresolved: 'Outcome unresolved',
  lineage_unresolved: 'Lineage unresolved',
  insufficient_cohort: 'Insufficient cohort',
} as const;

const linkStateLabels = {
  linked: 'Linked',
  unresolved: 'Unresolved',
  ambiguous: 'Ambiguous',
} as const;

const linkMethodLabels = {
  player_club_year: 'Player, receiving club and year',
  draft_selection_year: 'Draft selection and year',
  none: 'No defensible match',
} as const;

function parseTradeId(value: string): string | null {
  const tradeId = value.trim();
  if (tradeId.length === 0 || tradeId.length > 200) return null;
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(tradeId) ? tradeId : null;
}

function providerLabel(value: string): string {
  if (value === 'afl_tables') return 'AFL Tables';
  if (value === 'footywire') return 'Footywire';
  if (value === 'fryzigg') return 'Fryzigg';
  return value;
}

function verifiedGamesLabel(metric: AflTradeDevelopmentReconciledOutcomeMetric): string {
  if (metric.state === 'observed') return `${metric.value} games`;
  if (metric.state === 'partial') {
    return `${metric.observedValue} games (right-censored)`;
  }
  return 'Unavailable — reconciled fact has no supported games value';
}

const scenarioViewLabels = {
  at_trade: 'At trade',
  realized: 'Realized',
  remaining: 'Remaining',
  current: 'Current',
} as const;

function scenarioValue(value: number): string {
  return value.toFixed(2);
}

export default async function LocalWorkbookTradeEvaluationPage({
  params,
}: {
  params: Promise<{ tradeId: string }>;
}) {
  const tradeId = parseTradeId((await params).tradeId);
  if (tradeId === null) notFound();

  const evaluation = await privateLocalWorkbookReads.loadTrade(tradeId);
  if (evaluation === null) notFound();

  const { calculation, detail } = evaluation;
  const assetById = new Map(detail.assets.map((asset) => [asset.id, asset]));
  const linkByAssetId = new Map(evaluation.links.map((link) => [link.assetId, link]));
  const summaries = [
    calculation.summaries.at_trade,
    calculation.summaries.realized,
    calculation.summaries.remaining,
    calculation.summaries.current,
  ];
  const scenario = evaluation.scenario;
  const scenarioDirectionBasis =
    scenario.state === 'ready'
      ? scenario.scenario.assumptionSet.content.transferDirections[0]?.directionBasis
      : null;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`/dev/afl-trade-evaluation?year=${detail.trade.year}`}
        className="inline-flex min-h-10 items-center rounded-md text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to private archive
      </Link>

      <header className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/40 px-5 py-6 sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {detail.trade.year} · Trade {detail.trade.seqInYear}
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
                {detail.trade.title}
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
                Transaction identity comes from the pinned private workbook. Factual outcomes stay
                unavailable unless reconciled acquisition-spell evidence exists; the separate
                numerical scenario below uses fabricated test inputs only. Neither lane has
                factual-release or publication authority.
              </p>
            </div>
            <span className="rounded-full border border-warning/35 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-foreground">
              Private local calculation
            </span>
          </div>
        </div>
        <dl className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-background p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Parties
            </dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">
              {detail.trade.clubNames.join(' · ')}
            </dd>
          </div>
          <div className="bg-background p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assets
            </dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">
              {detail.assets.length} transaction records
            </dd>
          </div>
          <div className="bg-background p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Production authority
            </dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">None</dd>
          </div>
          <div className="bg-background p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Publication authority
            </dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">None</dd>
          </div>
        </dl>
      </header>

      <section
        aria-labelledby="synthetic-scenario-heading"
        className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h2 id="synthetic-scenario-heading" className="text-xl font-semibold text-foreground">
              Synthetic calculation scenario
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              This exercises the production-shaped valuation calculation with deterministic fixture
              values. It is separate from the factual evidence review below and must not be read as
              a real AFL valuation.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full border border-warning/35 bg-warning/10 px-3 py-1.5 text-foreground">
              Fabricated test evidence — not real AFL data
            </span>
            <span className="rounded-full border border-destructive/35 bg-destructive/10 px-3 py-1.5 text-foreground">
              Publication prohibited
            </span>
          </div>
        </div>

        {scenario.state === 'ready' ? (
          <>
            <p className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              {scenarioDirectionBasis === 'two_party_other_club_assumption'
                ? 'Workbook rows record the receiving club only; for this two-party test scenario, each sender is inferred as the other participating club.'
                : 'Workbook rows record the receiving club only; this multi-party test scenario uses the declared deterministic fixture transfer map.'}
            </p>
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              {scenario.summary.views.map((view) => (
                <section
                  key={view.view}
                  aria-label={`${scenarioViewLabels[view.view]} synthetic values`}
                  className="overflow-hidden rounded-xl border border-border bg-background"
                >
                  <h3 className="border-b border-border bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground">
                    {scenarioViewLabels[view.view]}
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-4 py-3 font-semibold">
                            Club
                          </th>
                          <th scope="col" className="px-4 py-3 text-right font-semibold">
                            Received
                          </th>
                          <th scope="col" className="px-4 py-3 text-right font-semibold">
                            Given up
                          </th>
                          <th scope="col" className="px-4 py-3 text-right font-semibold">
                            Net
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {view.parties.map((party) => (
                          <tr key={party.aflClubId}>
                            <th scope="row" className="px-4 py-3 font-semibold text-foreground">
                              {party.clubName}
                            </th>
                            <td className="px-4 py-3 text-right tabular-nums text-foreground">
                              {scenarioValue(party.received)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-foreground">
                              {scenarioValue(party.givenUp)}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                              {scenarioValue(party.netAdvantage)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
            <dl className="mt-5 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-foreground">Scenario</dt>
                <dd className="break-all font-mono">{scenario.summary.scenarioId}</dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">Calculation</dt>
                <dd className="break-all font-mono">{scenario.summary.calculationId}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Scenario unavailable: {scenario.reason.replaceAll('_', ' ')}. No synthetic numerical
            result was created for this trade.
          </p>
        )}
      </section>

      <section aria-labelledby="calculation-views-heading" className="space-y-4">
        <div>
          <h2 id="calculation-views-heading" className="text-xl font-semibold text-foreground">
            Factual-evidence calculation views
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Source-recorded grades are prohibited. Values are model outputs with explicit coverage
            and uncertainty.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {summaries.map((summary) => (
            <AflTradeValueSummaryCard
              key={summary.view}
              valuation={summary}
              calculationAsOf={evaluation.model.content.createdAt}
            />
          ))}
        </div>
      </section>

      <section
        aria-labelledby="asset-evidence-heading"
        className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <h2 id="asset-evidence-heading" className="text-xl font-semibold text-foreground">
          Asset evidence review
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every workbook asset is shown with its calculation and acquisition-link state.
        </p>

        <ul className="mt-5 divide-y divide-border border-y border-border">
          {calculation.assets.map((result) => {
            const asset = assetById.get(result.assetId);
            const link = linkByAssetId.get(result.assetId);
            return (
              <li
                key={result.assetId}
                className="grid gap-4 py-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
              >
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Workbook trade record
                  </p>
                  <p className="font-semibold text-foreground">
                    {asset?.assetText ?? result.assetId}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {asset?.clubName ?? 'Unknown club'} · {asset?.assetType ?? 'unknown'}
                  </p>
                </div>
                <div className="text-sm">
                  <p className="font-semibold text-foreground">{assetStateLabels[result.state]}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {result.atTradeSampleCount} historical samples
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Providers:{' '}
                    {result.featureProviders.length > 0
                      ? result.featureProviders.map(providerLabel).join(', ')
                      : 'none'}
                  </p>
                </div>
                <div className="text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Verified post-trade games
                  </p>
                  {link?.outcomeEvidence.state === 'reconciled' ? (
                    <>
                      <p className="mt-1 font-semibold text-foreground">
                        {verifiedGamesLabel(link.outcomeEvidence.games)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Effective through {link.outcomeEvidence.effectiveThrough.slice(0, 10)}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 font-semibold text-foreground">
                      Unavailable — no reconciled acquisition-spell fact
                    </p>
                  )}
                </div>
                <div className="text-sm">
                  <p className="font-semibold text-foreground">
                    {link ? linkStateLabels[link.state] : 'No link result'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {link ? linkMethodLabels[link.method] : 'No matching method recorded'}
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {link?.acquisitionId ?? 'No acquisition id'}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-labelledby="calculation-identity-heading"
        className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h2 id="calculation-identity-heading" className="text-lg font-semibold text-foreground">
              Reproducible calculation identity
            </h2>
            <dl className="mt-3 space-y-2 text-xs text-muted-foreground">
              <div>
                <dt className="font-semibold text-foreground">Calculation</dt>
                <dd className="break-all font-mono">{calculation.calculationId}</dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">Dataset</dt>
                <dd className="break-all font-mono">{calculation.datasetId}</dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">Model</dt>
                <dd className="break-all font-mono">{calculation.modelId}</dd>
              </div>
            </dl>
          </div>
          <div className="text-right text-xs leading-5 text-muted-foreground">
            <p>{evaluation.input.originalFilename}</p>
            <p className="font-mono">SHA-256 {evaluation.input.sha256.slice(0, 12)}…</p>
            <p>Production authority: none</p>
            <p>Publication authority: none</p>
          </div>
        </div>
      </section>
    </main>
  );
}
