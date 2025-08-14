import { Suspense } from 'react';
import { AppLayout } from '@/components/navigation';
import { RankingsTable } from './RankingsTable';

interface PlayerRow {
  id: string;
  name: string;
  team?: string;
  position?: string;
  totalValue: number;
  rank: number;
  goals?: number;
  disposals?: number;
  marks?: number;
  tackles?: number;
}

// Static fallback data for build time
const fallbackPlayers: PlayerRow[] = [
  { id: '1', name: 'ETL Integration Ready', team: 'SYS', position: 'SYS', totalValue: 100, rank: 1 },
  { id: '2', name: 'Connect Firebase Data', team: 'SYS', position: 'SYS', totalValue: 95, rank: 2 },
  { id: '3', name: 'Initialize Database', team: 'SYS', position: 'SYS', totalValue: 90, rank: 3 },
];

async function fetchRankings(): Promise<PlayerRow[]> {
  // Return empty array for build time - will use fallback data
  return [];
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

async function RankingsContent() {
  const players = await fetchRankings();
  
  // Use fallback data for build time and when no data is available
  const displayPlayers = players.length === 0 ? fallbackPlayers : players;

  return (
    <AppLayout>
      <main className="mx-auto max-w-7xl p-6">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">
            Player Rankings
          </h1>
          <p className="text-lg text-gray-600">
            Top performing players ranked by total fantasy points
          </p>
          {players.length > 0 && (
            <p className="text-sm text-green-600 mt-2">
              ✅ Using live ETL data ({displayPlayers.length} players)
            </p>
          )}
          {players.length === 0 && (
            <p className="text-sm text-yellow-600 mt-2">
              ⚠️ Using fallback data - Initialize Firebase database for live data
            </p>
          )}
        </header>

        <RankingsTable players={displayPlayers} />
      </main>
    </AppLayout>
  );
}

export default function RankingsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <RankingsContent />
    </Suspense>
  );
}
