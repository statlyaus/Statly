import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { loadAuthorizedLeagueDetail } from '@/server/leagues/leagueDetail';

import SocialPageClient from './SocialPageClient';

export const dynamic = 'force-dynamic';

export default async function LeagueSocialPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; post?: string }>;
}) {
  const [{ id }, query, userId] = await Promise.all([
    params,
    searchParams,
    getAuthenticatedUserIdFromServerContext(),
  ]);
  if (!userId) redirect(`/login?next=${encodeURIComponent(`/leagues/${id}/social`)}`);

  const result = await loadAuthorizedLeagueDetail(id, userId);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
        <main className="min-h-screen bg-background px-4 py-10 text-foreground">
          <section className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-6 text-center">
            <h1 className="text-xl font-semibold">League social is unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You must be a current league member to view chat or message-board content.
            </p>
            <Link
              href="/leagues"
              className="mt-5 inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View your leagues
            </Link>
          </section>
        </main>
    );
  }
  if (!result.league) notFound();

  return (
    <SocialPageClient
      leagueId={id}
      leagueName={result.league.name}
      userId={userId}
      initialView={
        query.view === 'board' || query.view === 'activity' ? query.view : 'chat'
      }
      initialPostId={query.post}
    />
  );
}
