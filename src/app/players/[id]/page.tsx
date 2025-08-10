import type { PageProps } from 'next';
import { notFound } from 'next/navigation';
import type { Player } from '@/types';
import { getPlayerIds, getPlayer } from '@/lib/data';

const formatKey = (key: string) =>
  key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

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

      <section aria-label="Player overview" className="space-y-4">
        {player.position && (
          <p className="text-neutral-700">
            <span className="font-medium">Position:</span> {player.position}
          </p>
        )}
        {player.avg != null && (
          <p className="text-neutral-700">
            <span className="font-medium">Average:</span> {player.avg}
          </p>
        )}

        {Object.keys(player.stats ?? {}).length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-neutral-500">Stat</th>
                  <th className="px-2 py-1 text-neutral-500">Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(player.stats ?? {}).map(([k, v]) => (
                  <tr key={k} className="odd:bg-neutral-50">
                    <td className="px-2 py-1">{formatKey(k)}</td>
                    <td className="px-2 py-1">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-neutral-600">No stats available.</p>
        )}
      </section>
    </main>
  );
}