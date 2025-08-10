import { getPlayers } from '@/lib/data';
import PlayersPageClient from './PlayersPageClient';

export default async function PlayersPageServer() {
  try {
    const players = await getPlayers();
    return <PlayersPageClient players={players} />;
  } catch (err) {
    console.error('Failed to fetch players:', err);
    return <div className="p-4 text-red-500">Failed to load players.</div>;
  }
}
