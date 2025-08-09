import TradeCentreShell from '@/components/TradeCentreShell';
import { getPlayers } from '@/lib/data';

export default async function Tradecentre() {
  const initialPlayers = await getPlayers();

  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-3xl font-bold text-white mb-4">Trade Centre</h1>
      {/* ❌ remove teams prop */}
      <TradeCentreShell initialPlayers={initialPlayers} />
    </main>
  );
}