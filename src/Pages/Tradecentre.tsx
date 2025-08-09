import OfferDock from '@/components/OfferDock';
import TradeCentreClient from '@/components/TradeCentreClient';
import { getPlayers } from '@/lib/data';

export default async function Tradecentre() {
  const initialPlayers = await getPlayers();
  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-3xl font-bold text-white mb-4">Trade Centre</h1>
      <div className="grid lg:grid-cols-[1fr_20rem] gap-6">
        <div>
          <TradeCentreClient initialPlayers={initialPlayers} />
        </div>
        <OfferDock />
      </div>
    </main>
  );
}