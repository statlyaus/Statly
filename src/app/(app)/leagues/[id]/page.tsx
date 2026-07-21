import type React from 'react';
import LeaguePageClient from './LeaguePageClient';
import { adminAuth } from '@/lib/firebaseAdmin';
import {
  DEVELOPMENT_AUTH_COOKIE,
  DEVELOPMENT_AUTH_USER_ID,
  isDevelopmentAuthEnabled,
} from '@/lib/devAuth';
import { loadAuthorizedLeagueDetail } from '@/server/leagues/leagueDetail';
import {
  loadAuthorizedLeagueTradeCentre,
  loadAuthorizedLeagueTradeDigest,
} from '@/server/leagues/trades/tradeReadModel';
import {
  TRADE_VIEWS,
  TradeServiceError,
  type TradeView,
} from '@/server/leagues/trades/tradeContracts';
import { cookies, headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function LeaguePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string; tradeView?: string; tradeCursor?: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
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

  const activeTradeView = toTradeView(query.tradeView);
  const [tradeCentreResult, tradeDigestResult] = await Promise.all([
    query.tab === 'trades'
      ? loadTradeCentre(id, userId, activeTradeView, query.tradeCursor)
      : Promise.resolve({ data: null, error: null }),
    loadTradeDigest(id, userId),
  ]);

  return (
    <LeaguePageClient
      league={result.league}
      members={result.members}
      leagueId={id}
      initialUserId={userId}
      initialTradeCentre={tradeCentreResult.data}
      initialTradeCentreError={tradeCentreResult.error}
      initialTradeDigest={tradeDigestResult.data}
    />
  );
}

function toTradeView(value: string | undefined): TradeView {
  return TRADE_VIEWS.includes(value as TradeView) ? (value as TradeView) : 'inbox';
}

async function loadTradeCentre(
  leagueId: string,
  userId: string | null,
  view: TradeView,
  cursor?: string
) {
  try {
    return {
      data: await loadAuthorizedLeagueTradeCentre({ leagueId, userId, view, cursor }),
      error: null,
    };
  } catch (error) {
    if (error instanceof TradeServiceError) {
      return { data: null, error: error.message };
    }
    console.error('Failed to load league trade centre', {
      leagueId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { data: null, error: 'The Trade Centre is temporarily unavailable.' };
  }
}

async function loadTradeDigest(leagueId: string, userId: string | null) {
  try {
    return { data: await loadAuthorizedLeagueTradeDigest({ leagueId, userId }) };
  } catch (error) {
    if (!(error instanceof TradeServiceError)) {
      console.error('Failed to load league trade digest', {
        leagueId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return { data: null };
  }
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
