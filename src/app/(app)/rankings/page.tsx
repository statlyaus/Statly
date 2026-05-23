// Client component; remove revalidate to avoid ineffective ISR
'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/navigation';
import NineCategoryRankingsTable, {
  type PlayerCategoryRanking,
} from '@/components/rankings/NineCategoryRankingsTable';
import { isAbortError } from '@/lib/utils';

export default function RankingsPage() {
  const [players, setPlayers] = useState<PlayerCategoryRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;

    const fetchRankings = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/rankings', { signal: controller.signal });
        if (!response.ok) {
          throw new Error('Failed to fetch rankings');
        }
        const data = await response.json();
        // Extract players from API response structure
        const playersData = data.success && data.data ? data.data.players || [] : [];
        if (!controller.signal.aborted && isMounted) {
          setPlayers(Array.isArray(playersData) ? playersData : []);
        }
      } catch (err: unknown) {
        if (isAbortError(err)) {
          // Request was aborted; do not update state
        } else if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load rankings');
        }
      } finally {
        if (!controller.signal.aborted && isMounted) {
          setLoading(false);
        }
      }
    };

    fetchRankings();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/4"></div>
            <div className="h-16 bg-gray-200 rounded"></div>
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h2 className="text-red-800 font-semibold">Error Loading Rankings</h2>
            <p className="text-red-600">{error}</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Player Rankings</h1>
          <p className="text-lg text-gray-600">
            Player rankings based on 9 AFL statistical categories
          </p>

          {/* Legend */}
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Stat Strength Legend:</h3>
            <div className="flex flex-wrap gap-4 text-xs">
              <div className="flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-green-50 text-green-700">
                  🔥 Elite (Z ≥ 2.0)
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-green-100 text-green-600">
                  ⭐ Excellent (Z ≥ 1.0)
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-blue-100 text-blue-600">
                  📈 Above Avg (Z ≥ 0.5)
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-gray-100 text-gray-600">
                  ➖ Average (Z ≥ -0.5)
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-orange-100 text-orange-600">
                  📉 Below Avg (Z ≥ -1.0)
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-red-100 text-red-600">
                  ❌ Poor (Z &lt; -1.0)
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Numbers show per-game averages. Icons and colors indicate strength relative to league
              average (Z-score).
            </p>
          </div>
        </header>

        {/* Rankings table */}
        <NineCategoryRankingsTable players={players} />
      </div>
    </AppLayout>
  );
}
