import { redirect } from 'next/navigation';

export default async function LeagueTradesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    playerId?: string;
    ownerMemberId?: string;
    tradeView?: string;
  }>;
}): Promise<never> {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const target = new URLSearchParams({ tab: 'trades' });

  if (query.playerId) target.set('playerId', query.playerId);
  if (query.ownerMemberId) target.set('ownerMemberId', query.ownerMemberId);
  if (query.tradeView) target.set('tradeView', query.tradeView);

  redirect(`/leagues/${encodeURIComponent(id)}?${target.toString()}`);
}
