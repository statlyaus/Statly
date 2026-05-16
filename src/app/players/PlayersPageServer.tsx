import type { JSX } from 'react';

import { cookies } from 'next/headers';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import {
  LAST_LEAGUE_ID_COOKIE,
  PLAYERS_SEASON_COOKIE,
  parseLeaguePreference,
  parseSeasonPreference,
  readCookiePreference,
  readSearchParam,
} from '@/lib/uiPreferences';
import { listPlayerPool } from '@/server/players/playerPool';

import PlayersPageClient from './PlayersPageClient';

export default async function PlayersPageServer({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<JSX.Element> {
  const cookieStore = await cookies();
  const requestedLeagueId = parseLeaguePreference(
    readSearchParam(searchParams, 'league') ??
      readCookiePreference(cookieStore, LAST_LEAGUE_ID_COOKIE)
  );
  const requestedSeason = parseSeasonPreference(
    readSearchParam(searchParams, 'season') ??
      readCookiePreference(cookieStore, PLAYERS_SEASON_COOKIE)
  );
  let verifiedLeagueId: string | undefined;

  if (requestedLeagueId) {
    try {
      const userId = await getAuthenticatedUserIdFromServerContext();
      if (userId) {
        const membership = await verifyLeagueMembership(requestedLeagueId, userId);
        if (membership.isMember) {
          verifiedLeagueId = requestedLeagueId;
        }
      }
    } catch (err) {
      logger.warn('Failed to verify standalone players league preference', {
        requestedLeagueId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    const result = await listPlayerPool({
      requestedSeason,
      leagueId: verifiedLeagueId,
      page: 1,
      limit: 1000,
      fallbackSeason: getDefaultAflSeason(),
    });

    return (
      <PlayersPageClient
        players={result.players}
        initialSeason={result.season}
        initialLeagueId={verifiedLeagueId}
        hasInitialSeasonPreference={requestedSeason != null}
      />
    );
  } catch (err) {
    logger.error('Failed to fetch players', err);
    return <div className="p-4 text-red-500">Failed to load players.</div>;
  }
}
