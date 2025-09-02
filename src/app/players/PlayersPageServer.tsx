import type { Player } from '@/types/players';
import { getPlayers } from '@/lib/data';
import PlayersPageClient from './PlayersPageClient';
import { logger } from '@/lib/logger';
import { unstable_cache } from 'next/cache';
import type { JSX } from 'react';

const getCachedPlayers = unstable_cache(() => getPlayers(), ['players:list:all'], {
  revalidate: 300,
  tags: ['players', 'players:list'],
});

export default async function PlayersPageServer(): Promise<JSX.Element> {
  let players: Player[] = [];
  try {
    players = await getCachedPlayers();
  } catch (err) {
    logger.error('Failed to fetch players', err);
    return <div className="p-4 text-red-500">Failed to load players.</div>;
  }

  return <PlayersPageClient players={players} />;
}
