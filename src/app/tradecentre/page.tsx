// src/app/tradecentre/page.tsx
import * as React from 'react';
import Link from 'next/link';
import TradeCentreClient from '@/components/TradeCentreClient';
import { logger } from '@/lib/logger';
import type { PlayerLite } from '@/types/players';
import { fetchFromAPI } from '@/lib/api';

// --- server-side fetch of player data for trade centre ---
async function fetchPlayersForTrading(): Promise<PlayerLite[]> {
  try {
    const response = await fetchFromAPI<{
      data: {
        players: Array<{ 
          id: string; 
          name?: string; 
          team?: string; 
          position?: string;
          totalValue?: number;
          rank?: number;
        }>;
      };
    }>(
      '/api/rankings?perGame=1&winsorP=0.01&includeDE=0',
      { cache: 'no-store' }
    );

    // Access players from the nested data structure
    const players = response.data?.players || [];
    
    // Return all players for trade centre - they can filter/search
    return players.map((p) => ({
      id: p.id,
      name: p.name ?? p.id,
      team: p.team,
      position: p.position,
      // Add additional fields for trading
      totalValue: p.totalValue || 0,
      rank: p.rank || 999,
    }));
  } catch (error) {
    logger.error('Failed to fetch players for trade centre', error);
    // Return empty array - component will handle the empty state
    return [];
  }
}

export default async function TradeCentrePage() {
  let players: PlayerLite[] = [];
  let error = false;

  try {
    players = await fetchPlayersForTrading();
  } catch (e) {
    logger.error('Failed to load players for trade centre', e);
    error = true;
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                ← Dashboard
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">Trade Centre</h1>
            </div>
            <div className="flex items-center gap-4">
              <Link 
                href="/rankings" 
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                View Rankings
              </Link>
              <Link 
                href="/leagues" 
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                My Leagues
              </Link>
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <div className="text-red-800 text-lg font-semibold mb-2">
              Unable to load player data
            </div>
            <p className="text-red-600 mb-4">
              There was an issue connecting to the rankings service. Please try again later.
            </p>
            <div className="flex justify-center gap-4">
              <button
                onClick={() => window.location.reload()}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
              >
                Retry
              </button>
              <Link
                href="/dashboard"
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <TradeCentreClient initialPlayers={players} />
      )}
    </main>
  );
}