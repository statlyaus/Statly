// src/app/rankings/page.tsx
import { headers } from 'next/headers';
import type { RankingsResponse } from '@/types/players';
import RankingsTable from './RankingsTable';

export const revalidate = 600; // 10 minutes, align with API cache

export const metadata = {
  title: 'Player Rankings • Statly',
  description:
    'Standardised AFL player rankings using z-scores across multiple categories with equal weighting.',
};

type FetchOpts = {
  includeDE?: boolean;
  perGame?: boolean;
  winsorP?: number;
};

async function fetchRankings(opts: FetchOpts = {}): Promise<RankingsResponse> {
  const { includeDE = false, perGame = true, winsorP = 0.01 } = opts;

  // Build absolute URL for SSR
  const h = await headers();
  const host =
    h.get('x-forwarded-host') ??
    h.get('host') ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https');

  const url = `${proto}://${host}/api/rankings?includeDE=${includeDE ? '1' : '0'}&perGame=${
    perGame ? '1' : '0'
  }&winsorP=${winsorP}`;

  const res = await fetch(url, { next: { revalidate } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Rankings fetch failed (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as RankingsResponse;
}

export default async function RankingsPage() {
  try {
    const data = await fetchRankings({
      includeDE: false, // your rule-of-thumb default
      perGame: true,
      winsorP: 0.01,
    });

    return (
      <main className="mx-auto max-w-7xl px-4 py-6">
        <header className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Player Rankings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Z‑score normalisation across selected categories with equal weighting. Data refreshes
            periodically.
          </p>
        </header>

        <section aria-busy="false">
          <RankingsTable
            initialData={data}
            defaultIncludeDE={false}
            defaultPerGame={true}
            defaultWinsorP={0.01}
          />
        </section>
      </main>
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error loading rankings';
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <header className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Player Rankings</h1>
        </header>
        <section
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800"
        >
          <h2 className="font-semibold">Failed to load rankings</h2>
          <p className="text-sm mt-1">{msg}</p>
        </section>
      </main>
    );
  }
}