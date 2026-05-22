import type { JSX } from 'react';

import { cookies } from 'next/headers';
import Link from 'next/link';

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

const stateActionClassName =
  'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const primaryStateActionClassName = `${stateActionClassName} bg-primary text-primary-foreground hover:bg-primary/90`;
const secondaryStateActionClassName = `${stateActionClassName} border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground`;

function PlayersPageState({
  title,
  description,
  detail,
  statusRole,
}: {
  title: string;
  description: string;
  detail?: string;
  statusRole: 'alert' | 'status';
}): JSX.Element {
  return (
    <section
      className="mx-auto flex min-h-[calc(100vh-9rem)] w-full max-w-[var(--app-shell-max-width)] items-center px-4 py-10 sm:px-6 lg:px-8 2xl:px-10"
      aria-live={statusRole === 'alert' ? 'assertive' : 'polite'}
      role={statusRole}
    >
      <div className="w-full rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Player data
          </p>
          <h1 className="mt-3 text-balance text-3xl font-black text-foreground sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 text-sm leading-7 text-muted-foreground sm:text-base">
            {description}
          </p>
          {detail ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p> : null}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href="/players?retry=1" className={primaryStateActionClassName}>
            Retry player load
          </Link>
          <Link href="/login?next=%2Fplayers" className={secondaryStateActionClassName}>
            Sign in for league view
          </Link>
        </div>
      </div>
    </section>
  );
}

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

    if (result.players.length === 0) {
      return (
        <PlayersPageState
          statusRole="status"
          title="No player data is available yet."
          description="The player table loaded successfully, but there are no players for the selected season or league context."
          detail={`Season ${result.season} returned no rows. Try again, clear any saved player filters, or sign in to access your league-specific player view.`}
        />
      );
    }

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
    return (
      <PlayersPageState
        statusRole="alert"
        title="Player data could not be loaded."
        description="The player research page is available, but the current data request failed before the table could render."
        detail="Try loading the page again. If you are opening a league-specific player view, sign in so Statly can confirm your league access."
      />
    );
  }
}
