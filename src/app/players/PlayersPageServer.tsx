import type { Player } from '@/types/players';
import { getPlayers } from '@/lib/data';
import PlayersPageClient from './PlayersPageClient';
import { logger } from '@/lib/logger';

export default async function PlayersPageServer() {
  let players: Player[] = [];
  try {
    players = await getPlayers();
  } catch (err) {
    logger.error('Failed to fetch players', err);
    return <div className="p-4 text-red-500">Failed to load players.</div>;
  }

  return <PlayersPageClient players={players} />;
}
