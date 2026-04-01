import type { NextRequest } from 'next/server';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import {
  ensureLeagueSeasonMaterialized,
  getComputedLeagueRound,
  getComputedLeagueSeasonState,
  selectComputedLeagueRoundMatchups,
} from '@/lib/leagueSeason';
import {
  buildOtherMatchupSummaries,
  buildSlateCacheKey,
  getCachedSlate,
  orientCachedMatchup,
  type CachedMatchupSlate,
} from '@/lib/leagueMatchupCache';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

export const runtime = 'nodejs';

type MatchupDocument = {
  id: string;
  participants: string[];
  homeUserId?: string;
  awayUserId?: string;
  current?: boolean;
  aflRound?: number | string | null;
  roundLabel?: string;
};

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
  const state = await getComputedLeagueSeasonState({
    leagueId: input.leagueId,
    season: input.season,
  });
  const round =
    input.requestedRound ??
    getComputedLeagueRound({
      state,
      requestedRound: input.requestedRound,
    });
  if (round == null) {
    return null;
  }

  const roundMatchups = selectComputedLeagueRoundMatchups({ state, round }).map((matchup) => ({
    id: matchup.id,
    participants: matchup.participants,
    homeUserId: matchup.homeUserId,
    awayUserId: matchup.awayUserId,
    current: matchup.current,
    aflRound: matchup.aflRound,
    roundLabel: matchup.roundLabel,
  }));
  if (roundMatchups.length === 0) {
    return null;
  }

  const myCurrentMatchup = roundMatchups.find((matchup) =>
    matchup.participants.includes(input.authUserId)
  );
  if (!myCurrentMatchup) {
    return null;
  }

  const selectedMatchup =
    (input.selectedMatchupId
      ? roundMatchups.find((matchup) => matchup.id === input.selectedMatchupId)
      : undefined) ?? myCurrentMatchup;

  return {
    selectedMatchup,
    myCurrentMatchup,
    round,
  };
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

  const membership = await prisma.leagueMember.findFirst({
    where: { leagueId, userId: authUserId },
    select: { id: true },
  });
  if (!membership) {
    return new Response('Forbidden', { status: 403 });
  }

  const season = getDefaultAflSeason();
  await ensureLeagueSeasonMaterialized({ leagueId, season }).catch((error) => {
    logger.warn('Failed to auto-materialize league season before opening matchup stream', {
      leagueId,
      season,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const initialContext = await resolveCurrentMatchupContext({
    leagueId,
    season,
    authUserId,
    selectedMatchupId,
    requestedRound,
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
      void publishLatest();

      const heartbeatId = globalThis.setInterval(() => {
        send('heartbeat', { timestamp: new Date().toISOString() });
      }, 15000);

      const publishId = globalThis.setInterval(() => {
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
