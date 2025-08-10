import { notFound } from 'next/navigation';
import type { Player } from '@/types';
import { getPlayerIds, getPlayer } from '@/lib/data';
import PlayerDetail from '@/components/PlayerDetail';

// Build all player pages at build time
export async function generateStaticParams() {
  const playerIds = await getPlayerIds();
  return playerIds.map((p) => ({ id: p.id }));
}

// Page metadata
export async function generateMetadata({ params }: { params: { id: string } }) {
  const { id } = params;
  const player = await getPlayer(id);
  if (!player) return { title: 'Player Not Found' };

  return {
    title: `${player.name} | Player Stats | Statly`,
    description: `View detailed stats for ${player.name} of ${player.team}.`,
  };
}

export default async function PlayerPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const player: Player | null = await getPlayer(id);
  if (!player) notFound();

  return (
    <main className="mx-auto max-w-5xl p-4">
      <PlayerDetail player={player} />
    </main>
  );
}