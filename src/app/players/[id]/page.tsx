import { notFound } from 'next/navigation';
import type { Player } from '@/types/players';
import { getPlayerIds } from '@/lib/data';
import { fetchFromAPI } from '@/lib/api';
import PlayerDetail from '@/components/PlayerDetail';

// Build all player pages at build time
export async function generateStaticParams() {
  const playerIds = await getPlayerIds();
  return playerIds.map((p) => ({ id: p.id }));
}

// Page metadata
export async function generateMetadata({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  try {
    const player = await fetchFromAPI<Player>(`/api/players/${id}`);
    return {
      title: `${player.name} | Player Stats | Statly`,
      description: `View detailed stats for ${player.name} of ${player.team}.`,
    };
  } catch {
    return { title: 'Player Not Found' };
  }
}

export default async function PlayerPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  let player: Player;
  try {
    player = await fetchFromAPI<Player>(`/api/players/${id}`);
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl p-4">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">{player.name}</h1>
        <p className="text-sm text-neutral-500">{player.team}</p>
      </header>
      <PlayerDetail player={player} />
    </main>
  );
}
