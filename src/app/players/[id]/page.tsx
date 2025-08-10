import { notFound } from 'next/navigation';
import type { Player } from '@/types/players';
import { fetchFromAPI } from '@/lib/api';
import PlayerDetail from '@/components/PlayerDetail';

const PLAYER_FETCH_LIMIT = 1000;

async function fetchPlayers(): Promise<Player[]> {
  const data = await fetchFromAPI<{ players: Player[] }>(
    `/api/players?limit=${PLAYER_FETCH_LIMIT}`,
  );
  return data.players;
}

async function fetchPlayer(id: string): Promise<Player | null> {
  const players = await fetchPlayers();
  return players.find((p) => p.id === id) ?? null;
}

// Build all player pages at build time
export async function generateStaticParams() {
  const players = await fetchPlayers();
  return players.map((p) => ({ id: p.id }));
}

// Page metadata
export async function generateMetadata({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const player = await fetchPlayer(id);
  if (!player) return { title: 'Player Not Found' };

  return {
    title: `${player.name} | Player Stats | Statly`,
    description: `View detailed stats for ${player.name} of ${player.team}.`,
  };
}

export default async function PlayerPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const player: Player | null = await fetchPlayer(id);
  if (!player) notFound();

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
