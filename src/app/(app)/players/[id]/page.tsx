import { notFound } from 'next/navigation';

import { PlayerDetail } from '@/components/PlayerDetail';
import { getPlayerDetail } from '@/server/players/getPlayerDetail';

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = await getPlayerDetail(id);

  if (!player) {
    notFound();
  }

  return <PlayerDetail player={player} />;
}
