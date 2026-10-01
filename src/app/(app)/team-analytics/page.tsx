import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LeagueToolPage } from '@/components/league/tools/LeagueToolPage';
import { TeamCategoryProfileTable } from '@/components/league/tools/TeamCategoryProfileTable';
import { loadTeamCategoryProfile } from '@/server/leagues/teamCategoryProfile';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Team Analytics | Statly' };

async function TeamCategoryProfileSection({
  leagueId,
  userId,
}: {
  leagueId: string;
  userId: string;
}) {
  const profile = await loadTeamCategoryProfile({ leagueId, viewerUserId: userId });
  if (!profile) notFound();
  return <TeamCategoryProfileTable leagueId={leagueId} profile={profile} />;
}

export default async function TeamAnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<{ league?: string }>;
}) {
  const { league: requestedLeagueId } = (await searchParams) ?? {};

  return (
    <LeagueToolPage
      path="/team-analytics"
      title="Team Analytics"
      description="Where your team wins and loses categories"
      requestedLeagueId={requestedLeagueId}
    >
      {({ league, userId }) => <TeamCategoryProfileSection leagueId={league.id} userId={userId} />}
    </LeagueToolPage>
  );
}
