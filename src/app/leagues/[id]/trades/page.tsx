import LeagueTradesClient from '@/components/trades/LeagueTradesClient';

export default async function LeagueTradesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <LeagueTradesClient leagueId={id} />;
}
