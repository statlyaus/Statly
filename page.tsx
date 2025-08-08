'use client';

import Link from 'next/link';
import { useAuth } from '@/AuthContext';

export default function DashboardPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="container mx-auto p-4 sm:p-6 lg:p-8" role="main" aria-busy="true">
        <h1 className="text-2xl font-bold">Loading your dashboard…</h1>
      </main>
    );
  }

  // If this page should only be visible to authenticated users,
  // you can either redirect here or show a CTA:
  if (!user) {
    return (
      <main className="container mx-auto p-4 sm:p-6 lg:p-8" role="main">
        <h1 className="text-3xl font-bold">You’re not signed in</h1>
        <p className="text-muted-foreground mt-2">Please sign in to view your dashboard.</p>
        <div className="mt-4">
          <Link
            href="/"
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Sign In
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto p-4 sm:p-6 lg:p-8" role="main">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">
          Welcome, {user.displayName || user.email || 'Player'}!
        </h1>
        <p className="text-lg text-muted-foreground mt-1">
          Here's your fantasy dashboard. Good luck this season!
        </p>
      </header>

      <section
        aria-label="Dashboard navigation cards"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        {/* My Team */}
        <article className="p-6 bg-card text-card-foreground shadow-md rounded-xl border border-border">
          <h2 className="text-xl font-bold mb-2">My Team</h2>
          <p className="text-muted-foreground mb-4">
            View and manage your drafted players.
          </p>
          <Link
            href="/team"
            className="inline-flex items-center font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5"
            aria-label="Go to My Team"
          >
            Go to My Team &rarr;
          </Link>
        </article>

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
      </section>
    </main>
  );
}
