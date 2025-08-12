import { Suspense } from 'react';
import RankingsTable, { type PlayerRow } from './RankingsTable';
import { fetchFromAPI } from '@/lib/api';

async function fetchRankings(): Promise<PlayerRow[]> {
  try {
    const response = await fetchFromAPI<{
      data: {
        players: PlayerRow[];
      };
    }>('/api/rankings?perGame=1&winsorP=0.01&includeDE=0');
    
    return response.data?.players || [];
  } catch (error) {
    console.error('Failed to fetch rankings:', error);
    return [];
  }
}

export default async function RankingsPage() {
  const players = await fetchRankings();

  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Player Rankings</h1>
        <p className="text-gray-600 mt-2">
          Player values calculated using standardized z-scores across multiple statistical categories.
        </p>
      </header>
      
      <Suspense fallback={<div className="animate-pulse">Loading rankings...</div>}>
        <RankingsTable players={players} />
      </Suspense>
    </main>
  );
}
