// src/app/rankings/page.tsx
import RankingsTable, { type PlayerRow } from './RankingsTable';

async function fetchPlayers(): Promise<PlayerRow[]> {
  const origin = process.env.INTERNAL_ORIGIN ?? 'http://127.0.0.1:3000';
  const url = `${origin}/api/rankings?perGame=1&winsorP=0.01&includeDE=0`;

  const res = await fetch(url, { cache: 'no-store' });
  const ct = res.headers.get('content-type') ?? '';
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`Rankings API ${res.status} ${res.statusText}: ${body.slice(0,160)}`);
  }
  if (!ct.includes('application/json')) {
    throw new Error(
      `Expected JSON but got: ${ct || 'unknown'}; first bytes: ${body.slice(0,160)}`
    );
  }

  const data = JSON.parse(body) as { players: PlayerRow[] };
  return data.players;
}

export default async function RankingsPage() {
  const players = await fetchPlayers();
  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Player Rankings</h1>
      <RankingsTable players={players} />
    </main>
  );
}