import { getPlayer, getPlayerIds } from '@/lib/data';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { statLabels } from '@/lib/constants';

type PlayerPageProps = {
  params: {
    id: string;
  };
};

// This function pre-builds all the player pages at build time for performance.
export async function generateStaticParams() {
  const playerIds = await getPlayerIds();
  return playerIds.map((player) => ({
    id: player.id,
  }));
}

// This function generates metadata for the page head.
export async function generateMetadata({ params }: PlayerPageProps) {
  const player = await getPlayer(params.id);
  if (!player) {
    return {
      title: 'Player Not Found',
    };
  }
  return {
    title: `${player.name} | Player Stats | Statly`,
    description: `View detailed stats for ${player.name} of ${player.team}.`,
  };
}

export default async function PlayerPage({ params }: PlayerPageProps) {
  const player = await getPlayer(params.id);

  if (!player) {
    notFound();
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 bg-gray-900 text-white min-h-screen">
      <div className="bg-gray-800 rounded-lg shadow-lg p-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-blue-400 mb-2">{player.name}</h1>
        <p className="text-lg sm:text-xl text-gray-400 mb-6">
          {player.team} - {player.position || 'N/A'}
        </p>

        <h2 className="text-2xl font-semibold mb-4">Season Averages</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 text-base sm:text-lg">
          {Object.entries(statLabels).map(([key, label]) => (
            <div key={key} className="bg-gray-700 p-3 rounded-md flex justify-between items-center">
              <span className="text-gray-300">{label}:</span>
              <span className="font-bold text-white">
                {/* @ts-ignore - Player object has dynamic stat keys from Firestore */}
                {player[key] ?? 'N/A'}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <Link href="/tradecentre" className="text-blue-400 hover:text-blue-300 transition-colors">
            &larr; Back to Trade Centre
          </Link>
        </div>
      </div>
    </div>
  );
}