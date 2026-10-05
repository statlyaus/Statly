import type {
  AnyLocalPrivateTradeEvaluationGeneration,
  LocalPrivateTradeEvaluationGeneration,
} from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationContracts';
import type { LocalPrivateTradeEvaluationGenerationV2 } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationGenerationV2';

type Asset = LocalPrivateTradeEvaluationGeneration['content']['assets'][number];
type View = Asset['views']['current'];

const VIEW_LABELS = {
  atTrade: 'At trade',
  realized: 'Realized',
  remaining: 'Remaining',
  current: 'Current',
} as const;

const VIEW_DESCRIPTIONS = {
  atTrade: 'What the asset was worth using information available when the trade occurred.',
  realized: 'Confirmed contribution observed after the trade.',
  remaining: 'Forecast contribution still expected after the current cutoff.',
  current: 'Realized contribution plus remaining forecast value.',
} as const;

function format(value: number): string {
  return value.toFixed(2);
}

function explain(reason: string): string {
  const explanations: Record<string, string> = {
    source_rights_not_approved:
      'The at-trade source and its calculation use have not been approved for this private lane.',
    gate_3_model_run_not_approved:
      'The required model run has not received current Gate 3 approval.',
    historical_value_model_not_authorized:
      'No authorized point-in-time model exists for this at-trade value.',
    selection_value_model_not_authorized:
      'No authorized pick distribution exists for this at-trade value.',
    predictive_model_not_authorized:
      'No authorized remaining-value model exists, so no forecast or current total is shown.',
    pick_selection_not_confirmed:
      'The recorded pick settlement still requires canonical realization; operator confirmation is the next gate before selected-player value can be attached.',
    canonical_pick_realization_unavailable:
      'The selection is confirmed, but the traded entitlement is not yet linked to one canonical pick realization.',
    fixed_horizon_pick_outcome_unavailable:
      'The canonical pick realization exists, but its fixed-horizon player outcome has not been sealed.',
    calculation_evidence_incomplete:
      'The exact reviewed calculation evidence is incomplete for this asset.',
    asset_values_incomplete:
      'At least one asset or required view is unavailable, so an overall grade would be misleading.',
  };
  return explanations[reason] ?? reason.replaceAll('_', ' ');
}

function ViewCard({ name, view }: { name: keyof typeof VIEW_LABELS; view: View }) {
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{VIEW_LABELS[name]}</h4>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {VIEW_DESCRIPTIONS[name]}
          </p>
        </div>
        {view.state === 'calculated' ? (
          <p className="shrink-0 text-right">
            <span className="block text-xs text-muted-foreground">Season PAV</span>
            <span className="block text-xl font-bold tabular-nums text-foreground">
              {format(view.score)}
            </span>
          </p>
        ) : (
          <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            Unavailable
          </span>
        )}
      </div>

      {view.state === 'calculated' ? (
        <>
          {view.components ? (
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Offence</dt>
                <dd className="mt-1 font-semibold tabular-nums text-foreground">
                  {format(view.components.offensivePav)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Midfield</dt>
                <dd className="mt-1 font-semibold tabular-nums text-foreground">
                  {format(view.components.midfieldPav)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Defence</dt>
                <dd className="mt-1 font-semibold tabular-nums text-foreground">
                  {format(view.components.defensivePav)}
                </dd>
              </div>
            </dl>
          ) : null}
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="min-h-10 cursor-pointer py-2 font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Evidence details
            </summary>
            <p className="border-t border-border pt-3">
              {view.evidenceRefs.length} immutable evidence artifact
              {view.evidenceRefs.length === 1 ? '' : 's'}.
            </p>
          </details>
        </>
      ) : (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
          {view.reasons.map((reason) => (
            <li key={reason}>{explain(reason)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AssetCard({ asset }: { asset: Asset }) {
  const calculatedViews = Object.values(asset.views).filter(
    ({ state }) => state === 'calculated'
  ).length;
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-background">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/40 p-4">
        <div>
          <h3 className="font-semibold text-foreground">{asset.label}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {asset.assetKind.replaceAll('_', ' ')} · received by {asset.receivingClubId}
          </p>
        </div>
        <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground">
          {calculatedViews} of 4 views calculated
        </span>
      </header>
      <div className="border-b border-border px-4 py-3 text-sm">
        {asset.appearances.state === 'observed' ? (
          <p className="font-semibold tabular-nums text-foreground">
            {asset.appearances.gamesPlayed} confirmed games
            <span className="ml-2 font-normal text-muted-foreground">
              through {asset.appearances.effectiveThroughSeason}
              {asset.appearances.coverage === 'right_censored' ? ' · season still in progress' : ''}
            </span>
          </p>
        ) : (
          <p className="text-muted-foreground">Confirmed appearance count unavailable.</p>
        )}
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        {(Object.keys(VIEW_LABELS) as Array<keyof typeof VIEW_LABELS>).map((name) => (
          <ViewCard key={name} name={name} view={asset.views[name]} />
        ))}
      </div>
    </li>
  );
}

function V1GenerationPanel({
  generation,
}: {
  generation: LocalPrivateTradeEvaluationGeneration;
}) {
  return (
    <section
      aria-labelledby="private-evaluation-generation-heading"
      className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2
            id="private-evaluation-generation-heading"
            className="text-xl font-semibold text-foreground"
          >
            Confirmed asset evaluation
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Each asset shows the four values required for a trade grade. Confirmed numbers appear
            beside the asset that produced them; missing authority stays visible instead of becoming
            zero.
          </p>
        </div>
        <span className="rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-foreground">
          Immutable local generation
        </span>
      </div>

      <ul className="mt-5 grid gap-4">
        {generation.content.assets.map((asset) => (
          <AssetCard key={asset.assetId} asset={asset} />
        ))}
      </ul>

      <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground">
          Overall trade grade:{' '}
          {generation.content.overallGrade.state === 'calculated'
            ? generation.content.overallGrade.grade
            : 'unavailable'}
        </p>
        {generation.content.overallGrade.state === 'unavailable' ? (
          <ul className="mt-1 space-y-1">
            {generation.content.overallGrade.reasons.map((reason) => (
              <li key={reason}>{explain(reason)}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 tabular-nums">
            Expected net {format(generation.content.overallGrade.expectedNet)}.
          </p>
        )}
      </div>

      <details className="mt-4 rounded-lg border border-border bg-background p-4 text-xs text-muted-foreground">
        <summary className="min-h-10 cursor-pointer py-2 font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Generation identity and limits
        </summary>
        <div className="space-y-2 border-t border-border pt-3 leading-5">
          <p>{generation.content.limitation}</p>
          <p className="break-all font-mono">{generation.generationId}</p>
          <p>{generation.content.dependencyRefs.length} exact dependency artifacts.</p>
        </div>
      </details>
    </section>
  );
}

type V2Asset = LocalPrivateTradeEvaluationGenerationV2['content']['assets'][number];
type V2View = V2Asset['views']['current'];

function clubLabel(clubId: string): string {
  return clubId
    .replace(/^local-afl-club:/u, '')
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatEvidenceDate(value: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Melbourne',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function V2ViewCard({ name, view }: { name: keyof typeof VIEW_LABELS; view: V2View }) {
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{VIEW_LABELS[name]}</h4>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {VIEW_DESCRIPTIONS[name]}
          </p>
        </div>
        {view.state === 'calculated' ? (
          <p className="shrink-0 text-right">
            <span className="block text-xs text-muted-foreground">Mean value</span>
            <span className="block text-xl font-bold tabular-nums text-foreground">
              {format(view.score)}
            </span>
          </p>
        ) : (
          <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            Unavailable
          </span>
        )}
      </div>

      {view.state === 'calculated' ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Median</dt>
              <dd className="mt-1 font-semibold tabular-nums text-foreground">
                {format(view.distribution.median)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">P10–P90 range</dt>
              <dd className="mt-1 font-semibold tabular-nums text-foreground">
                {format(view.distribution.p10)}–{format(view.distribution.p90)}
              </dd>
            </div>
          </dl>
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="min-h-10 cursor-pointer py-2 font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Components and evidence
            </summary>
            <dl className="space-y-2 border-t border-border pt-3">
              {view.components.map((component) => (
                <div key={component.componentId} className="flex justify-between gap-3">
                  <dt>{component.label}</dt>
                  <dd className="font-semibold tabular-nums text-foreground">
                    {format(component.score)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3">
              {view.evidenceRefs.length} evidence and {view.calculationRefs.length} calculation
              artifact{view.evidenceRefs.length + view.calculationRefs.length === 1 ? '' : 's'}.
            </p>
          </details>
        </>
      ) : (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
          {view.reasons.map((reason) => (
            <li key={reason}>{explain(reason)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function V2AssetCard({ asset }: { asset: V2Asset }) {
  const calculatedViews = Object.values(asset.views).filter(
    ({ state }) => state === 'calculated'
  ).length;
  const latestHorizon = asset.evidenceHorizons.at(-1);
  const totalGames = asset.evidenceHorizons.reduce(
    (sum, horizon) => sum + horizon.gamesPlayed,
    0
  );
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-background">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/40 p-4">
        <div>
          <h3 className="font-semibold text-foreground">{asset.label}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {asset.assetKind.replaceAll('_', ' ')} · {clubLabel(asset.sendingClubId)} to{' '}
            {clubLabel(asset.receivingClubId)}
          </p>
        </div>
        <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground">
          {calculatedViews} of 4 views calculated
        </span>
      </header>
      <div className="border-b border-border px-4 py-3 text-sm">
        {latestHorizon ? (
          <p className="font-semibold tabular-nums text-foreground">
            {totalGames} confirmed appearances through{' '}
            {formatEvidenceDate(latestHorizon.effectiveThrough)}
            {latestHorizon.kind === 'current_season' &&
            latestHorizon.coverage === 'right_censored' ? (
              <span className="ml-2 font-normal text-muted-foreground">· right-censored</span>
            ) : null}
          </p>
        ) : (
          <p className="text-muted-foreground">Confirmed evidence horizon unavailable.</p>
        )}
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        {(Object.keys(VIEW_LABELS) as Array<keyof typeof VIEW_LABELS>).map((name) => (
          <V2ViewCard key={name} name={name} view={asset.views[name]} />
        ))}
      </div>
    </li>
  );
}

function V2GenerationPanel({
  generation,
}: {
  generation: LocalPrivateTradeEvaluationGenerationV2;
}) {
  const currentTotals = new Map(
    generation.content.clubTotals.map((club) => [club.clubId, club.views.current] as const)
  );
  return (
    <section
      aria-labelledby="private-evaluation-generation-heading"
      className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2
            id="private-evaluation-generation-heading"
            className="text-xl font-semibold text-foreground"
          >
            Confirmed asset evaluation
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Governed player and pick evidence is shown across all four valuation views. Means,
            uncertainty ranges, and club grades resolve from this same immutable local generation.
          </p>
        </div>
        <span className="rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-foreground">
          Private · non-production
        </span>
      </div>

      <ul className="mt-5 grid gap-4">
        {generation.content.assets.map((asset) => (
          <V2AssetCard key={asset.assetId} asset={asset} />
        ))}
      </ul>

      <section aria-labelledby="club-grade-heading" className="mt-5">
        <h3 id="club-grade-heading" className="text-base font-semibold text-foreground">
          Club totals and overall grades
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {generation.content.overallGrades.map((grade) => {
            const current = currentTotals.get(grade.clubId);
            return (
              <article key={grade.clubId} className="rounded-lg border border-border bg-background p-4">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="font-semibold text-foreground">{clubLabel(grade.clubId)}</h4>
                  {grade.state === 'unavailable' ? (
                    <span className="text-xs font-semibold text-muted-foreground">Unavailable</span>
                  ) : (
                    <span className="text-sm font-bold text-foreground">
                      {grade.state === 'provisional' ? 'Provisional ' : ''}
                      {grade.grade}
                    </span>
                  )}
                </div>
                {current?.state === 'calculated' ? (
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Received</dt>
                      <dd className="mt-1 font-semibold tabular-nums text-foreground">
                        {format(current.received.score)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Given up</dt>
                      <dd className="mt-1 font-semibold tabular-nums text-foreground">
                        {format(current.givenUp.score)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Net</dt>
                      <dd className="mt-1 font-semibold tabular-nums text-foreground">
                        {format(current.net.score)}
                      </dd>
                    </div>
                  </dl>
                ) : null}
                {grade.state === 'unavailable' ? (
                  <ul className="mt-2 text-sm text-muted-foreground">
                    {grade.reasons.map((reason) => (
                      <li key={reason}>{explain(reason)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                    {(grade.finishesAheadProbability * 100).toFixed(1)}% finish-ahead probability
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4 text-sm leading-6">
        {generation.content.tradeVerdict.state === 'calculated' ? (
          <p className="font-semibold text-foreground">
            Verdict:{' '}
            {generation.content.tradeVerdict.kind === 'favours_club' ? 'favours ' : 'shared by '}
            {generation.content.tradeVerdict.clubIds.map(clubLabel).join(' and ')}
          </p>
        ) : (
          <p className="font-semibold text-muted-foreground">Trade verdict unavailable.</p>
        )}
      </div>

      <details className="mt-4 rounded-lg border border-border bg-background p-4 text-xs text-muted-foreground">
        <summary className="min-h-10 cursor-pointer py-2 font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Generation identity and limits
        </summary>
        <div className="space-y-2 border-t border-border pt-3 leading-5">
          <p>{generation.content.limitation}</p>
          <p className="break-all font-mono">{generation.generationId}</p>
          <p>{generation.content.dependencyRefs.length} exact dependency artifacts.</p>
        </div>
      </details>
    </section>
  );
}

export function LocalPrivateTradeEvaluationGenerationPanel({
  generation,
}: {
  generation: AnyLocalPrivateTradeEvaluationGeneration;
}) {
  return generation.content.schemaVersion === 'local-private-trade-evaluation-generation/v2' ? (
    <V2GenerationPanel generation={generation as LocalPrivateTradeEvaluationGenerationV2} />
  ) : (
    <V1GenerationPanel generation={generation as LocalPrivateTradeEvaluationGeneration} />
  );
}
