import { notFound } from 'next/navigation';
import type { PageProps } from 'next';
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
      <h1 className="text-2xl font-semibold">{player.name}</h1>
      <p className="text-sm text-neutral-500">{player.team}</p>
      {/* TODO: replace with your PlayerDetail component */}
    </main>
  );
}
  const { id } = await params;
  const player = await getPlayer(id);
  if (!player) notFound();

  // Keys that are valid on BOTH statLabels and Player
  type StatKey = Extract<keyof typeof statLabels, keyof Player>;
  const entries = Object.entries(statLabels) as Array<[StatKey, string]>;

  return (
    <div className="container mx-auto p-4 sm:p-6 bg-gray-900 text-white min-h-screen">
      <div className="bg-gray-800 rounded-lg shadow-lg p-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-blue-400 mb-2">
          {player.name}
        </h1>
        <p className="text-lg sm:text-xl text-gray-400 mb-6">
          {player.team} - {player.position || 'N/A'}
        </p>

        <h2 className="text-2xl font-semibold mb-4">Season Averages</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 text-base sm:text-lg">
          {entries.map(([key, label]) => (
            <div
              key={key as string}
              className="bg-gray-700 p-3 rounded-md flex justify-between items-center"
            >
              <span className="text-gray-300">{label}:</span>
              <span className="font-bold text-white">
                {player[key] ?? 'N/A'}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <Link
            href="/tradecentre"
            className="text-blue-400 hover:text-blue-300 transition-colors"
          >
            &larr; Back to Trade Centre
          </Link>
        </div>
      </div>
    </div>
  );
}