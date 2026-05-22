import type { Player } from '@/types/players';
import { getPlayers } from '@/lib/data';
import PlayersPageClient from './PlayersPageClient';
import { logger } from '@/lib/logger';
import { unstable_cache } from 'next/cache';
import type { JSX } from 'react';
import Link from 'next/link';

const getCachedPlayers = unstable_cache(() => getPlayers(), ['players:list:all'], {
  revalidate: 300,
  tags: ['players', 'players:list'],
});

export default async function PlayersPageServer(): Promise<JSX.Element> {
  let players: Player[] = [];
  try {
    players = await getCachedPlayers();
  } catch (err) {
    logger.error('Failed to fetch players', err);
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm"
        >
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Player Data
          </p>
          <h1 className="mt-3 text-2xl font-bold text-foreground">Player data could not load.</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Try again, or sign in to access your league-specific player view if this data requires
            your Statly account.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/players"
              className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Retry
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (players.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <section
          aria-live="polite"
          className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm"
        >
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Player Data
          </p>
          <h1 className="mt-3 text-2xl font-bold text-foreground">No players are available yet.</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Player data loaded successfully, but no player records were returned. Check back after
            the next data refresh or sign in for league-specific player tools.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/players"
              className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Refresh
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Open dashboard
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return <PlayersPageClient players={players} />;
}
