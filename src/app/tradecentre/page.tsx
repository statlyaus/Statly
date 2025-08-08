import { getPlayers } from '@/lib/data';
import type { Player } from '@/types';
import TradeCentreClient from '@/components/TradeCentreClient';

const TradeCentreStrings = {
  title: 'Trade Centre',
  error: 'Error loading players. Please try again later.',
};

export default async function TradeCentrePage() {
  let players: Player[] = [];
  let error: string | null = null;

  try {
    players = await getPlayers();
  } catch (err) {
    console.error('Failed to fetch players for Trade Centre:', err);
    error = TradeCentreStrings.error;
  }

  return (
    <div className="container mx-auto p-4 bg-gray-900 text-white min-h-screen">
      <h1 className="text-3xl font-bold mb-6 text-center">{TradeCentreStrings.title}</h1>

      {error
        ? <p className="text-red-500 text-center">{error}</p>
        : <TradeCentreClient initialPlayers={players} />
      }
    </div>
  );
}
