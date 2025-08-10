// src/app/tradecentre/page.tsx
import * as React from 'react';
import Link from 'next/link';
import TradeCentreShellClient from './TradeCentreShellClient';
import type { PlayerLite } from '@/types';

// --- server-side fetch of a small player list to render the page ---
async function fetchPlayers(): Promise<PlayerLite[]> {
  const origin = process.env.INTERNAL_ORIGIN ?? 'http://127.0.0.1:3000';
  // we’ll piggyback on the rankings endpoint just to get ids/names/teams/positions quickly
  const url = `${origin}/api/rankings?perGame=1&winsorP=0.01&includeDE=0`;

  const res = await fetch(url, { cache: 'no-store' });
  const ct = res.headers.get('content-type') ?? '';
  const body = await res.text();

  if (!res.ok || !ct.includes('application/json')) return [];
  const data = JSON.parse(body) as {
    players: Array<{ id: string; name?: string; team?: string; position?: string }>;
  };

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
  let error: string | null = null;

  try {
    players = await fetchPlayers();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
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
          <strong className="block">Failed to load players</strong>
          <pre className="mt-1 whitespace-pre-wrap text-xs">{error}</pre>
        </div>
      ) : (
        <TradeCentreShellClient players={players} />
      )}
    </main>
  );
}