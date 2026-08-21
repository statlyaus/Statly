import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AflTradePackageEvaluationPanel } from '@/components/draft/AflTradePackageEvaluationPanel';
import { privateLocalWorkbookReads } from '@/server/aflTradeIntelligence/development/privateLocalWorkbookReads';
import { decodeGovernedPrivateEvaluationDetailDocument } from '@/server/aflTradeIntelligence/valuation/governedPrivateEvaluationGeneration';

import { LocalValuationReadinessNotice } from '../LocalValuationReadinessNotice';
import { LocalPrivateReviewedTradeCalculationPanel } from './LocalPrivateReviewedTradeCalculationPanel';
import { LocalSyntheticTradeExplanationPanel } from './LocalSyntheticTradeExplanationPanel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Private local trade calculation | Statly',
  robots: { index: false, follow: false },
};

function parseTradeId(value: string): string | null {
  const tradeId = value.trim();
  if (tradeId.length === 0 || tradeId.length > 200) return null;
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(tradeId) ? tradeId : null;
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
  const valuationReadiness = evaluation.numericalEvaluation.readiness;
  const privateCalculation =
    evaluation.numericalEvaluation.state === 'partial'
      ? evaluation.numericalEvaluation.calculation
      : null;
  const calculationAssets = new Map(
    privateCalculation?.assets.map((asset) => [asset.asset.id, asset]) ?? []
  );

  const { detail } = evaluation;
  const governedRead = evaluation.governedEvaluation;
  const governedDocument =
    governedRead?.state === 'available'
      ? decodeGovernedPrivateEvaluationDetailDocument(governedRead.bytes)
      : null;
  if (
    governedDocument !== null &&
    (governedDocument.selector.tradeId !== detail.trade.tradeId ||
      governedRead?.selector.tradeId !== detail.trade.tradeId ||
      governedRead.selector.valuationScopeKey !== `afl-men:${detail.trade.year}-trades`)
  ) {
    throw new TypeError('The governed evaluation does not belong to this transaction.');
  }
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
                Transaction identity comes from the pinned private workbook. Reviewed historical
                player PAV is shown where an exact player identity and season calculation exist;
                unsupported assets remain unavailable. The separate synthetic scenario stays clearly
                isolated. Neither lane has publication or production authority.
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

      <LocalValuationReadinessNotice
        readiness={valuationReadiness}
        historicalCalculationAvailable={privateCalculation !== null}
      />

      {privateCalculation ? (
        <LocalPrivateReviewedTradeCalculationPanel calculation={privateCalculation} />
      ) : null}

      <section
        aria-labelledby="governed-package-calculation-heading"
        className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Authenticated retained generation
            </p>
            <h2
              id="governed-package-calculation-heading"
              className="mt-2 text-xl font-semibold text-foreground"
            >
              Automatic governed package calculation
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The transaction stays intact: every participating club receives one package grade,
              while each received and surrendered asset explains its exact contribution and later
              transformation under the same four time views.
            </p>
          </div>
          {governedRead?.state === 'available' ? (
            <Link
              href={`/api/dev/afl-trade-evaluation/${encodeURIComponent(
                detail.trade.tradeId
              )}/export`}
              className="inline-flex min-h-11 items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Download exact JSON evidence
            </Link>
          ) : null}
        </div>

        {governedDocument !== null && governedRead?.state === 'available' ? (
          <>
            <dl className="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <dt className="font-semibold text-foreground">Generation</dt>
                <dd className="mt-1 break-all font-mono">{governedRead.generationId}</dd>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <dt className="font-semibold text-foreground">Projection manifest</dt>
                <dd className="mt-1 break-all font-mono">{governedRead.projectionManifestId}</dd>
              </div>
            </dl>
            <AflTradePackageEvaluationPanel narrative={governedDocument.narrative} />
          </>
        ) : (
          <div className="mt-4 rounded-lg border border-warning/35 bg-warning/10 px-4 py-3 text-sm text-foreground">
            <p className="font-semibold">Current package grade: —</p>
            <p className="mt-1 text-muted-foreground">
              An authenticated complete package calculation is not currently available.
            </p>
          </div>
        )}
      </section>

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
            <LocalSyntheticTradeExplanationPanel document={scenario.explanation.document} />
          </>
        ) : (
          <p className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Scenario unavailable: {scenario.reason.replaceAll('_', ' ')}. No synthetic numerical
            result was created for this trade.
          </p>
        )}
      </section>

      <section
        aria-labelledby="asset-evidence-heading"
        className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <h2 id="asset-evidence-heading" className="text-xl font-semibold text-foreground">
          Asset evidence review
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These are the exact transaction records from the pinned workbook. A separate reviewed
          calculation may link a player record to exact historical season PAV; this list itself does
          not infer pick lineage, future output, or a trade grade.
        </p>

        <ul className="mt-5 divide-y divide-border border-y border-border">
          {detail.assets.map((asset) => {
            const calculatedAsset = calculationAssets.get(asset.id);
            return (
              <li key={asset.id} className="grid gap-4 py-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Workbook trade record
                  </p>
                  <p className="font-semibold text-foreground">{asset.assetText}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {asset.clubName} · {asset.assetType.replaceAll('_', ' ')}
                  </p>
                </div>
                <div className="text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Governed numerical evidence
                  </p>
                  <p className="mt-1 font-semibold text-foreground">
                    {calculatedAsset?.state === 'calculated'
                      ? 'Reviewed historical PAV linked'
                      : 'Unavailable at this gate'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {calculatedAsset?.state === 'calculated'
                      ? 'See the component calculation above; predictive and grade authority remain unavailable.'
                      : 'Exact identity or selection lineage and supported calculation evidence are required.'}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-labelledby="input-identity-heading"
        className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h2 id="input-identity-heading" className="text-lg font-semibold text-foreground">
              Pinned factual input identity
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {privateCalculation
                ? 'Reviewed historical player calculations are private and publication-prohibited; unsupported assets and predictive grades remain blocked.'
                : 'No factual calculation, dataset, or model identity is claimed while numerical evaluation remains blocked.'}
            </p>
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
