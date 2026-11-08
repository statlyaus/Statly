import Link from 'next/link';

import type { MemberLeagueOption } from '@/server/leagues/memberLeagueOptions';

const actionClass =
  'inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Shown when a signed-in viewer opens a league they have no active team in. A league that does not
 * exist and a private league they cannot see render the same text, without the league's name, so
 * the page never confirms that a league exists. The server still refuses every league read.
 */
export function NotLeagueMember({ leagues }: { leagues: MemberLeagueOption[] }) {
  return (
    <div className="px-4 py-10">
      <section className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-6 text-card-foreground">
        <h1 className="text-xl font-semibold">You&apos;re not in this league</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This league isn&apos;t one of yours, or the link is out of date. Only a league&apos;s
          teams can see it.
        </p>

        {leagues.length > 0 ? (
          <div className="mt-6">
            <h2 className="text-sm font-semibold">Go to one of your leagues</h2>
            <ul
              aria-label="Your leagues"
              className="mt-2 divide-y divide-border rounded-lg border border-border"
            >
              {leagues.map((league) => (
                <li key={league.id}>
                  <Link
                    href={`/leagues/${encodeURIComponent(league.id)}`}
                    className="flex min-h-11 items-center px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {league.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Link
            href="/leagues"
            className={`${actionClass} mt-6 bg-primary text-primary-foreground`}
          >
            Go to your leagues
          </Link>
        )}

        <div className="mt-6 border-t border-border pt-5">
          <h2 className="text-sm font-semibold">Join or start a league</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask the commissioner for the league code, or set up a league of your own.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/leagues/join"
              className={`${actionClass} ${leagues.length > 0 ? 'bg-primary text-primary-foreground' : 'border border-border bg-background'}`}
            >
              Enter a league code
            </Link>
            <Link
              href="/leagues/new"
              className={`${actionClass} border border-border bg-background`}
            >
              Start a new league
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
