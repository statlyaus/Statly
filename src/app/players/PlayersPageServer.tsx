import type { Player } from '@/types/players';
import { fetchFromAPI } from '@/lib/api';
import PlayersPageClient from './PlayersPageClient';

export default async function PlayersPageServer() {
  let players: Player[] = [];
  try {
    const data = await fetchFromAPI<{ players: Player[] }>('/api/players');
    players = data.players;
  } catch (err) {
    console.error('Failed to fetch players:', err);
    return <div className="p-4 text-red-500">Failed to load players.</div>;
  }

  return <PlayersPageClient players={players} />;
}
