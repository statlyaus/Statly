'use client';

import { useState } from 'react';

import type { createAflTradeCalculationNarrative } from '@/server/aflTradeIntelligence/valuation/tradeCalculationNarrative';

type Narrative = ReturnType<typeof createAflTradeCalculationNarrative>['content'];
type View = Narrative['views'][number]['view'];
type Asset = Narrative['assets'][number];
type Contribution = Asset['contributions'][number];

const VIEW_LABELS: Record<View, string> = {
  at_trade: 'At trade',
  realized: 'Realized',
  remaining: 'Remaining',
  current: 'Current',
};

const VIEW_DEFINITIONS: Record<View, string> = {
  at_trade: 'The expected package value using evidence available at the transaction cutoff.',
  realized: 'The observed contribution credited through the evidence cutoff.',
  remaining: 'The authenticated contribution forecast still ahead.',
  current: 'Realized contribution plus remaining forecast for the same exchange.',
};

function formatted(value: number): string {
  const normalized = Math.abs(value) < 1e-9 ? 0 : value;
  return Number.isInteger(normalized)
    ? normalized.toString()
    : normalized.toFixed(4).replace(/0+$/u, '').replace(/\.$/u, '');
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatted(value)}`;
}

function assetKind(kind: Asset['assetKind']): string {
  if (kind === 'current_pick') return 'Current pick';
  if (kind === 'future_pick') return 'Future pick';
  return 'Player';
}

function EvidenceFacts({ asset }: { asset: Asset }) {
  const evidence = asset.modelEvidence;
  if (evidence.kind === 'pick') {
    return (
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt>Cohort</dt>
          <dd className="font-semibold text-foreground">
            {evidence.cohort.observationCount} observations across{' '}
            {evidence.cohort.draftClassCount} draft classes
          </dd>
        </div>
        <div>
          <dt>Comparable picks</dt>
          <dd className="font-semibold text-foreground">
            Picks {evidence.cohort.minimumSelectionNumber}–
            {evidence.cohort.maximumSelectionNumber}
          </dd>
        </div>
        <div>
          <dt>Expected contribution</dt>
          <dd className="font-semibold text-foreground">
            {formatted(evidence.expected.contribution)} {evidence.valueUnit}
          </dd>
        </div>
        <div>
          <dt>Expected games</dt>
          <dd className="font-semibold text-foreground">
            {formatted(evidence.expected.games)} over {evidence.fixedHorizonSeasons} seasons
          </dd>
        </div>
      </dl>
    );
  }
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      <div>
        <dt>Observed games</dt>
        <dd className="font-semibold text-foreground">
          {formatted(evidence.totals.gamesPlayed)} across {evidence.seasons.length} seasons
        </dd>
      </div>
      <div>
        <dt>Observed contribution</dt>
        <dd className="font-semibold text-foreground">
          {formatted(evidence.totals.contribution)} fixed_horizon_pav
        </dd>
      </div>
      <div>
        <dt>Contribution per game</dt>
        <dd className="font-semibold text-foreground">
          {evidence.totals.contributionPerGame === null
            ? 'Unavailable'
            : formatted(evidence.totals.contributionPerGame)}
        </dd>
      </div>
      <div>
        <dt>Evidence cutoff</dt>
        <dd className="font-semibold text-foreground">{evidence.evidenceCutoffAt}</dd>
      </div>
    </dl>
  );
}

function Lineage({ asset }: { asset: Asset }) {
  const transformationsByTarget = new Map(
    asset.lineage.transformations.map((step) => [step.targetAssetId, step])
  );
  return (
    <ol className="space-y-0" aria-label={`${asset.label} transformation lineage`}>
      {asset.lineage.nodes.map((node, index) => {
        const transformation = transformationsByTarget.get(node.assetId);
        return (
          <li key={node.assetId} className="relative pl-6">
            {index < asset.lineage.nodes.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-[0.3rem] top-3 w-px bg-border"
              />
            ) : null}
            <span
              aria-hidden="true"
              className="absolute left-0 top-2 h-2.5 w-2.5 rounded-full border border-border bg-background"
            />
            <p className="pb-4">
              <span data-lineage-label className="block font-semibold text-foreground">
                {node.label}
              </span>
              <span className="block text-muted-foreground">
                {transformation === undefined
                  ? `${assetKind(asset.assetKind)} received`
                  : `${transformation.kind.replaceAll('_', ' ')} · ${transformation.effectiveAt}`}
              </span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function AssetRow({ asset, contribution }: { asset: Asset; contribution: Contribution }) {
  return (
    <li className="border-b border-border py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{asset.label}</p>
          <p className="text-xs text-muted-foreground">{assetKind(asset.assetKind)}</p>
        </div>
        <span className="shrink-0 font-semibold tabular-nums text-foreground">
          {signed(contribution.additiveMean)}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{contribution.story}</p>
      <details className="mt-1 text-xs text-muted-foreground">
        <summary className="min-h-10 cursor-pointer py-2 font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {asset.label} calculation and lineage
        </summary>
        <div className="space-y-4 border-t border-border pt-3">
          <p>{asset.story}</p>
          <EvidenceFacts asset={asset} />
          <div>
            <h5 className="mb-2 font-semibold text-foreground">What this asset became</h5>
            <Lineage asset={asset} />
          </div>
        </div>
      </details>
    </li>
  );
}

function AssetLedger({
  label,
  assetIds,
  subtotal,
  assetsById,
  view,
}: {
  label: 'Received' | 'Gave up';
  assetIds: readonly string[];
  subtotal: number;
  assetsById: ReadonlyMap<string, Asset>;
  view: View;
}) {
  return (
    <section aria-label={`${label} package`}>
      <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </h4>
      <ul className="mt-1">
        {assetIds.map((assetId) => {
          const asset = assetsById.get(assetId);
          const contribution = asset?.contributions.find((candidate) => candidate.view === view);
          if (asset === undefined || contribution === undefined) return null;
          return <AssetRow key={assetId} asset={asset} contribution={contribution} />;
        })}
      </ul>
      <p className="mt-2 text-right text-sm font-semibold tabular-nums text-foreground">
        {label} total {formatted(subtotal)}
      </p>
    </section>
  );
}

export function AflTradePackageEvaluationPanel({ narrative }: { narrative: Narrative }) {
  const [selectedView, setSelectedView] = useState<View>(narrative.defaultView);
  const view = narrative.views.find((candidate) => candidate.view === selectedView);
  const assetsById = new Map(narrative.assets.map((asset) => [asset.assetId, asset]));
  if (view === undefined) return null;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-background p-4">
        <label className="grid gap-1 text-sm font-semibold text-foreground sm:hidden">
          Valuation view
          <select
            value={selectedView}
            onChange={(event) => setSelectedView(event.target.value as View)}
            className="min-h-11 rounded-md border border-border bg-background px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {narrative.views.map((candidate) => (
              <option key={candidate.view} value={candidate.view}>
                {VIEW_LABELS[candidate.view]}
              </option>
            ))}
          </select>
        </label>
        <div
          role="group"
          aria-label="Trade valuation views"
          className="hidden grid-cols-4 gap-2 sm:grid"
        >
          {narrative.views.map((candidate) => (
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
        <p aria-live="polite" className="mt-3 text-sm leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground">{VIEW_LABELS[view.view]}:</span>{' '}
          {VIEW_DEFINITIONS[view.view]}
        </p>
      </div>

      <section aria-label={`${VIEW_LABELS[view.view]} club packages`} className="grid gap-4 xl:grid-cols-2">
        {view.clubs.map((club) => {
          const gradeLabel =
            club.grade.grade === null
              ? `${club.clubName} package grade unavailable`
              : `${club.clubName} ${club.grade.state} package grade ${club.grade.grade}`;
          return (
            <article
              key={club.aflClubId}
              aria-label={`${club.clubName} package`}
              className="overflow-hidden rounded-xl border border-border bg-background"
            >
              <header className="flex items-start justify-between gap-3 border-b border-border bg-muted/40 p-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{club.clubName}</h3>
                  <p className="text-xs text-muted-foreground">Complete club package</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-right">
                    <span className="block text-xs text-muted-foreground">Package net</span>
                    <span className="block font-semibold tabular-nums text-foreground">
                      {signed(club.arithmetic.estimatedAdvantageMean)}
                    </span>
                  </span>
                  <span
                    aria-label={gradeLabel}
                    className="inline-flex min-h-11 min-w-12 items-center justify-center rounded-lg border border-border bg-card px-2 text-base font-bold text-foreground"
                  >
                    {club.grade.grade ?? '—'}
                  </span>
                </div>
              </header>
              <div className="grid gap-5 p-4 lg:grid-cols-2">
                <AssetLedger
                  label="Received"
                  assetIds={club.receivedAssetIds}
                  subtotal={club.arithmetic.receivedMean}
                  assetsById={assetsById}
                  view={view.view}
                />
                <AssetLedger
                  label="Gave up"
                  assetIds={club.givenUpAssetIds}
                  subtotal={club.arithmetic.givenUpMean}
                  assetsById={assetsById}
                  view={view.view}
                />
              </div>
              <footer className="border-t border-border bg-muted/30 p-4">
                <p className="text-sm font-semibold text-foreground">{club.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Package range {formatted(club.uncertainty.p10)} to{' '}
                  {formatted(club.uncertainty.p90)} · finish-ahead probability{' '}
                  {Math.round(club.finishAheadProbability * 100)}%
                </p>
              </footer>
            </article>
          );
        })}
      </section>
    </div>
  );
}
