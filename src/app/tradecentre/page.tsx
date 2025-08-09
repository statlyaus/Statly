// src/app/tradecentre/page.tsx
import * as React from 'react';
import Link from 'next/link';
import { headers } from 'next/headers';

type PlayerLite = { id: string; name: string; team?: string; position?: string };
type RankingsMap = Map<string, { totalValue: number; rank: number }>;

async function fetchRankings(): Promise<RankingsMap> {
  // Build absolute URL so Codespaces / proxies don’t return HTML
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const origin = `${proto}://${host}`;
  const url = `${origin}/api/rankings?includeDE=0&perGame=1&winsorP=0.01`;

  const res = await fetch(url, { cache: 'no-store' });
  const ct = res.headers.get('content-type') ?? '';
  const body = await res.text(); // read once

  if (!res.ok) {
    throw new Error(`Rankings API ${res.status} ${res.statusText}: ${body.slice(0, 160)}`);
  }
  if (!ct.includes('application/json')) {
    throw new Error(`Expected JSON but got: ${ct || 'unknown'}; first bytes: ${body.slice(0, 160)}`);
  }

  // Now safely parse
  const data = JSON.parse(body) as {
    players: Array<{ id: string; totalValue: number; rank: number }>;
  };

  const map: RankingsMap = new Map();
  for (const p of data.players) {
    map.set(p.id, { totalValue: p.totalValue, rank: p.rank });
  }
  return map;
}

async function fetchPlayers(): Promise<PlayerLite[]> {
  // Replace with your real source of players for Trade Centre
  // For now we just pull a small sample from rankings itself to demo
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const origin = `${proto}://${host}`;
  const url = `${origin}/api/rankings?includeDE=0&perGame=1&winsorP=0.01`;

  const res = await fetch(url, { cache: 'no-store' });
  const ct = res.headers.get('content-type') ?? '';
  const txt = await res.text();
  if (!res.ok || !ct.includes('application/json')) return [];
  const data = JSON.parse(txt) as {
    players: Array<{ id: string; name: string; team?: string; position?: string }>;
  };
  // Use only id/name/team/position here
  return data.players.slice(0, 30).map((p) => ({
    id: p.id,
    name: (p as any).name ?? p.id,
    team: (p as any).team,
    position: (p as any).position,
  }));
}

export default async function TradeCentrePage() {
  let players: PlayerLite[] = [];
  let rankings: RankingsMap = new Map();
  let error: string | null = null;

  try {
    [players, rankings] = await Promise.all([fetchPlayers(), fetchRankings()]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="mx-auto max-w-5xl p-4 space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Trade Centre</h1>
        <Link href="/rankings" className="text-blue-600 underline">
          View full rankings
        </Link>
      </header>

      <p className="text-sm text-gray-600">
        Player values are standardised via z‑scores across multiple categories.
      </p>

      {error ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">
          <strong>Failed to load rankings</strong>
          <div className="mt-1 whitespace-pre-wrap text-xs">{error}</div>
        </div>
      ) : (
        <>
          <div className="text-sm text-gray-500">
            Rankings loaded for {rankings.size} players.
          </div>

          <ul className="divide-y rounded-md border">
            {players.map((p) => {
              const val = rankings.get(p.id);
              return (
                <li key={p.id} className="flex items-center justify-between p-3">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-gray-500">
                      {p.team ?? '—'} {p.position ? `• ${p.position}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm">
                      {val ? val.totalValue.toFixed(3) : '—'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {val ? `Rank #${val.rank}` : 'Unranked'}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}