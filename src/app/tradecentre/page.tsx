import 'server-only';

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppLayout } from '@/components/navigation';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';

export default async function TradeCentrePage({
  searchParams,
}: {
  searchParams?: Promise<{ playerId?: string; ownerMemberId?: string }>;
}) {
  const userId = await getAuthenticatedUserIdFromServerContext();

  if (!userId) {
    redirect('/login?next=/tradecentre');
  }

  const membership = await prisma.leagueMember.findFirst({
    where: { userId, isActive: true, status: 'ACTIVE' },
    orderBy: { joinedAt: 'asc' },
    select: { leagueId: true },
  });

  if (membership) {
    const query = searchParams ? await searchParams : {};
    const target = new URLSearchParams({ tab: 'trades' });
    if (query.playerId) target.set('playerId', query.playerId);
    if (query.ownerMemberId) target.set('ownerMemberId', query.ownerMemberId);
    redirect(`/leagues/${membership.leagueId}?${target.toString()}`);
  }

  return (
    <AppLayout>
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-16 sm:px-6">
          <section className="rounded-lg border border-border bg-card p-8 text-card-foreground shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Trade Centre
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
              Join or create a league to trade
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Fantasy trades are managed inside a league workspace so each proposal can use the
              right roster, scoring settings, and commissioner rules.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/leagues/join"
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Join league
              </Link>
              <Link
                href="/leagues/new"
                className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Create league
              </Link>
            </div>
          </section>
        </div>
      </main>
    </AppLayout>
  );
}
