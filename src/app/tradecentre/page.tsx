// src/app/tradecentre/page.tsx
import * as React from 'react';
import Link from 'next/link';

type PlayerLite = { id: string; name: string; team?: string; position?: string };
type RankingsMap = Map<string, { totalValue: number; rank: number }>;

type RankingsResponse = {
  players: Array<{
    id: string;
    name?: string;
    team?: string;
    position?: string;
    totalValue: number;
    rank: number;
  }>;
  categoriesUsed: string[];
  generatedAt: string;
};

async function fetchRankings(): Promise<RankingsMap> {
  const origin = process.env.INTERNAL_ORIGIN ?? 'http://127.0.0.1:3000';
  const url = `${origin}/api/rankings?includeDE=0&perGame=1&winsorP=0.01`;

  const res = await fetch(url, { cache: 'no-store' });
  const ct = res.headers.get('content-type') ?? '';
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`Rankings API ${res.status} ${res.statusText}: ${body.slice(0, 160)}`);
  }
  if (!ct.includes('application/json')) {
    throw new Error(`Expected JSON but got: ${ct || 'unknown'}; first bytes: ${body.slice(0, 160)}`);
  }

  const data: RankingsResponse = JSON.parse(body);
  const map: RankingsMap = new Map();
  for (const p of data.players) {
    map.set(p.id, { totalValue: p.totalValue, rank: p.rank });
  }
  return map;
}

async function fetchPlayers(): Promise<PlayerLite[]> {
  const origin = process.env.INTERNAL_ORIGIN ?? 'http://127.0.0.1:3000';
  const url = `${origin}/api/rankings?includeDE=0&perGame=1&winsorP=0.01`;

  const res = await fetch(url, { cache: 'no-store' });
  const ct = res.headers.get('content-type') ?? '';
  const txt = await res.text();
  if (!res.ok || !ct.includes('application/json')) return [];

  const data: RankingsResponse = JSON.parse(txt);
  return data.players.slice(0, 30).map((p) => ({
    id: p.id,
    name: p.name ?? p.id,
    team: p.team,
    position: p.position,
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
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          <strong className="block">Failed to load rankings</strong>
          <pre className="mt-1 whitespace-pre-wrap text-xs">{error}</pre>
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