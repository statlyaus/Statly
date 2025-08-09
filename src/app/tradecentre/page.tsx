// src/app/tradecentre/page.tsx
import * as React from 'react';
import Link from 'next/link';
import { RankingsProvider } from './RankingsContext';
import type { RankingsMap } from './RankingsContext';

type RankingsResponse = {
  players: Array<{
    id: string;
    name: string;
    team?: string;
    games?: number;
    totalValue: number;
    rank: number;
    categoryScores: Record<string, number>;
  }>;
  categoriesUsed: string[];
  generatedAt: string;
};

export const metadata = {
  title: 'Trade Centre • Statly',
  description: 'Manage trades with live player rankings and value signals.',
};

function getBaseUrl(): string {
  // Prefer an explicit public URL if you’ve set it
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  // Vercel-style env var gives just the host
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  // Local dev fallback
  return 'http://localhost:3000';
}

/**
 * Fetch rankings via absolute URL (works in RSC in Next 15).
 * Includes strong guards so HTML responses (e.g., 404 pages) don’t break JSON parsing.
 */
async function fetchRankings(): Promise<RankingsMap> {
  const base = getBaseUrl();
  const url = `${base}/api/rankings?includeDE=0&perGame=1&winsorP=0.01`;

  const res = await fetch(url, { next: { revalidate: 600 } });

  const body = await res.text();
  const ct = res.headers.get('content-type') ?? '';

  if (!res.ok) {
    throw new Error(`Rankings API ${res.status} ${res.statusText}: ${body.slice(0, 180)}`);
  }
  if (!ct.includes('application/json')) {
    throw new Error(
      `Expected JSON from /api/rankings but got "${ct}". First 120 chars: ${body.slice(0, 120)}`
    );
  }

  const data = JSON.parse(body) as RankingsResponse;

  const map: RankingsMap = new Map();
  for (const p of data.players) {
    map.set(String(p.id), { totalValue: p.totalValue, rank: p.rank });
  }
  return map;
}

export default async function TradeCentrePage() {
  const rankingsMap = await fetchRankings();

  return (
    <RankingsProvider value={rankingsMap}>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <header className="mb-6 flex items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Trade Centre</h1>
            <p className="mt-1 text-sm text-gray-500">
              Player values are standardised via z‑scores across multiple categories.
            </p>
          </div>
          <nav className="text-sm">
            <Link href="/rankings" className="underline hover:no-underline">
              View full rankings
            </Link>
          </nav>
        </header>

        {/* Your existing Trade Centre UI goes here */}

        <section className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          <div>
            Rankings loaded for <strong>{rankingsMap.size}</strong> players.
          </div>
          <div className="mt-1">
            <span className="rounded bg-white px-2 py-1">
              Example lookup (for dev only):{' '}
              <code>useRankings().get(&#39;&lt;playerId&gt;&#39;)?.totalValue</code>
            </span>
          </div>
        </section>
      </main>
    </RankingsProvider>
  );
}