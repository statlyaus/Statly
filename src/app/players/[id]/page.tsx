import { notFound } from 'next/navigation';
import { getPlayer, getPlayerIds } from '@/lib/data';
import PlayerStatsDisplay from '@/components/PlayerStatsDisplay';

export async function generateStaticParams() {
  // This function is called at build time to generate static pages for all players.
  // It helps improve performance and SEO.
  return getPlayerIds();
}

type PlayerPageProps = {
  params: { id: string };
};

export default async function PlayerPage({ params }: PlayerPageProps) {
  const player = await getPlayer(params.id);

  if (!player) {
    notFound();
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">{player.name}</h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 mt-1">
          {player.team} - {player.position}
        </p>
      </div>
      <PlayerStatsDisplay player={player} />
    </div>
  );
}