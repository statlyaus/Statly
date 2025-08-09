// src/app/tradecentre/page.tsx
import * as React from 'react';
import { headers } from 'next/headers';
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

async function fetchRankings(): Promise<RankingsMap> {
  // Build absolute URL for SSR
  const h = await headers();
  const host =
    h.get('x-forwarded-host') ??
    h.get('host') ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https');

  const url = `${proto}://${host}/api/rankings?includeDE=0&perGame=1&winsorP=0.01`;
  const res = await fetch(url, { next: { revalidate: 600 } });

  if (!res.ok) {
    // Non-fatal: return empty map so UI still renders
    return new Map();
  }

  const data = (await res.json()) as RankingsResponse;
  const map: RankingsMap = new Map();
  for (const p of data.players) {
    map.set(p.id, { totalValue: p.totalValue, rank: p.rank });
  }
  return map;
}

export default async function TradeCentrePage() {
  // Fetch rankings once on the server and provide to children
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

        {/* 
          Your existing Trade Centre UI goes here.
          Child components can now import:
            import { useRankings } from '@/app/tradecentre/RankingsContext';
          and render a chip with:
            const m = useRankings();
            const v = m.get(player.id);
        */}

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