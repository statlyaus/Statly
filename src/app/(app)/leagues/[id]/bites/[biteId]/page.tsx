import { notFound, redirect } from 'next/navigation';

import { BiteCommissionerPanel } from '@/components/league/bloodsucker/BiteCommissionerPanel';
import { BitePicker } from '@/components/league/bloodsucker/BitePicker';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import {
  BloodsuckerReadError,
  loadBitePicker,
  loadBiteReview,
} from '@/server/leagues/bloodsuckerReadModel';

export const dynamic = 'force-dynamic';

const isRefusal = (error: unknown, code: BloodsuckerReadError['code']) =>
  error instanceof BloodsuckerReadError && error.code === code;

// One bite. The Bloodsucker gets the bite picker (#1286, US-6); a commissioner who is not the
// Bloodsucker gets the cancel and redo control (#1343, BR-35); anyone else is told why not.
export default async function BitePage({
  params,
}: {
  params: Promise<{ id: string; biteId: string }>;
}) {
  const [{ id: leagueId, biteId }, userId] = await Promise.all([
    params,
    getAuthenticatedUserIdFromServerContext(),
  ]);
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent(`/leagues/${leagueId}/bites/${biteId}`)}`);
  }

  try {
    const picker = await loadBitePicker({ leagueId, biteId, userId }).catch((error: unknown) => {
      // Not the Bloodsucker: the commissioner's view is tried next.
      if (isRefusal(error, 'FORBIDDEN')) return null;
      throw error;
    });
    if (picker) {
      const settings = await prisma.leagueSettings.findFirst({
        where: { league: { id: leagueId } },
        select: { timeZone: true },
      });
      return (
        <div className="min-h-screen bg-muted">
          <BitePicker
            leagueId={leagueId}
            userId={userId}
            timeZone={settings?.timeZone ?? undefined}
            initial={JSON.parse(JSON.stringify(picker))}
          />
        </div>
      );
    }
    const review = await loadBiteReview({ leagueId, biteId, userId });
    return (
      <div className="min-h-screen bg-muted">
        <BiteCommissionerPanel
          leagueId={leagueId}
          userId={userId}
          initial={JSON.parse(JSON.stringify(review))}
        />
      </div>
    );
  } catch (error) {
    if (isRefusal(error, 'NOT_FOUND')) notFound();
    if (error instanceof BloodsuckerReadError) {
      return (
        <div className="mx-auto max-w-xl px-4 py-10 text-foreground">
          <h1 className="text-xl font-semibold">This bite is not yours to change</h1>
          <p className="mt-2 text-sm">
            Only the Bloodsucker can make a bite, and only a commissioner can cancel or redo one (
            {error.code}).
          </p>
        </div>
      );
    }
    throw error;
  }
}
