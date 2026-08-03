import type { Metadata } from 'next';
import Link from 'next/link';

import {
  draftHubHeaderKickerClass,
  draftHubHeroShellClass,
  draftHubHeroTopAccentClass,
  draftHubSectionPillClass,
  draftHubSubtlePanelClass,
} from '@/components/draft/draftHubChrome';

export const metadata: Metadata = {
  title: 'AFL Trade Value Methodology | Statly',
  description:
    'How Statly plans to explain AFL trade value, uncertainty, source limitations, and unavailable results.',
};

const plannedViews = [
  {
    title: 'At the trade',
    description:
      'Would assess the decision using only evidence that was available when the trade occurred.',
  },
  {
    title: 'Realized outcome',
    description:
      'Would describe contribution already delivered while each asset was in the receiving AFL club’s custody.',
  },
  {
    title: 'Remaining outcome',
    description:
      'Would describe the uncertain future contribution still attached to active, supported assets.',
  },
  {
    title: 'Current outcome',
    description:
      'Would combine realized and remaining outcomes under one approved, current model publication.',
  },
] as const;

const releaseRequirements = [
  'Permission for every required source and intended use',
  'Sufficient evidence with reconciled AFL identities and asset lineage',
  'A reproducible model that passes independent validation',
  'One version-consistent publication and public read boundary',
  'Responsive, accessible, and comprehensible product evidence',
] as const;

export default function AflTradeMethodologyPage() {
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
            How Statly intends to explain AFL trade value
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
            The historical archive is available, but Statly trade-value calculations are not. The
            additional evidence needed to calculate and publish them has not been approved for that
            use. No model result, estimated winner, or release date should be inferred from this
            page.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className={draftHubSectionPillClass}>Valuation unavailable</span>
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
          <p className={draftHubHeaderKickerClass}>Planned views</p>
          <h3 id="methodology-views-heading" className="mt-2 text-xl font-semibold text-foreground">
            Four questions that must remain distinct
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            These views describe the intended product contract. They are not calculations that are
            currently operating.
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

        <section aria-labelledby="methodology-legacy-heading" className={draftHubSubtlePanelClass}>
          <div className="p-5 md:p-6">
            <p className={draftHubHeaderKickerClass}>Legacy archive fields</p>
            <h3
              id="methodology-legacy-heading"
              className="mt-2 text-xl font-semibold text-foreground"
            >
              Expected and Actual are not Statly trade value
            </h3>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              The archive preserves imported fields labelled Expected and Actual. Their original
              source definition and methodology have not been verified by Statly. The stored values
              remain unchanged, but they must not be interpreted as Statly estimates, fairness
              scores, or conclusions about which AFL club won a trade.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              A dash means the imported archive did not record a value; it does not mean zero.
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
            This page records general product rules, not an approved model methodology. If a
            numerical publication is later approved, each result must link to the exact
            publication-specific methodology and limitations used to produce it.
          </p>
        </div>
      </section>
    </div>
  );
}
