// src/app/tradecentre/page.tsx
import * as React from 'react';
import TradeCentreShell from '@/components/TradeCentreShell';
import type { Player } from '@/types';

// --- server-side fetch of a small player list to render the page ---
async function fetchPlayers(): Promise<Player[]> {
  const origin = process.env.INTERNAL_ORIGIN ?? 'http://127.0.0.1:3000';
  const url = `${origin}/api/players`;

  const res = await fetch(url, { cache: 'no-store' });
  const ct = res.headers.get('content-type') ?? '';
  const body = await res.text();

  if (!res.ok || !ct.includes('application/json')) return [];
  const data = JSON.parse(body) as Player[];

  // Ensure required fields for TradeCentreShell
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    position: p.position,
    stats: p.stats ?? {},
  }));
}

export default async function TradeCentrePage() {
  let players: Player[] = [];
  let error: string | null = null;

  try {
    players = await fetchPlayers();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <div
          className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800"
          role="alert"
        >
          <strong className="block">Failed to load players</strong>
          <pre className="mt-1 whitespace-pre-wrap text-xs">{error}</pre>
        </div>
      </main>
    );
  }

  return <TradeCentreShell initialPlayers={players} />;
}