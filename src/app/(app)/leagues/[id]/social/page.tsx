import { notFound, redirect } from 'next/navigation';

import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { NotLeagueMember } from '@/components/league/NotLeagueMember';
import { loadAuthorizedLeagueDetail } from '@/server/leagues/leagueDetail';
import { loadMemberLeagueOptions } from '@/server/leagues/memberLeagueOptions';

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
  if (!result.ok && (result.status === 403 || result.status === 404)) {
    return <NotLeagueMember leagues={await loadMemberLeagueOptions(userId)} />;
  }
  if (!result.ok) throw new Error('League social could not be loaded.');
  if (!result.league) notFound();

  return (
    <SocialPageClient
      leagueId={id}
      leagueName={result.league.name}
      userId={userId}
      initialView={query.view === 'board' || query.view === 'activity' ? query.view : 'chat'}
      initialPostId={query.post}
    />
  );
}
