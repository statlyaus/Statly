'use client';

import { useEffect, useState } from 'react';

import { AppLayout } from '@/components/navigation';
import NineCategoryRankingsTable, { type PlayerCategoryRanking } from '@/components/rankings/NineCategoryRankingsTable';
import { isAbortError } from '@/lib/utils';

export default function RankingsClient() {
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
        if (!response.ok) throw new Error('Failed to fetch rankings');
        const data = await response.json();
        const playersData = data.success && data.data ? data.data.players || [] : [];
        if (!controller.signal.aborted && isMounted) setPlayers(Array.isArray(playersData) ? playersData : []);
      } catch (err: unknown) {
        if (!isAbortError(err) && isMounted) setError(err instanceof Error ? err.message : 'Failed to load rankings');
      } finally {
        if (!controller.signal.aborted && isMounted) setLoading(false);
      }
    };
    void fetchRankings();
    return () => { isMounted = false; controller.abort(); };
  }, []);

  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/4"></div>
            <div className="h-16 bg-gray-200 rounded"></div>
            <div className="space-y-2">{[...Array(10)].map((_, i) => (<div key={i} className="h-16 bg-gray-200 rounded"></div>))}</div>
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
          <p className="text-lg text-gray-600">Player rankings based on 9 AFL statistical categories</p>
        </header>
        <NineCategoryRankingsTable players={players} />
      </div>
    </AppLayout>
  );
}

