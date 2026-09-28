import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import {
  CategoryBoxScore,
  MatchupScoreLine,
  type BoxScoreCategory,
} from '@/components/scores/MatchupScore';
import { FANTASY_CATEGORIES, REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

export const metadata: Metadata = {
  title: 'Statly | AFL Draft & Trade Outcomes and Fantasy',
  description:
    'Explore public AFL draft and trade records, follow checked outcome publication status, or manage your Statly fantasy league.',
};

type PresetCategoryKey = (typeof REAL_DATA_NINE_CATEGORY_PRESET)[number];

/** Illustrative only: invented teams and numbers, captioned as an example on the page. */
const exampleMatchup = {
  home: 'Ball Magnets',
  away: 'Hard Ball Gets',
  values: {
    goals: [14, 11],
    tackles: [68, 74],
    inside50s: [52, 49],
    intercepts: [58, 63],
    contestedMarks: [12, 9],
    rebound50s: [38, 44],
    contestedPossessions: [146, 139],
    effectiveDisposals: [291, 302],
    scoreInvolvements: [97, 88],
  } satisfies Record<PresetCategoryKey, readonly [number, number]>,
};

const exampleCategories: BoxScoreCategory[] = REAL_DATA_NINE_CATEGORY_PRESET.map((key) => {
  const [home, away] = exampleMatchup.values[key];
  const category = FANTASY_CATEGORIES[key];
  return {
    key,
    label: category.label,
    shortLabel: category.shortLabel ?? category.label,
    result: home > away ? 'won' : home < away ? 'lost' : 'drawn',
    yourValue: home,
    opponentValue: away,
  };
});
const homeCategoriesWon = exampleCategories.filter((row) => row.result === 'won').length;
const awayCategoriesWon = exampleCategories.filter((row) => row.result === 'lost').length;

const seasonMoments = [
  { title: 'Draft night', modules: ['Draft room', 'Player research'] },
  { title: 'Selection week', modules: ['Rosters', 'Live scoring'] },
  { title: 'Market movement', modules: ['Waivers', 'Trades'] },
] as const;

const products = [
  {
    title: 'AFL Draft & Trade Outcomes',
    status: 'Numerical outcomes not published',
    description: 'Historical trade records and club movement.',
    href: '/draft/trades',
    action: 'Explore AFL trade archive',
    secondaryHref: '/draft/outcomes',
    secondaryAction: 'Outcome publication status',
  },
  {
    title: 'Statly Fantasy',
    status: null,
    description:
      'Category head-to-head leagues: drafts, lineups, waivers, trades, and live rounds.',
    href: '/dashboard',
    action: 'Open Fantasy Workspace',
    secondaryHref: null,
    secondaryAction: null,
  },
] as const;

const archiveOwnershipNote =
  'The AFL archive is public research. Its players, picks, and trades are not owned by Statly users or fantasy teams.';

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

function CardHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="border-b border-border px-4 py-3 font-display text-lg font-bold text-foreground sm:px-5"
    >
      {children}
    </h2>
  );
}

export default function HomePage(): ReactElement {
  return (
    <div className="bg-muted text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <header className="max-w-3xl">
          <h1 className="text-balance font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl">
            Explore AFL Draft &amp; Trade Outcomes. Run your fantasy league.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            {archiveOwnershipNote}
          </p>
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <section aria-labelledby="products-heading" className="flex flex-col gap-5">
            <h2 id="products-heading" className="sr-only">
              Statly products
            </h2>
            {products.map((product) => (
              <article
                key={product.title}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                <div className="px-4 py-4 sm:px-5">
                  <h3 className="font-display text-xl font-bold leading-tight text-foreground">
                    {product.title}
                  </h3>
                  {product.status ? (
                    <p className="mt-0.5 text-sm font-semibold text-muted-foreground">
                      {product.status}
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {product.description}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-muted px-4 py-3 sm:px-5">
                  <Link
                    href={product.href}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground transition hover:bg-brand-bar/90 ${focusRing}`}
                  >
                    {product.action}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  {product.secondaryHref && product.secondaryAction ? (
                    <Link
                      href={product.secondaryHref}
                      className={`inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-foreground underline decoration-muted-foreground/50 underline-offset-4 transition hover:decoration-foreground ${focusRing}`}
                    >
                      {product.secondaryAction}
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </section>

          <section
            aria-labelledby="matchup-heading"
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <CardHeading id="matchup-heading">Nine AFL stats decide every matchup</CardHeading>
            <div className="px-4 py-4 sm:px-5">
              <p className="text-sm text-muted-foreground">
                Each round you face one opponent across nine stats from real match data.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-semibold text-foreground">Example matchup</p>
                <p className="text-xs text-muted-foreground">
                  Invented teams, illustrative numbers
                </p>
              </div>
              <div className="mt-3">
                <MatchupScoreLine
                  you={{ teamName: exampleMatchup.home, logoUrl: null }}
                  opponent={{ teamName: exampleMatchup.away, logoUrl: null }}
                  yourWins={homeCategoriesWon}
                  opponentWins={awayCategoriesWon}
                  resultLine={`${exampleMatchup.home} win ${homeCategoriesWon}–${awayCategoriesWon}`}
                />
              </div>
              <div className="mt-4">
                <CategoryBoxScore
                  caption={`Example matchup box score, ${exampleMatchup.home} against ${exampleMatchup.away}`}
                  categories={exampleCategories}
                  yourLabel={<abbr title={exampleMatchup.home}>BM</abbr>}
                  opponentLabel={<abbr title={exampleMatchup.away}>HB</abbr>}
                />
              </div>
            </div>
            <p className="border-t border-border bg-muted px-4 py-3 text-xs text-muted-foreground sm:px-5">
              Default real-data preset. Commissioners configure scoring when they create a league.
            </p>
          </section>
        </div>

        <section
          id="league-workspace"
          aria-labelledby="modules-heading"
          className="overflow-hidden rounded-lg border border-border bg-card"
        >
          <CardHeading id="modules-heading">
            Draft night to the waiver run, in one league
          </CardHeading>
          <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {seasonMoments.map((moment) => (
              <div key={moment.title} className="px-4 py-4 sm:px-5">
                <h3 className="font-semibold text-foreground">{moment.title}</h3>
                <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
                  {moment.modules.map((module) => (
                    <li key={module}>{module}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
