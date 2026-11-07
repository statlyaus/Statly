'use client';

import PlayerStatsTable from '@/components/stats/PlayerStatsTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { usePlayerStats } from '@/hooks/usePlayerStats';

export default function StatsPage() {
  const { players, loading, error } = usePlayerStats();

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <p className="text-red-500 text-center">{error}</p>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Player Statistics</h1>
      <PlayerStatsTable players={players} />
    </div>
  );
}
