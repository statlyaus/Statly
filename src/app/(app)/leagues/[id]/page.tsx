import type React from 'react';
import LeaguePageClient from './LeaguePageClient';
import { adminAuth } from '@/lib/firebaseAdmin';
import {
  DEVELOPMENT_AUTH_COOKIE,
  DEVELOPMENT_AUTH_USER_ID,
  isDevelopmentAuthEnabled,
} from '@/lib/devAuth';
import { loadAuthorizedLeagueDetail } from '@/server/leagues/leagueDetail';
import { cookies, headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const userId = await getLeaguePageUserId();
  const result = await loadAuthorizedLeagueDetail(id, userId);

  if (!result.ok) {
    return (
      <LeaguePageClient
        league={null}
        members={[]}
        leagueId={id}
        initialUserId={userId}
        errorMsg={toLeaguePageError(id, result.status)}
      />
    );
  }

  return (
    <LeaguePageClient
      league={result.league}
      members={result.members}
      leagueId={id}
      initialUserId={userId}
    />
  );
}

async function getLeaguePageUserId(): Promise<string | null> {
  const headerStore = await headers();
  const cookieStore = await cookies();

  if (isDevelopmentAuthEnabled()) {
    const devUser = headerStore.get('x-auth-user');
    if (devUser) return devUser;

    const devCookieUser = cookieStore.get(DEVELOPMENT_AUTH_COOKIE)?.value;
    if (devCookieUser) return devCookieUser;

    return process.env.BYPASS_UID || process.env.NEXT_PUBLIC_BYPASS_UID || DEVELOPMENT_AUTH_USER_ID;
  }

  const sessionCookie = cookieStore.get('statly_session')?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    return decoded.uid ?? null;
  } catch {
    return null;
  }
}

function toLeaguePageError(leagueId: string, status: number): string {
  if (status === 401) return 'Sign in to view this league.';
  if (status === 403) return 'You do not have access to this league.';
  if (status === 404) return `League not found (${leagueId}).`;
  return `Failed to load league (${leagueId}) status=${status}`;
}
