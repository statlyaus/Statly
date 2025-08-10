type PageProps<T> = { params: T };
import { notFound } from 'next/navigation';
import type { Player } from '@/types';
import { getPlayerIds, getPlayer } from '@/lib/data';

// Build all player pages at build time
export async function generateStaticParams() {
  const playerIds = await getPlayerIds();
  return playerIds.map((p) => ({ id: p.id }));
}

// Page metadata
export async function generateMetadata({ params }: PageProps<{ id: string }>) {
  const { id } = params;
  const player = await getPlayer(id);
  if (!player) return { title: 'Player Not Found' };

  return {
    title: `${player.name} | Player Stats | Statly`,
    description: `View detailed stats for ${player.name} of ${player.team}.`,
  };
}

export default async function PlayerPage({ params }: PageProps<{ id: string }>) {
  const { id } = params;
  const player: Player | null = await getPlayer(id);
  if (!player) notFound();

  return (
    <main className="mx-auto max-w-5xl p-4">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">{player.name}</h1>
        <p className="text-sm text-neutral-500">{player.team}</p>
      </header>

      {/* TODO: replace with your PlayerDetail component */}
      <section aria-label="Player overview">
        <p className="text-neutral-600">Player profile coming soon.</p>
      </section>
    </main>
  );
}