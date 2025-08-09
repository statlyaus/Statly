// src/app/tradecentre/page.tsx
export const runtime = 'nodejs';

import { getPlayers } from '@/lib/data';
import TradeCentreClient from '@/components/TradeCentreClient';

// (Optional future sidebars – keep as placeholders for now)
function MyRosterSidebar() {
  return (
    <aside className="hidden lg:block bg-gray-800/60 rounded-xl p-4">
      <h2 className="text-lg font-semibold mb-2">My Team</h2>
      <p className="text-gray-400 text-sm">Add your roster here later.</p>
    </aside>
  );
}

function TradeBasketSidebar() {
  return (
    <aside className="hidden lg:block bg-gray-800/60 rounded-xl p-4 sticky top-20">
      <h2 className="text-lg font-semibold mb-2">Trade Basket</h2>
      <p className="text-gray-400 text-sm">Selected players will appear here.</p>
    </aside>
  );
}

export default async function TradeCentrePage() {
  // Server-only: safe to read files/DB and secrets here
  const players = await getPlayers();

  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-3xl font-bold text-white mb-6">Trade Centre</h1>

      {/* 3‑column market layout on large screens */}
      <div className="grid gap-6 lg:grid-cols-[1fr_2fr_1fr]">
        <MyRosterSidebar />
        {/* All interactive UI lives in the client component */}
        <TradeCentreClient initialPlayers={players} />
        <TradeBasketSidebar />
      </div>
    </main>
  );
}