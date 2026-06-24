import { redirect } from 'next/navigation';

export default async function LeagueWaiversPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;

  redirect(`/leagues/${leagueId}?tab=waivers`);
}
