'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/navigation';
import RankingsTable from '@/components/rankings/RankingsTable';
import type { PlayerRankingRow } from '@/components/rankings/RankingsTable';
import type { PlayerStat } from '@/hooks/usePlayerStats';
import { isAbortError } from '@/lib/utils';

// Only log in non-production environments
const isDev = process.env.NODE_ENV !== 'production';

interface PlayerRow extends PlayerRankingRow {
  goals?: number;
  disposals?: number;
  marks?: number;
  tackles?: number;
}

// Static fallback data for build time
const fallbackPlayers: PlayerRow[] = [
  {
    id: '1',
    name: 'ETL Integration Ready',
    team: 'SYS',
    position: 'SYS',
    totalValue: 100,
    rank: 1,
  },
  { id: '2', name: 'Connect Firebase Data', team: 'SYS', position: 'SYS', totalValue: 95, rank: 2 },
  { id: '3', name: 'Initialize Database', team: 'SYS', position: 'SYS', totalValue: 90, rank: 3 },
];

type FetchResult = { data: PlayerRow[]; error?: string };

async function fetchRankings(signal?: AbortSignal): Promise<FetchResult> {
  try {
    if (isDev) console.log('DEBUG: Fetching player stats from ETL API...');

    // Use relative URL for API calls
    const response = await fetch('/api/player-stats?season=2025', {
      cache: 'no-store',
      signal,
    });

    if (isDev) console.log('DEBUG: API Response status:', response.status);

    if (response.ok) {
      const result = await response.json();
      if (isDev)
        console.log('DEBUG: API Response data:', {
          success: result.success,
          dataLength: result.data?.length || 0,
          count: result.count,
          firstItem: result.data?.[0],
        });

      if (result.success && result.data?.length > 0) {
        if (isDev) console.log(`DEBUG: ETL API - Fetched ${result.data.length} player stats`);

        // Transform ETL data to rankings format in one map after sorting
        const rankings: PlayerRow[] = [...result.data]
          .sort((a: PlayerStat, b: PlayerStat) => (b.fantasy_points || 0) - (a.fantasy_points || 0))
          .map((stat: PlayerStat, index: number) => ({
            id: stat.player_id || stat.id,
            name: stat.player_name,
            team: stat.team,
            position: stat.position,
            totalValue: stat.fantasy_points || 0,
            rank: index + 1,
            goals: stat.goals || 0,
            disposals: stat.disposals || 0,
            marks: stat.marks || 0,
            tackles: stat.tackles || 0,
          }));

        return { data: rankings };
      } else {
        if (isDev) console.log('DEBUG: API returned success but no data');
        return { data: [], error: 'No live player data available.' };
      }
    } else {
      const errorText = await response.text();
      if (isDev) console.log('DEBUG: API Error response:', errorText);
      return { data: [], error: 'Failed to load player rankings.' };
    }
  } catch (error: unknown) {
    if (isAbortError(error)) {
      if (isDev) console.log('DEBUG: fetchRankings aborted');
      return { data: [] };
    }
    console.error('Failed to fetch rankings:', error);
    return { data: [], error: 'Unexpected error while loading rankings.' };
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

function RankingsContent() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const loadRankings = async () => {
      setLoading(true);
      const { data, error } = await fetchRankings(controller.signal);
      if (!controller.signal.aborted) {
        setPlayers(data);
        setError(error ?? null);
        setLoading(false);
      }
    };

    loadRankings();

    return () => {
      controller.abort();
    };
  }, []);

  if (loading) {
    return <LoadingSkeleton />;
  }

  // Use fallback data if no live data is available
  const displayPlayers = players.length === 0 ? fallbackPlayers : players;

  return (
    <AppLayout>
      <main className="mx-auto max-w-7xl p-6">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Player Rankings</h1>
          <p className="text-lg text-gray-600">
            Top performing players ranked by total fantasy points
          </p>
          {error && (
            <p className="text-sm text-red-600 mt-2">{error} Showing fallback if available.</p>
          )}
          {players.length > 0 && (
            <p className="text-sm text-green-600 mt-2">
              ✅ Using live ETL data ({displayPlayers.length} players)
            </p>
          )}
          {players.length === 0 && !error && (
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
  return <RankingsContent />;
}
