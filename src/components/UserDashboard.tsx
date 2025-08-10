import Link from 'next/link';
import { useMemo } from 'react';
import type { User } from 'firebase/auth';
import WeekendSummary from './WeekendSummary';

interface UserDashboardProps {
  user: User;
}

export default function UserDashboard({ user }: UserDashboardProps) {
  const firstName = useMemo(() => {
    return (
      user.displayName?.trim().split(/\s+/)[0] ||
      user.email?.split("@")[0] ||
      "Player"
    );
  }, [user]);

  return (
    <main className="container mx-auto p-4 sm:p-6 lg:p-8" role="main">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">
          Welcome, {firstName}!
        </h1>
        <p className="text-lg text-muted-foreground mt-1">
          Here&apos;s your fantasy dashboard. Good luck this season!
        </p>
      </header>

      <section
        aria-label="Dashboard navigation cards"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        {/* Player Stats */}
        <article className="p-6 bg-card text-card-foreground shadow-md rounded-xl border border-border">
          <h2 className="text-xl font-bold mb-2">Player Stats</h2>
          <p className="text-muted-foreground mb-4">
            Browse stats for all available players in the league.
          </p>
          <Link
            href="/stats"
            className="inline-flex items-center font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5"
            aria-label="View All Stats"
          >
            View All Stats &rarr;
          </Link>
        </article>

        {/* Draft Room */}
        <article className="p-6 bg-card text-card-foreground shadow-md rounded-xl border border-border">
          <h2 className="text-xl font-bold mb-2">Draft Room</h2>
          <p className="text-muted-foreground mb-4">
            The draft is in progress! Go to the draft room to make your pick.
          </p>
          <Link
            href="/draft"
            className="inline-flex items-center font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5"
            aria-label="Enter Draft Room"
          >
            Enter Draft &rarr;
          </Link>
        </article>

        <WeekendSummary />
      </section>
    </main>
  );
}