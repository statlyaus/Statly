import type { Player } from '@/types/players';
import { getPlayers } from '@/lib/data';
import PlayersPageClient from './PlayersPageClient';

export default async function PlayersPageServer() {
  let players: Player[] = [];
  try {
    players = await getPlayers();
  } catch (err) {
    console.error('Failed to fetch players:', err);
    return <div className="p-4 text-red-500">Failed to load players.</div>;
  }

  return <PlayersPageClient players={players} />;
}

