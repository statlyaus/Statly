// src/app/tradecentre/page.tsx
import * as React from 'react';
import Link from 'next/link';
import { Suspense } from 'react';
import TradeCentreShellClient from './TradeCentreShellClient';
import { getPlayers } from '@/lib/data';
import { logger } from '@/lib/logger';
import type { PlayerLite } from '@/types/players';
import { fetchFromAPI } from '@/lib/api';

// --- server-side fetch of a small player list to render the page ---
async function fetchPlayers(): Promise<PlayerLite[]> {
  const data = await fetchFromAPI<{
    players: Array<{ id: string; name?: string; team?: string; position?: string }>;
  }>(
    '/api/rankings?perGame=1&winsorP=0.01&includeDE=0',
    { cache: 'no-store' }
  );

  // show a manageable slice on the Trade Centre page
  return data.players.slice(0, 30).map((p) => ({
    id: p.id,
    name: p.name ?? p.id,
    team: p.team,
    position: p.position,
  }));
}

export default async function TradeCentrePage() {
  let players: PlayerLite[] = [];
  let error = false;

  try {
    players = await fetchPlayers();
  } catch (e) {
    logger.error('Failed to load players', e);
    error = true;
  }

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Trade Centre</h1>
        <Link href="/rankings" className="text-blue-600 underline">
          View full rankings
        </Link>
      </header>

      <p className="text-sm text-gray-600">
        Player values are standardised via z‑scores across multiple categories.
      </p>

      {error ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          <strong className="block">Unable to reach rankings service.</strong>
          <p className="mt-1 text-sm">Check API configuration.</p>
        </div>
      ) : (
        <TradeCentreShellClient players={players} />
      )}
    </main>
  );
}