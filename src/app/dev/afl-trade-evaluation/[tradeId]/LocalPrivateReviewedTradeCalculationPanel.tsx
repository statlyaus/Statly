import type {
  LocalPrivateReviewedTradeAssetCalculation,
  LocalPrivateReviewedTradeCalculation,
} from '@/server/aflTradeIntelligence/development/localPrivateReviewedTradeCalculation';

type CalculatedAsset = Extract<
  LocalPrivateReviewedTradeAssetCalculation,
  { state: 'calculated' }
>;
type CalculationView = CalculatedAsset['realized'];

const VIEW_LABELS = {
  atTrade: 'At trade',
  realized: 'Realized',
  remaining: 'Remaining',
  current: 'Current',
} as const;

const VIEW_DESCRIPTIONS = {
  atTrade: 'Historical value requires an authorized point-in-time valuation model.',
  realized: 'Reviewed post-trade seasons for the receiving club.',
  remaining: 'Future value requires an authorized predictive model.',
  current: 'Current value requires realized plus an authorized remaining-value model.',
} as const;

function format(value: number): string {
  return value.toFixed(2);
}

function unavailableReason(reason: string): string {
  const explanations: Record<string, string> = {
    reviewed_season_unavailable: 'No reviewed pre-trade season is loaded for this player.',
    historical_value_model_not_authorized:
      'No authorized point-in-time valuation model exists for at-trade value.',
    post_trade_season_unavailable: 'No full reviewed post-trade league season is loaded yet.',
    no_reviewed_receiving_club_allocation:
      'The reviewed seasons contain no allocation for this player at the receiving club.',
    reviewed_acquisition_spell_unavailable:
      'A current approved acquisition spell and its exact reviewed player-match set are required before realized PAV can be attributed.',
    reviewed_acquisition_spell_allocation_mismatch:
      'The HPN player-match rows do not reconcile to the exact reviewed post-acquisition set, so realized PAV is unavailable.',
    selection_value_model_not_authorized:
      'Expected selection value requires an authorized pick model; it is not inferred from the eventual player.',
    predictive_model_not_authorized:
      'No authorized predictive model exists for remaining value.',
    player_identity_unavailable:
      'The workbook player name has no exact reviewed player identity.',
    player_identity_ambiguous:
      'The workbook player name maps to more than one reviewed identity.',
    selection_lineage_not_reviewed:
      'Pick selection lineage has not been reviewed, so no player value is attached.',
    asset_kind_unsupported: 'This asset kind is not supported by the reviewed calculation.',
  };
  return explanations[reason] ?? reason.replaceAll('_', ' ');
}

function ViewSummary({
  name,
  view,
  description,
}: {
  name: keyof typeof VIEW_LABELS;
  view: CalculationView;
  description?: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{VIEW_LABELS[name]}</h4>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description ?? VIEW_DESCRIPTIONS[name]}
          </p>
        </div>
        {view.state === 'available' ? (
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

      {view.state === 'available' ? (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
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
          <p className="mt-3 text-xs text-muted-foreground">
            {view.gamesPlayed} games · season{view.seasons.length === 1 ? '' : 's'}{' '}
            {view.seasons.join(', ')}
          </p>
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="min-h-10 cursor-pointer py-2 font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Raw component scores and evidence
            </summary>
            <dl className="grid gap-2 border-t border-border pt-3 sm:grid-cols-3">
              <div>
                <dt>Offensive score</dt>
                <dd className="font-semibold tabular-nums text-foreground">
                  {format(view.components.offensiveScore)}
                </dd>
              </div>
              <div>
                <dt>Midfield score</dt>
                <dd className="font-semibold tabular-nums text-foreground">
                  {format(view.components.midfieldScore)}
                </dd>
              </div>
              <div>
                <dt>Defensive score</dt>
                <dd className="font-semibold tabular-nums text-foreground">
                  {format(view.components.defensiveScore)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 break-all font-mono">
              {view.calculationIds.length} authenticated calculation
              {view.calculationIds.length === 1 ? ' artifact' : ' artifacts'}
              {view.allocationIds.length > 0
                ? ` · ${view.allocationIds.length} allocation${
                    view.allocationIds.length === 1 ? '' : 's'
                  }`
                : ''}
            </p>
          </details>
        </>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {unavailableReason(view.reason)}
        </p>
      )}
    </section>
  );
}

function AssetCalculation({ asset }: { asset: LocalPrivateReviewedTradeAssetCalculation }) {
  if (asset.state === 'unavailable') {
    return (
      <li className="rounded-xl border border-border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">{asset.asset.assetText}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {asset.asset.clubName} · {asset.asset.assetType.replaceAll('_', ' ')}
            </p>
          </div>
          <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            No confirmed score
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {unavailableReason(asset.reason)}
        </p>
      </li>
    );
  }

  const isReviewedSelection =
    asset.asset.assetType === 'pick' && asset.selectionLineageDecisionId !== undefined;
  const pickDescriptions = {
    atTrade: 'Expected value at the selection requires an authorized pick model.',
    realized: 'Reviewed contribution by the selected player after the draft.',
    remaining: 'Future contribution requires an authorized predictive model.',
    current: 'Current value requires realized plus an authorized remaining-value model.',
  } as const;
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-background">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/40 p-4">
        <div>
          <h3 className="font-semibold text-foreground">{asset.asset.assetText}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {isReviewedSelection ? (
              <>
                Selection #{asset.asset.pick.numberActual} · {asset.asset.draftedPlayer}
              </>
            ) : (
              <>Received by {asset.asset.clubName} · exact reviewed player identity</>
            )}
          </p>
        </div>
        <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground">
          {isReviewedSelection ? 'Selected player PAV' : 'Historical PAV'}
        </span>
      </header>
      {isReviewedSelection ? (
        <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
          Realized values use the selected player&apos;s confirmed HPN contribution for{' '}
          {asset.asset.clubName}; they do not reconstruct an at-trade pick forecast.
        </p>
      ) : asset.postTradeGames.state === 'unavailable' ? (
        <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
          Confirmed post-trade games are not available from the reviewed acquisition-spell evidence.
        </p>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <p className="font-semibold tabular-nums text-foreground">
            {asset.postTradeGames.gamesPlayed} confirmed post-trade games
          </p>
          <p className="text-xs text-muted-foreground">
            {asset.postTradeGames.effectiveThroughSeason === undefined
              ? `Through ${asset.postTradeGames.effectiveThrough.slice(0, 10)}`
              : `Reviewed through ${asset.postTradeGames.effectiveThroughSeason} season`}
            {asset.postTradeGames.rightCensored
              ? ' · active spell, later games not included'
              : ''}
          </p>
        </div>
      )}
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <ViewSummary
          name="atTrade"
          view={asset.atTrade}
          description={isReviewedSelection ? pickDescriptions.atTrade : undefined}
        />
        <ViewSummary
          name="realized"
          view={asset.realized}
          description={isReviewedSelection ? pickDescriptions.realized : undefined}
        />
        <ViewSummary
          name="remaining"
          view={asset.remaining}
          description={isReviewedSelection ? pickDescriptions.remaining : undefined}
        />
        <ViewSummary
          name="current"
          view={asset.current}
          description={isReviewedSelection ? pickDescriptions.current : undefined}
        />
      </div>
    </li>
  );
}

export function LocalPrivateReviewedTradeCalculationPanel({
  calculation,
}: {
  calculation: LocalPrivateReviewedTradeCalculation;
}) {
  const calculatedAssets = calculation.assets.filter(({ state }) => state === 'calculated').length;
  return (
    <section
      aria-labelledby="private-reviewed-calculation-heading"
      className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2
            id="private-reviewed-calculation-heading"
            className="text-xl font-semibold text-foreground"
          >
            Confirmed realized asset calculation
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Real HPN season PAV calculated from reviewed local match rows. Player assets use their
            reviewed identity; reviewed picks use the eventual selected player. These are historical
            contribution values, not forecasts or trade grades.
          </p>
        </div>
        <span className="rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-foreground">
          {calculatedAssets} of {calculation.assets.length} assets linked
        </span>
      </div>

      <ul className="mt-5 grid gap-4">
        {calculation.assets.map((asset) => (
          <AssetCalculation key={asset.asset.id} asset={asset} />
        ))}
      </ul>

      <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground">Overall trade grade: unavailable</p>
        <p className="mt-1">
          A letter grade requires complete values for every player and pick plus an authenticated
          comparison distribution. No grade is inferred from partial historical PAV.
        </p>
      </div>

      <details className="mt-4 rounded-lg border border-border bg-background p-4 text-xs text-muted-foreground">
        <summary className="min-h-10 cursor-pointer py-2 font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Calculation method and limits
        </summary>
        <div className="space-y-2 border-t border-border pt-3 leading-5">
          <p>{calculation.limitation}</p>
          <p>
            Value unit: season PAV. The repository formula is explicit, but its original published
            source bytes were not independently recaptured in this rehearsal.
          </p>
          <p className="break-all font-mono">{calculation.projectionId}</p>
        </div>
      </details>
    </section>
  );
}
