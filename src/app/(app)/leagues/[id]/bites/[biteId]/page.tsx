import { notFound, redirect } from 'next/navigation';

import { BitePicker } from '@/components/league/bloodsucker/BitePicker';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { BloodsuckerReadError, loadBitePicker } from '@/server/leagues/bloodsuckerReadModel';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Bloodsucker 9/9 (#1286, US-6): the bite picker, for the Bloodsucker only.
export default async function BitePickerPage({
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
    const [picker, settings] = await Promise.all([
      loadBitePicker({ leagueId, biteId, userId }),
      prisma.leagueSettings.findFirst({
        where: { league: { id: leagueId } },
        select: { timeZone: true },
      }),
    ]);
    return (
      <div className="min-h-screen bg-[color:var(--league-page)]">
        <BitePicker
          leagueId={leagueId}
          userId={userId}
          timeZone={settings?.timeZone ?? undefined}
          initial={JSON.parse(JSON.stringify(picker))}
        />
      </div>
    );
  } catch (error) {
    if (error instanceof BloodsuckerReadError) {
      if (error.code === 'NOT_FOUND') notFound();
      return (
        <div className="mx-auto max-w-xl px-4 py-10 text-[color:var(--league-text)]">
          <h1 className="text-xl font-semibold">This bite is not yours to make</h1>
          <p className="mt-2 text-sm">{error.message}</p>
        </div>
      );
    }
    throw error;
  }
}
