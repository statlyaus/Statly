'use client';

import { useState } from 'react';

import type {
  AflTradeValuationAssetLedger,
  AflTradeValuationExplanationClub,
  AflTradeValuationExplanationDocument,
  AflTradeValuationExplanationView,
} from '@/server/aflTradeIntelligence/valuation/tradeValuationExplanation';

type ValuationView = AflTradeValuationExplanationView['view'];

const VIEW_LABELS: Record<ValuationView, string> = {
  at_trade: 'At trade',
  realized: 'Realized',
  remaining: 'Remaining',
  current: 'Current',
};

const VIEW_DEFINITIONS: Record<ValuationView, string> = {
  at_trade: 'What the deterministic fixture valued each package at when the trade occurred.',
  realized: 'The fabricated contribution already assigned to each asset in this rehearsal.',
  remaining: 'The fabricated contribution still projected after the assessment date.',
  current: 'Realized contribution plus the remaining projection for each asset.',
};

function formatScore(value: number): string {
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(2)}`;
}

function formatProbability(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function assetKindLabel(kind: string): string {
  if (kind === 'current_pick') return 'Current pick';
  if (kind === 'future_pick') return 'Future pick';
  return 'Player';
}

function AssetLedger({
  label,
  ledger,
  view,
}: {
  label: 'Received' | 'Given up';
  ledger: AflTradeValuationAssetLedger;
  view: ValuationView;
}) {
  return (
    <section aria-label={`${label} asset scores`}>
      <h5 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </h5>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
        {ledger.assets.map((asset) => (
          <li key={`${label}-${asset.assetId}`} className="p-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{asset.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {assetKindLabel(asset.assetKind)} · probability-weighted mean
                </p>
              </div>
              <span
                className="shrink-0 font-semibold tabular-nums text-foreground"
                aria-label={`${asset.label} contribution ${formatScore(asset.additiveMean)}`}
              >
                {formatScore(asset.additiveMean)}
              </span>
            </div>

            {view === 'current' && asset.currentComponents ? (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Realized {formatScore(asset.currentComponents.realizedMean)} + remaining{' '}
                {formatScore(asset.currentComponents.remainingMean)} = current{' '}
                {formatScore(asset.additiveMean)}
              </p>
            ) : null}

            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="min-h-10 cursor-pointer py-2 font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Asset calculation details
              </summary>
              <dl className="grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
                <div>
                  <dt>Asset median</dt>
                  <dd className="font-semibold tabular-nums text-foreground">
                    {formatScore(asset.distribution.median)}
                  </dd>
                </div>
                <div>
                  <dt>Asset p10–p90</dt>
                  <dd className="font-semibold tabular-nums text-foreground">
                    {formatScore(asset.distribution.p10)} to {formatScore(asset.distribution.p90)}
                  </dd>
                </div>
                <div>
                  <dt>Gross layer</dt>
                  <dd className="font-semibold tabular-nums text-foreground">
                    {formatScore(asset.layers.grossMean)}
                  </dd>
                </div>
                <div>
                  <dt>List-position adjustment</dt>
                  <dd className="font-semibold tabular-nums text-foreground">
                    {formatScore(asset.layers.listSpotDelta)}
                  </dd>
                </div>
                <div>
                  <dt>Scarcity adjustment</dt>
                  <dd className="font-semibold tabular-nums text-foreground">
                    {formatScore(asset.layers.scarcityDelta)}
                  </dd>
                </div>
                <div>
                  <dt>Final contribution</dt>
                  <dd className="font-semibold tabular-nums text-foreground">
                    {formatScore(asset.additiveMean)}
                  </dd>
                </div>
              </dl>
            </details>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-right text-sm font-semibold tabular-nums text-foreground">
        {`${label} subtotal ${formatScore(ledger.additiveMean)}`}
      </p>
    </section>
  );
}

function ClubExplanation({
  club,
  view,
}: {
  club: AflTradeValuationExplanationClub;
  view: ValuationView;
}) {
  const gradeLabel = club.grade.grade
    ? `${club.clubName} ${club.grade.state} synthetic grade ${club.grade.grade}`
    : `${club.clubName} synthetic grade unavailable`;

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-background">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/40 px-4 py-4">
        <div>
          <h4 className="text-lg font-semibold text-foreground">{club.clubName}</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">Complete directed package</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-right">
            <span className="block text-xs text-muted-foreground">Expected net</span>
            <span className="block font-semibold tabular-nums text-foreground">
              {formatScore(club.net.additiveMean)}
            </span>
          </span>
          <span
            aria-label={gradeLabel}
            className="inline-flex min-h-11 min-w-12 flex-col items-center justify-center rounded-lg border border-border bg-card px-2 text-foreground"
          >
            <span className="text-base font-bold">{club.grade.grade ?? '—'}</span>
            <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {club.grade.state === 'provisional' ? 'Provisional' : club.grade.state}
            </span>
          </span>
        </div>
      </header>

      <div className="grid gap-5 p-4 lg:grid-cols-2">
        <AssetLedger label="Received" ledger={club.received} view={view} />
        <AssetLedger label="Given up" ledger={club.givenUp} view={view} />
      </div>

      <div className="border-t border-border bg-muted/30 px-4 py-4">
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <p className="font-semibold tabular-nums text-foreground">
            {`Expected net ${formatScore(club.net.additiveMean)}`}
          </p>
          <p className="tabular-nums text-muted-foreground">
            {`Package median ${formatScore(club.net.distribution.median)}`}
          </p>
          <p className="tabular-nums text-muted-foreground">
            {`${formatProbability(club.finishAheadProbability)} chance to finish ahead`}
          </p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Likely package range {formatScore(club.net.distribution.p10)} to{' '}
          {formatScore(club.net.distribution.p90)}. The package median and range come from joint
          outcomes; they are not sums of asset medians.
        </p>
      </div>
    </article>
  );
}

export function LocalSyntheticTradeExplanationPanel({
  document,
}: {
  document: AflTradeValuationExplanationDocument;
}) {
  const [selectedView, setSelectedView] = useState<ValuationView>(document.defaultView);
  const view =
    document.views.find((candidate) => candidate.view === selectedView) ?? document.views[0];
  if (!view) return null;

  return (
    <div className="mt-5 space-y-5">
      <div className="rounded-xl border border-border bg-background p-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-end">
          <label className="grid gap-1 text-sm font-semibold text-foreground">
            Valuation view
            <select
              value={selectedView}
              onChange={(event) => setSelectedView(event.target.value as ValuationView)}
              className="min-h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {document.views.map((candidate) => (
                <option key={candidate.view} value={candidate.view}>
                  {VIEW_LABELS[candidate.view]}
                </option>
              ))}
            </select>
          </label>

          <div
            role="group"
            aria-label="Synthetic valuation views"
            className="hidden grid-cols-4 gap-2 sm:grid"
          >
            {document.views.map((candidate) => (
              <button
                key={candidate.view}
                type="button"
                aria-pressed={candidate.view === selectedView}
                onClick={() => setSelectedView(candidate.view)}
                className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              >
                {VIEW_LABELS[candidate.view]}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground">{VIEW_LABELS[view.view]}:</span>{' '}
          {VIEW_DEFINITIONS[view.view]}
        </p>
      </div>

      <section
        aria-label={`${VIEW_LABELS[view.view]} synthetic trade explanation`}
        aria-live="polite"
        className="grid gap-4 xl:grid-cols-2"
      >
        {view.clubs.map((club) => (
          <ClubExplanation key={club.aflClubId} club={club} view={view.view} />
        ))}
      </section>

      <details className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
        <summary className="min-h-10 cursor-pointer py-2 font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          How this score is calculated
        </summary>
        <div className="space-y-2 border-t border-border pt-3 leading-6">
          <p>
            Asset contributions and package subtotals use the probability-weighted mean, so every
            displayed asset score reconciles exactly to its received or given-up subtotal.
          </p>
          <p>
            Package median and p10–p90 range preserve the joint outcome distribution. They are
            uncertainty summaries and are not additive asset components.
          </p>
          <p>
            Overall grades come from the shared Statly package-grade policy. Individual players and
            picks do not receive letter grades.
          </p>
          <p>{document.methodology.practicalEquivalenceBasis}</p>
        </div>
      </details>

      <details className="rounded-xl border border-border bg-background p-4 text-xs text-muted-foreground">
        <summary className="min-h-10 cursor-pointer py-2 font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Technical provenance
        </summary>
        <dl className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-foreground">Value unit</dt>
            <dd className="break-all font-mono">{document.valueUnitId}</dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">Selected layer</dt>
            <dd>{document.selectedLayer}</dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">Evidence window</dt>
            <dd>
              {document.effectiveAt} to {document.effectiveThrough}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">Coverage and confidence</dt>
            <dd>
              {document.coverage.status} ({formatProbability(document.coverage.ratio)}) ·{' '}
              {document.confidenceLevel}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">Explanation</dt>
            <dd className="break-all font-mono">{document.explanationId}</dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">Calculation</dt>
            <dd className="break-all font-mono">{document.valuationCalculationId}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
