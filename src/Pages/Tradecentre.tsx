import { TradeStoreProvider } from '@/state/tradeStore';
import TradeCentreClient from '@/components/TradeCentreClient';
import TradeBasket from '@/components/TradeBasket';
import { getPlayers } from '@/lib/data';

export default async function Tradecentre() {
  const players = await getPlayers();

  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-3xl font-bold text-white mb-4">Trade Centre</h1>
      <TradeStoreProvider>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <TradeCentreClient initialPlayers={players} />
          <div className="lg:sticky lg:top-24">
            <TradeBasket />
          </div>
        </div>
      </TradeStoreProvider>
    </main>
  );
}