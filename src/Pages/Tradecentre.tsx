// src/app/tradecentre/page.tsx
export const runtime = 'nodejs';

import { getPlayers } from '@/lib/data';
import TradeCentreClient from '@/components/TradeCentreClient';
import OfferDock from '@/components/OfferDock';

export default async function Tradecentre() {
  const initialPlayers = await getPlayers();

  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-4">
        <h1 className="text-3xl font-bold text-white">Trade Centre</h1>
        <p className="text-sm text-gray-400">
          Build an offer on the right. Filter and sort players on the left.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section aria-label="Players">
          <TradeCentreClient initialPlayers={initialPlayers} />
        </section>

        <aside aria-label="Offer dock">
          <OfferDock />
        </aside>
      </div>
    </main>
  );
}