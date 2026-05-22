import 'server-only';
import { redirect } from 'next/navigation';

import { LeagueOnboardingEntry } from '@/app/(app)/leagues/_components/LeagueOnboardingEntry';
import { AppLayout } from '@/components/navigation';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { prisma } from '@/lib/prisma';

export default async function TradeCentrePage() {
  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) {
    redirect('/login?next=/tradecentre');
  }

  const membership = await prisma.leagueMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: { leagueId: true },
  });

  if (membership) {
    redirect(`/leagues/${membership.leagueId}/trades`);
  }

  return (
    <AppLayout>
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-16 sm:px-6">
          <section className="space-y-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Trade centre
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
              Join or create a league to trade
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Trades are managed inside a league workspace so each proposal can use the right
              roster, scoring, and commissioner settings.
            </p>
            <LeagueOnboardingEntry
              variant="compact"
              title="Start your league workspace"
              description="Create a competition or join with an invite code, then return to trade proposals once league context is available."
            />
          </section>
        </div>
      </main>
    </AppLayout>
  );
}
