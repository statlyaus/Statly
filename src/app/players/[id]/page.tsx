import { notFound } from 'next/navigation';
import type { Player } from '@/types/players';
import { fetchFromAPI } from '@/lib/api';
import PlayerDetail from '@/components/PlayerDetail';
import { AppLayout } from '@/components/navigation';

// Make this page dynamic - don't pre-generate all player pages
export const dynamic = 'force-dynamic';

// Don't generate static params - let pages be created on-demand
// export async function generateStaticParams() {
//   const playerIds = await getPlayerIds();
//   return playerIds.map((p) => ({ id: p.id }));
// }

// Page metadata
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let player: Player;
  try {
    player = await fetchFromAPI<Player>(`/api/players/${id}`);
  } catch {
    notFound();
  }

  // Ensure required fields have defaults for PlayerDetail component
  const playerForDetail = {
    name: player.name,
    team: player.team || 'Unknown',
    position: player.position || 'Unknown',
  };

  return (
    <AppLayout>
      <main className="mx-auto max-w-5xl p-4">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold">{player.name}</h1>
          <p className="text-sm text-neutral-500">{player.team}</p>
        </header>
        <PlayerDetail player={playerForDetail} />
      </main>
    </AppLayout>
  );
}
