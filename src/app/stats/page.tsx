import type { Player } from '@/types/players';
import { getPlayers } from '@/lib/data';
import PlayerStatsTable from '@/components/stats/PlayerStatsTable';

export default async function StatsPage() {
  let players: Player[] = [];
  let error: string | null = null;

  try {
    players = await getPlayers();
  } catch (err) {
    console.error('Failed to fetch players:', err);
    // This error will be caught by the nearest error.tsx boundary
    error = err instanceof Error ? err.message : 'An unknown error occurred while fetching player data.';
  }

  if (error) {
    return (
      <div className="container mx-auto p-8 text-center">
        <div className="text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-2">Error Loading Player Stats</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!players || players.length === 0) {
    return (
      <div className="container mx-auto p-8 text-center">
        <div className="text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-2">No Player Data</h2>
          <p>No player stats found. Please check your data source.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <PlayerStatsTable players={players} />
    </div>
  );
}
