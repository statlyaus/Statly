import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'AFL Draft & Trade Outcome Check Methodology | Statly',
  description:
    'How Statly reconciles recorded AFL draft and trade outcomes with independently observed evidence and reviewed releases.',
};

const checkStates = [
  {
    title: 'Matches source',
    description:
      'Recorded and independently observed values are equal after player identity, metric definition, competition, club scope, and effective-through date all match.',
  },
  {
    title: 'Difference found',
    description:
      'The two approved observations cover the same scope but produce different totals. Both values and the delta remain visible for review.',
  },
  {
    title: 'Partial coverage',
    description:
      'A value is available for only part of the required seasons or custody window. Statly shows the coverage ratio and does not promote it to a complete total.',
  },
  {
    title: 'Recorded or observed only',
    description:
      'Only one side of the comparison is available. The number may be displayed as evidence, but it is not labelled as independently checked.',
  },
  {
    title: 'Not checked',
    description:
      'Identity, rights, scope, source, or release evidence is missing. The value stays unavailable rather than becoming zero.',
  },
];

export default function AflDraftTradeOutcomeMethodologyPage() {
  return (
    <div className="space-y-8" aria-labelledby="outcome-methodology-heading">
      <section className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Factual outcomes · release status
        </p>
        <h2
          id="outcome-methodology-heading"
          className="mt-2 text-3xl font-bold tracking-tight text-foreground"
        >
          How Statly checks AFL Draft &amp; Trade outcomes
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base">
          Outcome checks compare source-grain facts; they are not Statly trade-value estimates. A
          public result must bind one canonical AFL player, one acquisition or asset, one metric
          definition, one club-custody scope, exact source evidence, and one reviewed factual
          release.
        </p>
        <div className="mt-5 inline-flex rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-foreground">
          Release status is shown on every outcome response
        </div>
      </section>

      <section aria-labelledby="check-state-heading">
        <h2 id="check-state-heading" className="text-2xl font-bold text-foreground">
          What each check label means
        </h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {checkStates.map((state) => (
            <article
              key={state.title}
              className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm"
            >
              <h3 className="font-semibold text-foreground">{state.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{state.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="source-boundary-heading"
        className="rounded-2xl border border-border bg-muted/35 p-6 sm:p-8"
      >
        <h2 id="source-boundary-heading" className="text-2xl font-bold text-foreground">
          Source, fitzRoy, and database roles
        </h2>
        <div className="mt-4 grid gap-5 text-sm leading-7 text-muted-foreground lg:grid-cols-3">
          <div>
            <h3 className="font-semibold text-foreground">Transaction and draft sources</h3>
            <p className="mt-1">
              Captured Draftguru, Footywire and official AFL pages provide source-native claims.
              Every response is retained immutably and reconciled field by field before publication.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground">fitzRoy</h3>
            <p className="mt-1">
              A technical R adapter to named upstream sources. Every snapshot must retain the
              selected provider, package version, parameters, retrieval time, checksum, and rights
              decision.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Reviewed releases</h3>
            <p className="mt-1">
              Normalized facts belong in the isolated public analytical PostgreSQL domain. Public
              reads select one exact approved release; staging rows and partial imports never leak.
            </p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="ownership-heading"
        className="rounded-xl border border-border bg-card p-6 text-card-foreground"
      >
        <h2 id="ownership-heading" className="text-xl font-semibold text-foreground">
          Separate from Statly Fantasy
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          These are public AFL players, clubs, transactions, and assets. They are not owned by
          Statly users, fantasy teams, leagues, rosters, or members. A factual outcome release is
          also independent of any model-based trade-value publication.
        </p>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/draft/outcomes"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Return to outcome checks
        </Link>
        <Link
          href="/draft/trades/methodology"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Read trade-value methodology
        </Link>
      </div>
    </div>
  );
}
