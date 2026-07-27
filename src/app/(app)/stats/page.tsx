'use client';

import { useState } from 'react';
import PlayerStatsTable from '@/components/stats/PlayerStatsTable';
import StatFilters from '@/components/StatFilters';
import { LoadingSpinner } from '@/components/ui';
import { usePlayerStats } from '@/hooks/usePlayerStats';

export default function StatsPage() {
  const { players, loading, error } = usePlayerStats();

  const [statQualifier, setStatQualifier] = useState<string>('Kicks');
  const [statThreshold, setStatThreshold] = useState<number>(10);
  const [timeframe, setTimeframe] = useState<string>('Season');

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
      <StatFilters
        statQualifier={statQualifier}
        setStatQualifier={setStatQualifier}
        statThreshold={statThreshold}
        setStatThreshold={setStatThreshold}
        timeframe={timeframe}
        setTimeframe={setTimeframe}
      />
      <div className="mt-6">
        <PlayerStatsTable players={players} />
      </div>
    </div>
  );
}
