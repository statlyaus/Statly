import type { JSX } from 'react';

import { unstable_cache } from 'next/cache';
import { cookies } from 'next/headers';

import { getPlayers } from '@/lib/data';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  LAST_LEAGUE_ID_COOKIE,
  PLAYERS_SEASON_COOKIE,
  parseLeaguePreference,
  parseSeasonPreference,
  readCookiePreference,
  readSearchParam,
} from '@/lib/uiPreferences';
import { getDefaultAflSeason } from '@/lib/aflSeason';
import { resolveLatestProjectedSeason } from '@/server/readModels/playerReadModels';
import type { Player } from '@/types/players';

import PlayersPageClient from './PlayersPageClient';

const getCachedPlayers = unstable_cache(() => getPlayers(), ['players:list:all'], {
  revalidate: 300,
  tags: ['players', 'players:list'],
});

const getCachedPublishedSeason = unstable_cache(
  () => resolveLatestProjectedSeason(prisma, getDefaultAflSeason()),
  ['players:published-season'],
  {
    revalidate: 60,
    tags: ['players', 'players:list'],
  }
);

export default async function PlayersPageServer({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<JSX.Element> {
  let players: Player[] = [];
  let initialSeason = getDefaultAflSeason();
  try {
    [players, initialSeason] = await Promise.all([getCachedPlayers(), getCachedPublishedSeason()]);
  } catch (err) {
    logger.error('Failed to fetch players', err);
    return <div className="p-4 text-red-500">Failed to load players.</div>;
  }

  const cookieStore = await cookies();
  const requestedLeagueId = parseLeaguePreference(
    readSearchParam(searchParams, 'league') ??
      readCookiePreference(cookieStore, LAST_LEAGUE_ID_COOKIE)
  );
  const requestedSeason = parseSeasonPreference(
    readSearchParam(searchParams, 'season') ??
      readCookiePreference(cookieStore, PLAYERS_SEASON_COOKIE)
  );

  return (
    <PlayersPageClient
      players={players}
      initialSeason={requestedSeason ?? initialSeason}
      initialLeagueId={requestedLeagueId}
      hasInitialSeasonPreference={requestedSeason != null}
    />
  );
}
