import { Suspense } from 'react';
import { AppLayout } from '@/components/navigation';
import { RankingsTable } from './RankingsTable';
import { fetchFromAPI } from '@/lib/api';

interface PlayerRow {
  id: string;
  name: string;
  team?: string;
  position?: string;
  totalValue: number;
  rank: number;
}

async function fetchRankings(): Promise<PlayerRow[]> {
  try {
    console.log('DEBUG: Fetching rankings from API...');
    const response = await fetchFromAPI<{
      data: {
        players: PlayerRow[];
      };
    }>('/api/rankings');
    
    console.log('DEBUG: API response received:', response.data?.players?.length, 'players');
    return response.data?.players || [];
  } catch (error) {
    console.error('Failed to fetch rankings:', error);
    return [];
  }
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/4 mb-6"></div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 p-4">
            <div className="grid grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-4 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
          <div className="divide-y divide-gray-200">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="p-4">
                <div className="grid grid-cols-5 gap-4">
                  <div className="h-8 bg-gray-100 rounded-full w-8"></div>
                  <div className="h-4 bg-gray-100 rounded"></div>
                  <div className="h-4 bg-gray-100 rounded w-16"></div>
                  <div className="h-4 bg-gray-100 rounded w-12"></div>
                  <div className="h-4 bg-gray-100 rounded w-20"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function RankingsPage() {
  let players: PlayerRow[] = [];
  
  try {
    players = await fetchRankings();
    console.log('DEBUG: Fetched players count:', players.length);
  } catch (error) {
    console.error('Error in RankingsPage:', error);
  }

  // Fallback to mock data if no players found
  if (players.length === 0) {
    console.log('DEBUG: No players found, using mock data');
    players = [
      { id: '1', name: 'Test Player 1', team: 'Test Team', position: 'Forward', totalValue: 100, rank: 1 },
      { id: '2', name: 'Test Player 2', team: 'Test Team', position: 'Midfielder', totalValue: 95, rank: 2 },
      { id: '3', name: 'Test Player 3', team: 'Test Team', position: 'Defender', totalValue: 90, rank: 3 },
    ];
  }

  return (
    <AppLayout>
      <main className="mx-auto max-w-7xl p-6">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">
            Player Rankings
          </h1>
          <p className="text-lg text-gray-600 mb-4">
            Player values calculated using weighted scoring system across multiple statistical categories.
          </p>
          <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-blue-700">
                  <strong>Total Value Formula:</strong> Each player&apos;s value is calculated using weighted per-game averages with efficiency modulation across categories like goals, tackles, clearances, and more. Higher values indicate better overall performance.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-500">
            Debug: Found {players.length} players
          </div>
        </header>
        
        <Suspense fallback={<LoadingSkeleton />}>
          <RankingsTable players={players} />
        </Suspense>
      </main>
    </AppLayout>
  );
}
