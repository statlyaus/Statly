import { notFound } from 'next/navigation';
import { fetchFromAPI } from '@/lib/api';
import type { League, LeagueMember } from '@/types/leagues';
import LeagueTabs from '@/components/league/LeagueTabs';
import { AppLayout } from '@/components/navigation';

interface LeagueResponse {
  league: League;
  members: LeagueMember[];
  memberCount: number;
  spotsRemaining: number;
}

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let leagueData: LeagueResponse | null = null;

  try {
    const response = await fetchFromAPI<{ data: LeagueResponse }>(`/api/leagues/${id}`);
    leagueData = response.data;
  } catch {
    // ignore
  }

  if (!leagueData) notFound();

  const { league, members } = leagueData;

  // In a real app, you'd get this from auth context
  const currentUserId = 'demo-user';

  return (
    <AppLayout>
      <main className="mx-auto max-w-7xl p-6">
        <LeagueTabs league={league} members={members} currentUserId={currentUserId} />
      </main>
    </AppLayout>
  );
}
