import { adminDb } from '@/lib/firebaseAdmin';
import { importFootywireRounds } from '@/lib/footywireImporter';
import { primeLeagueMatchupSlates } from '@/lib/leagueMatchupPrewarm';
import { logger } from '@/lib/logger';

import { parseLiveScoreboard, type LiveScoreboardMatch } from './footywireLive';

const LIVE_SCOREBOARD_PATH = 'live_scoreboard';
const LIVE_REFRESH_STATE_COLLECTION = '_system';
const LIVE_REFRESH_STATE_DOC = 'live_stats_refresh';

type RefreshState = {
  lastStartedAt?: string;
  lastCompletedAt?: string;
  season?: number;
  rounds?: number[];
  liveMatchMids?: string[];
  liveMatchCount?: number;
  lastTrigger?: string;
  lastResult?: 'refreshed' | 'throttled' | 'no_live_matches';
};

export type LiveStatsRefreshResult = {
  refreshed: boolean;
  reason: 'refreshed' | 'throttled' | 'no_live_matches';
  season: number | null;
  rounds: number[];
  liveMatchCount: number;
};

async function defaultFetchHtml(path: string): Promise<string> {
  const url = path.startsWith('http')
    ? path
    : new URL(path, 'https://www.footywire.com/afl/footy/').toString();
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-AU,en;q=0.9',
      Referer: 'https://www.footywire.com/',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Footywire live scoreboard request failed with status ${response.status}`);
  }

  return response.text();
}

export async function refreshLiveStatsIfNeeded(options?: {
  minIntervalMs?: number;
  trigger?: string;
  now?: Date;
  season?: number;
  force?: boolean;
  fetchHtml?: (path: string) => Promise<string>;
}): Promise<LiveStatsRefreshResult> {
  const minIntervalMs = options?.minIntervalMs ?? 30_000;
  const now = options?.now ?? new Date();
  const trigger = options?.trigger ?? 'request';
  const fetchHtml = options?.fetchHtml ?? defaultFetchHtml;
  const stateRef = adminDb.collection(LIVE_REFRESH_STATE_COLLECTION).doc(LIVE_REFRESH_STATE_DOC);
  const stateSnap = await stateRef.get();
  const state = (stateSnap.exists ? (stateSnap.data() as RefreshState) : undefined) ?? {};

  const scoreboardHtml = await fetchHtml(LIVE_SCOREBOARD_PATH);
  const parsed = parseLiveScoreboard(scoreboardHtml);
  const liveMatches = options?.season
    ? parsed.liveMatches.filter((match) => match.season === options.season)
    : parsed.liveMatches;

  if (liveMatches.length === 0) {
    await stateRef.set(
      {
        lastStartedAt: now.toISOString(),
        lastCompletedAt: now.toISOString(),
        lastTrigger: trigger,
        lastResult: 'no_live_matches',
        liveMatchCount: 0,
      },
      { merge: true }
    );

    return {
      refreshed: false,
      reason: 'no_live_matches',
      season: options?.season ?? null,
      rounds: [],
      liveMatchCount: 0,
    };
  }

  const liveSeason = liveMatches[0]?.season ?? options?.season ?? null;
  const rounds = Array.from(new Set(liveMatches.map((match) => match.roundNumber))).sort((a, b) => a - b);
  const liveMatchMids = Array.from(
    new Set(liveMatches.map((match) => match.footywireMid).filter((value): value is string => Boolean(value)))
  ).sort();
  const lastCompletedMs = state.lastCompletedAt ? Date.parse(state.lastCompletedAt) : Number.NaN;
  const isThrottled =
    !options?.force &&
    Number.isFinite(lastCompletedMs) &&
    now.getTime() - lastCompletedMs < minIntervalMs;

  if (isThrottled) {
    logger.info('Skipping live stats refresh because the throttle window is still active', {
      trigger,
      liveSeason,
      rounds,
      liveMatchCount: liveMatches.length,
    });

    return {
      refreshed: false,
      reason: 'throttled',
      season: liveSeason,
      rounds,
      liveMatchCount: liveMatches.length,
    };
  }

  await stateRef.set(
    {
      lastStartedAt: now.toISOString(),
      lastTrigger: trigger,
      season: liveSeason,
      rounds,
      liveMatchMids,
      liveMatchCount: liveMatches.length,
    },
    { merge: true }
  );

  await importFootywireRounds({
    season: liveSeason ?? now.getUTCFullYear(),
    rounds,
    liveMatches: liveMatches as LiveScoreboardMatch[],
  });

  if (liveSeason !== null) {
    await Promise.all(
      rounds.map((round) =>
        primeLeagueMatchupSlates({
          season: liveSeason,
          round,
          status: 'in_progress',
        })
      )
    );
  }

  await stateRef.set(
    {
      lastCompletedAt: now.toISOString(),
      lastTrigger: trigger,
      lastResult: 'refreshed',
      season: liveSeason,
      rounds,
      liveMatchMids,
      liveMatchCount: liveMatches.length,
    },
    { merge: true }
  );

  return {
    refreshed: true,
    reason: 'refreshed',
    season: liveSeason,
    rounds,
    liveMatchCount: liveMatches.length,
  };
}
