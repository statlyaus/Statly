import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BasketballPageHeading } from '@/components/basketball/shell/BasketballPageHeading';
import {
  FORMAT_LABELS,
  PLATFORM_LABELS,
  basketballLeagueHref,
} from '@/components/basketball/shell/basketballFormat';
import { buttonStyles } from '@/components/ui/controlStyles';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { listBasketballLeagues } from '@/server/basketball/leagues/basketballLeagueQueries';
import { formatNbaSeason } from '@/types/basketball';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Fantasy basketball | Statly' };

const FEATURES = [
  {
    title: 'Players ranked on your categories',
    body: 'Per-game values for the categories your league counts, with punts left out.',
  },
  {
    title: "This week's matchup",
    body: 'Category-by-category projections and your chance of winning the week.',
  },
  {
    title: 'Pickups that help now',
    body: 'Free agents ranked by how many categories they swing this week.',
  },
];

/** No league → set-up prompt; one league → straight to it; several → choose one. */
export default async function BasketballHomePage() {
  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) redirect('/login?next=%2Fbasketball');
  const leagues = await listBasketballLeagues(userId);
  if (leagues.length === 1) redirect(basketballLeagueHref(leagues[0].id));

  if (leagues.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <BasketballPageHeading
          title="Fantasy basketball"
          description="Set up your NBA fantasy league once, and Statly ranks players on your categories, projects this week's matchup and finds pickups."
        />
        <ul className="grid gap-3 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">{feature.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{feature.body}</p>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link href="/basketball/new" className={buttonStyles({ variant: 'primary' })}>
            Set up your league
          </Link>
          <p className="text-sm text-muted-foreground">
            Takes about two minutes. Statly doesn&apos;t connect to Yahoo or ESPN: you enter your
            teams and rosters here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <BasketballPageHeading
        title="Fantasy basketball"
        description="Choose a league to open."
        action={
          <Link href="/basketball/new" className={buttonStyles({ variant: 'outline' })}>
            New league
          </Link>
        }
      />
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {leagues.map((league) => (
          <li key={league.id}>
            <Link
              href={basketballLeagueHref(league.id)}
              className="flex min-h-16 flex-col justify-center gap-0.5 px-4 py-3 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="truncate font-semibold text-foreground">{league.name}</span>
              <span className="text-sm text-muted-foreground">
                {[
                  league.myTeamName,
                  PLATFORM_LABELS[league.platform],
                  formatNbaSeason(league.season),
                  FORMAT_LABELS[league.format],
                ].join(' · ')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
