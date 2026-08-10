import type { Metadata } from 'next';
import Link from 'next/link';

import {
  draftHubHeaderKickerClass,
  draftHubHeroShellClass,
  draftHubHeroTopAccentClass,
  draftHubSectionPillClass,
  draftHubSubtlePanelClass,
} from '@/components/draft/draftHubChrome';
import { AFL_TRADE_PUBLIC_VALUE_SCOPE } from '@/server/aflTradeIntelligence/publication/publicationReadContracts';
import { getPublicAflTradeReadRuntime } from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';

export const metadata: Metadata = {
  title: 'AFL Trade Value Methodology | Statly',
  description:
    'How Statly plans to explain AFL trade value, uncertainty, source limitations, and unavailable results.',
};

const plannedViews = [
  {
    title: 'At the trade',
    description:
      'Assesses the decision using only evidence that was available when the trade occurred.',
  },
  {
    title: 'Realized outcome',
    description:
      'Describes contribution already delivered while each asset was in the receiving AFL club’s custody.',
  },
  {
    title: 'Remaining outcome',
    description:
      'Describes the uncertain future contribution still attached to active, supported assets.',
  },
  {
    title: 'Current outcome',
    description:
      'Combines realized and remaining outcomes under one approved, current model publication.',
  },
] as const;

const releaseRequirements = [
  'Permission for every required source and intended use',
  'Sufficient evidence with reconciled AFL identities and asset lineage',
  'A reproducible model that passes independent validation',
  'One version-consistent publication and public read boundary',
  'Responsive, accessible, and comprehensible product evidence',
] as const;

export default async function AflTradeMethodologyPage() {
  const { methodologyReadService } = await getPublicAflTradeReadRuntime();
  const response = await methodologyReadService.read({ scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE });
  const published = response.availability === 'published' ? response.methodology : null;
  const unavailableMessage = response.availability === 'unavailable' ? response.message : null;

  return (
    <div className="space-y-6">
      <section aria-labelledby="trade-methodology-heading" className={draftHubHeroShellClass}>
        <div className={draftHubHeroTopAccentClass} />
        <div className="relative max-w-4xl">
          <p className={draftHubHeaderKickerClass}>Methodology and current status</p>
          <h2
            id="trade-methodology-heading"
            className="mt-2 text-2xl font-semibold tracking-tight text-foreground md:text-3xl"
          >
            {published
              ? 'How Statly explains AFL trade value'
              : 'How Statly will explain AFL trade value'}
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
            {published
              ? `${published.primaryOutcome.definition} Calculations use model ${published.modelVersion} and evidence through ${published.calculationAsOf}.`
              : unavailableMessage}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className={draftHubSectionPillClass}>
              {published ? 'Published methodology' : 'Valuation not yet published'}
            </span>
            <Link
              href="/draft/trades"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Return to trade explorer
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="methodology-views-heading" className={draftHubSubtlePanelClass}>
        <div className="border-b border-border p-5 md:p-6">
          <p className={draftHubHeaderKickerClass}>Valuation views</p>
          <h3 id="methodology-views-heading" className="mt-2 text-xl font-semibold text-foreground">
            Four questions that must remain distinct
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            These views remain distinct in every publication. Their availability is determined by
            the exact active release selected above.
          </p>
        </div>
        <dl className="grid gap-3 p-5 sm:grid-cols-2 md:p-6">
          {plannedViews.map((view) => (
            <div key={view.title} className="rounded-xl border border-border bg-background p-4">
              <dt className="font-semibold text-foreground">{view.title}</dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">{view.description}</dd>
            </div>
          ))}
        </dl>
      </section>

      {published ? (
        <section
          aria-labelledby="published-methodology-heading"
          className={draftHubSubtlePanelClass}
        >
          <div className="border-b border-border p-5 md:p-6">
            <p className={draftHubHeaderKickerClass}>Active release</p>
            <h3
              id="published-methodology-heading"
              className="mt-2 text-xl font-semibold text-foreground"
            >
              {published.primaryOutcome.label}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Training seasons {published.trainingPeriod.firstSeason}–
              {published.trainingPeriod.lastSeason}. Value unit: {published.valueUnit.label}.
            </p>
          </div>
          <div className="grid gap-6 p-5 md:grid-cols-2 md:p-6">
            <div>
              <h4 className="font-semibold text-foreground">Model components</h4>
              <ul className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
                {published.components.map((component) => (
                  <li key={component.role}>
                    <span className="font-medium text-foreground">{component.modelVersion}:</span>{' '}
                    {component.summary}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-foreground">Known limitations</h4>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                {published.knownLimitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="methodology-interpretation-heading"
          className={draftHubSubtlePanelClass}
        >
          <div className="p-5 md:p-6">
            <p className={draftHubHeaderKickerClass}>Interpretation rules</p>
            <h3
              id="methodology-interpretation-heading"
              className="mt-2 text-xl font-semibold text-foreground"
            >
              Uncertainty is part of the answer
            </h3>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
              <li>
                A result must identify its time perspective, supported scope, exclusions, and
                evidence cutoff.
              </li>
              <li>
                Ranges and practical equivalence must be shown instead of forcing a winner when the
                evidence cannot separate the outcomes.
              </li>
              <li>
                Contributions must follow real AFL club custody and asset lineage without counting
                an ancestor and successor twice.
              </li>
              <li>
                An unavailable result is preferable to a value that is unsupported, misleading, or
                irreproducible.
              </li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="methodology-grades-heading" className={draftHubSubtlePanelClass}>
          <div className="p-5 md:p-6">
            <p className={draftHubHeaderKickerClass}>Statly grades</p>
            <h3
              id="methodology-grades-heading"
              className="mt-2 text-xl font-semibold text-foreground"
            >
              How Statly assigns a grade
            </h3>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Grades run from A+ to D and summarize each club&apos;s position in the validated trade
              outcome distribution. They use an equal-party baseline and account for outcomes that
              are practically indistinguishable instead of forcing a winner.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              At-trade and current grades remain separate. Coverage below 70% produces Grade
              unavailable; partial, stale, retained, or low-confidence evidence produces a clearly
              labelled provisional grade.
            </p>
          </div>
        </section>
      </div>

      <section aria-labelledby="methodology-release-heading" className={draftHubSubtlePanelClass}>
        <div className="p-5 md:p-6">
          <p className={draftHubHeaderKickerClass}>Before any numerical release</p>
          <h3
            id="methodology-release-heading"
            className="mt-2 text-xl font-semibold text-foreground"
          >
            Evidence and approval must precede publication
          </h3>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {releaseRequirements.map((requirement, index) => (
              <li
                key={requirement}
                className="rounded-xl border border-border bg-background p-4 text-sm leading-6 text-muted-foreground"
              >
                <span className="mb-2 block font-semibold text-foreground">Step {index + 1}</span>
                {requirement}
              </li>
            ))}
          </ol>
          <p className="mt-5 max-w-4xl text-sm leading-6 text-muted-foreground">
            {published
              ? 'This page is bound to the exact active publication-specific methodology and its stated limitations.'
              : 'These are the general product rules. A numerical result appears only after its sourced facts, model version, validation evidence, and methodology are reviewed and activated together.'}
          </p>
        </div>
      </section>
    </div>
  );
}
