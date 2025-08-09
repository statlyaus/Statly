// src/app/tradecentre/page.tsx
export const runtime = 'nodejs';

import TradeCentreShell from '@/components/TradeCentreShell';
import { getPlayers } from '@/lib/data';

export default async function Tradecentre() {
  const players = await getPlayers();
  const teams = Array.from(new Set(players.map(p => p.team).filter(Boolean))) as string[];

  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-3xl font-bold text-white mb-6 text-center">Trade Centre</h1>
      <TradeCentreShell initialPlayers={players} teams={teams} />
    </main>
  );
}