import { getPlayers } from '@/lib/data';
import TradeCentreShell from '@/components/TradeCentreShell';

export default async function TradecentrePage() {
  const initialPlayers = await getPlayers();

  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-3xl font-bold text-white mb-4">Trade Centre</h1>
      <TradeCentreShell initialPlayers={initialPlayers} />
    </main>
  );
}