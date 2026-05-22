import 'server-only';
import { cookies } from 'next/headers';

import {
  LAST_LEAGUE_ID_COOKIE,
  parseLeaguePreference,
  readCookiePreference,
  readSearchParam,
} from '@/lib/uiPreferences';

import PlayerPageClient from './PlayerPageClient';

export default async function PlayerPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const cookieStore = await cookies();
  const initialLeagueId = parseLeaguePreference(
    readSearchParam(resolvedSearchParams, 'league') ??
      readCookiePreference(cookieStore, LAST_LEAGUE_ID_COOKIE)
  );

  return <PlayerPageClient initialLeagueId={initialLeagueId} />;
}
