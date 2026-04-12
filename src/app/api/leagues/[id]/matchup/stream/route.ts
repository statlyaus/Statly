import type { NextRequest } from 'next/server';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import {
  buildLeagueMatchupContext,
  resolveLeagueRoundMatchups,
  type LeagueRoundMatchupDocument as MatchupDocument,
} from '@/lib/leagueMatchupRoundResolver';
import { ensureLeagueSeasonMaterialized, getMaterializedSeasonFreshness } from '@/lib/leagueSeason';
import {
  buildOtherMatchupSummaries,
  buildSlateCacheKey,
  getCachedSlate,
  orientCachedMatchup,
  type CachedMatchupSlate,
} from '@/lib/leagueMatchupCache';
import { refreshLiveStatsIfNeeded } from '@/lib/liveStatsRefresh';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

export const runtime = 'nodejs';

const STREAM_BACKGROUND_MAINTENANCE_INTERVAL_MS = 30_000;
const STREAM_MAINTENANCE_STATE_TTL_MS = 5 * 60_000;

const maintenanceStateByLeague = new Map<
  string,
  {
    lastStartedAt: number;
    lastTouchedAt: number;
    inFlight: Promise<void> | null;
  }
>();

function getMatchupParticipantIds(matchup: MatchupDocument): {
  homeUserId?: string;
  awayUserId?: string;
} {
  const homeUserId = matchup.homeUserId ?? matchup.participants[0];
  const awayUserId =
    matchup.awayUserId ?? matchup.participants.find((participant) => participant !== homeUserId);
  return { homeUserId, awayUserId };
}

function serializeEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function getLeagueMaintenanceKey(input: { leagueId: string; season: number }) {
  return `${input.leagueId}:${input.season}`;
}

function pruneExpiredMaintenanceStates(now: number) {
  for (const [key, state] of maintenanceStateByLeague.entries()) {
    if (state.inFlight) continue;
    if (now - state.lastTouchedAt <= STREAM_MAINTENANCE_STATE_TTL_MS) continue;
    maintenanceStateByLeague.delete(key);
  }
}

function triggerThrottledStreamMaintenance(input: { leagueId: string; season: number }) {
  const now = Date.now();
  pruneExpiredMaintenanceStates(now);

  const key = getLeagueMaintenanceKey(input);
  const existingState = maintenanceStateByLeague.get(key);
  if (existingState) {
    existingState.lastTouchedAt = now;
    if (
      existingState.inFlight ||
      now - existingState.lastStartedAt < STREAM_BACKGROUND_MAINTENANCE_INTERVAL_MS
    ) {
      return;
    }
  }

  const state = existingState ?? {
    lastStartedAt: 0,
    lastTouchedAt: now,
    inFlight: null,
  };
  state.lastStartedAt = now;
  state.lastTouchedAt = now;

  state.inFlight = (async () => {
    await refreshLiveStatsIfNeeded({
      minIntervalMs: STREAM_BACKGROUND_MAINTENANCE_INTERVAL_MS,
      trigger: 'league-matchup-stream',
      season: input.season,
    }).catch((error) => {
      logger.warn('Failed to refresh live stats while serving matchup stream', {
        leagueId: input.leagueId,
        season: input.season,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    const freshness = await getMaterializedSeasonFreshness({
      leagueId: input.leagueId,
      season: input.season,
    }).catch((error) => {
      logger.warn('Failed to check league season freshness while serving matchup stream', {
        leagueId: input.leagueId,
        season: input.season,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    if (!freshness?.stale) {
      return;
    }

    await ensureLeagueSeasonMaterialized({
      leagueId: input.leagueId,
      season: input.season,
    }).catch((error) => {
      logger.warn('Failed to re-materialize league season while serving matchup stream', {
        leagueId: input.leagueId,
        season: input.season,
        reason: freshness.reason,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  })().finally(() => {
    state.inFlight = null;
    state.lastTouchedAt = Date.now();
  });

  maintenanceStateByLeague.set(key, state);
}

function buildPayloadFromSlate(
  slate: CachedMatchupSlate,
  selectedMatchupId: string,
  authUserId: string,
  myCurrentMatchupId: string
) {
  const selected = slate.matchups.find((matchup) => matchup.matchupId === selectedMatchupId);
  if (!selected) return null;

  const oriented = orientCachedMatchup(selected, authUserId, myCurrentMatchupId);
  return {
    matchupId: oriented.matchupId,
    leagueId: slate.leagueId,
    leagueName: slate.leagueName,
    season: slate.season,
    round: slate.round,
    roundLabel: slate.roundLabel,
    status: slate.status,
    live: slate.live,
    lastUpdated: slate.lastUpdated,
    completedTeams: slate.completedTeams ?? [],
    home: oriented.home,
    away: oriented.away,
    categories: oriented.categories,
    otherMatchups: buildOtherMatchupSummaries(slate, oriented.matchupId),
  };
}

async function resolveCurrentMatchupContext(input: {
  leagueId: string;
  season: number;
  authUserId: string;
  selectedMatchupId: string | null;
  requestedRound: number | null;
}) {
  const resolvedRoundMatchups = await resolveLeagueRoundMatchups({
    leagueId: input.leagueId,
    season: input.season,
    requestedRound: input.requestedRound,
  });
  return buildLeagueMatchupContext({
    authUserId: input.authUserId,
    selectedMatchupId: input.selectedMatchupId,
    round: resolvedRoundMatchups.round,
    roundMatchups: resolvedRoundMatchups.roundMatchups,
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authUserId = await getAuthenticatedUserId(request);
  if (!authUserId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const categories =
    searchParams
      .get('categories')
      ?.split(',')
      .map((value) => value.trim())
      .filter((value): value is FantasyCategoryKey => value in FANTASY_CATEGORIES) ?? [];
  if (categories.length === 0) {
    return new Response('At least one scoring category is required', { status: 400 });
  }

  const selectedMatchupId = searchParams.get('matchupId')?.trim() || null;
  const requestedRoundParam = searchParams.get('round');
  const requestedRound =
    requestedRoundParam && Number.isFinite(Number(requestedRoundParam))
      ? Number(requestedRoundParam)
      : null;
  const { id: leagueId } = await params;
  const effectiveCategories =
    leagueId === 'test-league-id' && categories.length === 0
      ? (['goals', 'kicks', 'marks', 'tackles', 'inside50s'] as FantasyCategoryKey[])
      : categories;

  if (leagueId === 'test-league-id') {
    const encoder = new TextEncoder();
    const round = requestedRound ?? 2;
    const matchupId = selectedMatchupId || 'matchup-1';
    const payload = {
      matchupId,
      leagueId,
      leagueName: 'Test AFL Champions League',
      season: getDefaultAflSeason(),
      round,
      roundLabel: `Round ${round}`,
      status: 'in_progress' as const,
      live: true,
      lastUpdated: new Date().toISOString(),
      completedTeams: ['Carlton', 'Geelong'],
      home: {
        userId: authUserId,
        memberId: 'test-member-1',
        teamName: 'Robbo Rockers',
        starters: [
          {
            id: 'player-1',
            name: 'Marcus Bontempelli',
            team: 'Western Bulldogs',
            position: 'MID',
            stats: { goals: 1, kicks: 18, marks: 6, tackles: 5, inside50s: 7 },
          },
          {
            id: 'player-2',
            name: 'Jordan Dawson',
            team: 'Adelaide',
            position: 'MID',
            stats: { goals: 0, kicks: 21, marks: 5, tackles: 4, inside50s: 6 },
          },
        ],
        summary: { wins: 3, losses: 1, ties: 1 },
      },
      away: {
        userId: 'bot-user-8',
        memberId: 'bot-member-8',
        teamName: 'Brownlow Medalists',
        starters: [
          {
            id: 'player-5',
            name: 'Zach Merrett',
            team: 'Essendon',
            position: 'MID',
            stats: { goals: 0, kicks: 20, marks: 4, tackles: 6, inside50s: 5 },
          },
          {
            id: 'player-6',
            name: 'Sam Walsh',
            team: 'Carlton',
            position: 'MID',
            stats: { goals: 1, kicks: 19, marks: 5, tackles: 5, inside50s: 4 },
          },
        ],
        summary: { wins: 1, losses: 3, ties: 1 },
      },
      categories: effectiveCategories.map((categoryKey) => ({
        key: categoryKey,
        label: FANTASY_CATEGORIES[categoryKey].label,
        home:
          categoryKey === 'goals'
            ? 4
            : categoryKey === 'kicks'
              ? 72
              : categoryKey === 'marks'
                ? 23
                : categoryKey === 'tackles'
                  ? 14
                  : categoryKey === 'inside50s'
                    ? 22
                    : 0,
        away:
          categoryKey === 'goals'
            ? 3
            : categoryKey === 'kicks'
              ? 76
              : categoryKey === 'marks'
                ? 19
                : categoryKey === 'tackles'
                  ? 18
                  : categoryKey === 'inside50s'
                    ? 18
                    : 0,
        winner:
          categoryKey === 'kicks' || categoryKey === 'tackles'
            ? ('away' as const)
            : ('home' as const),
      })),
      otherMatchups: [
        {
          matchupId: 'matchup-1',
          homeTeamName: 'Robbo Rockers',
          awayTeamName: 'Brownlow Medalists',
          homeScore: 3,
          awayScore: 1,
          leaderText: 'Robbo Rockers lead 3-1-1',
          isSelected: matchupId === 'matchup-1',
        },
      ],
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => {
          if (closed) return;
          controller.enqueue(encoder.encode(serializeEvent(event, data)));
        };

        send('connected', { leagueId, matchupId });
        send('matchup', payload);

        const heartbeatId = globalThis.setInterval(() => {
          send('heartbeat', { timestamp: new Date().toISOString() });
        }, 15000);

        const close = () => {
          if (closed) return;
          closed = true;
          globalThis.clearInterval(heartbeatId);
          controller.close();
        };

        request.signal.addEventListener('abort', close);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  const membership = await prisma.leagueMember.findFirst({
    where: { leagueId, userId: authUserId },
    select: { id: true },
  });
  if (!membership) {
    return new Response('Forbidden', { status: 403 });
  }

  const season = getDefaultAflSeason();
  let resolvedRoundMatchups = await resolveLeagueRoundMatchups({
    leagueId,
    season,
    requestedRound,
  });
  if (resolvedRoundMatchups.roundMatchups.length === 0) {
    await ensureLeagueSeasonMaterialized({ leagueId, season }).catch((error) => {
      logger.warn('Failed to materialize league season before opening matchup stream', {
        leagueId,
        season,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    resolvedRoundMatchups = await resolveLeagueRoundMatchups({
      leagueId,
      season,
      requestedRound,
    });
  }

  const initialContext = buildLeagueMatchupContext({
    authUserId,
    selectedMatchupId,
    round: resolvedRoundMatchups.round,
    roundMatchups: resolvedRoundMatchups.roundMatchups,
  });
  if (!initialContext) {
    return new Response('No current AFL round found', { status: 404 });
  }
  const { homeUserId, awayUserId } = getMatchupParticipantIds(initialContext.selectedMatchup);
  if (!homeUserId || !awayUserId) {
    return new Response('Selected matchup participants are incomplete', { status: 404 });
  }
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastFingerprint: string | null = null;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(serializeEvent(event, data)));
      };

      const publishLatest = async () => {
        try {
          const context = await resolveCurrentMatchupContext({
            leagueId,
            season,
            authUserId,
            selectedMatchupId,
            requestedRound,
          });
          if (!context) return;

          const cacheKey = buildSlateCacheKey(leagueId, season, context.round, categories);
          const slate = await getCachedSlate(cacheKey);
          if (!slate) return;

          const payload = buildPayloadFromSlate(
            slate,
            context.selectedMatchup.id,
            authUserId,
            context.myCurrentMatchup.id
          );
          if (!payload) return;

          const fingerprint = JSON.stringify({
            matchupId: payload.matchupId,
            round: payload.round,
            lastUpdated: payload.lastUpdated,
            status: payload.status,
            live: payload.live,
            categories: payload.categories,
          });
          if (fingerprint === lastFingerprint) return;

          lastFingerprint = fingerprint;
          send('matchup', payload);

          if (!slate.live && slate.status === 'final') {
            send('complete', { matchupId: payload.matchupId });
          }
        } catch (error) {
          logger.warn('Failed to publish matchup stream update', {
            leagueId,
            matchupId: initialContext.selectedMatchup.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      send('connected', { leagueId, matchupId: initialContext.selectedMatchup.id });
      triggerThrottledStreamMaintenance({ leagueId, season });
      void publishLatest();

      const heartbeatId = globalThis.setInterval(() => {
        send('heartbeat', { timestamp: new Date().toISOString() });
      }, 15000);

      const publishId = globalThis.setInterval(() => {
        triggerThrottledStreamMaintenance({ leagueId, season });
        void publishLatest();
      }, 5000);

      const close = () => {
        if (closed) return;
        closed = true;
        globalThis.clearInterval(heartbeatId);
        globalThis.clearInterval(publishId);
        controller.close();
      };

      request.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
