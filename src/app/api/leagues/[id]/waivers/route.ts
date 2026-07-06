import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { firestoreTimestampToDate } from '@/utils/firestore';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getLeagueMembershipAccess } from '@/server/leagues/membership';
import {
  buildAvailableDraftPlayer,
  calculateStatlyZScores,
  loadDraftPlayerStatsLookup,
  parseSelectedCategories,
  type DraftPlayerStatsLookup,
} from '@/server/draft/readModels/draftPlayerReadModel';
import {
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
  type PlayerStats,
} from '@/types/fantasyCategories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_PLAYERS_LIMIT = 100;
const MAX_PLAYERS_LIMIT = 200;
const DEFAULT_ACTIVITY_LIMIT = 50;
const MAX_ACTIVITY_LIMIT = 100;

type TimestampLike = { toDate(): Date } | Date | null | undefined;

interface WaiverClaimDoc {
  leagueId?: string;
  userId?: string;
  teamId?: string;
  playerId?: string;
  dropPlayerId?: string | null;
  priority?: number;
  status?: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
  processingAt?: TimestampLike;
  processedAt?: TimestampLike;
  createdAt?: TimestampLike;
  bidAmount?: number | null;
}

interface ActivityDoc {
  type?: string;
  userId?: string;
  teamId?: string;
  playerId?: string;
  dropPlayerId?: string | null;
  bidAmount?: number | null;
  priority?: number | null;
  claimId?: string;
  reason?: string;
  timestamp?: TimestampLike;
}

interface PlayerLite {
  id: string;
  name: string;
  team?: string;
  club?: string;
  position?: string;
  ownership?: number;
  avgPoints?: number;
  averagePoints?: number;
  fantasyPoints?: number;
  gamesPlayed?: number;
  stats?: Partial<PlayerStats>;
  statsTotal?: Partial<PlayerStats>;
  statlyZScore?: number;
  statlyZBreakdown?: Array<{ category: FantasyCategoryKey; value: number; zScore: number }>;
  statlyZMissingCategories?: FantasyCategoryKey[];
}

interface RosterLite {
  id: string;
  userId: string;
  teamName: string;
  playerIds: string[];
  bench: string[];
  emergencies: string[];
  leagueId: string;
  updatedAt: string;
  createdAt: string;
}

function readBoundedInt(raw: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(max, parsed));
}

function toIso(value: TimestampLike, fallback = new Date()): string {
  return (firestoreTimestampToDate(value) ?? fallback).toISOString();
}

function parsePlayerIds(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string') return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseActionDetails(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;

  try {
    const parsed = JSON.parse(String(raw ?? '{}'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toPlayerLite(player: {
  id: string;
  name: string;
  club?: string | null;
  position?: string | null;
}): PlayerLite {
  return {
    id: player.id,
    name: player.name,
    team: player.club ?? undefined,
    position: player.position ?? undefined,
  };
}

async function loadCurrentRoster(leagueId: string, userId: string): Promise<RosterLite | null> {
  const member = await prisma.leagueMember.findFirst({
    where: { leagueId, userId },
    select: { id: true, teamName: true },
  });
  if (!member) return null;

  const [roster, rosterRows] = await Promise.all([
    prisma.leagueRoster.findUnique({
      where: { leagueId_memberId: { leagueId, memberId: member.id } },
      select: {
        id: true,
        playerIds: true,
        benchOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.leagueRosterPlayer.findMany({
      where: { leagueId, memberId: member.id },
      orderBy: { createdAt: 'asc' },
      select: { playerId: true },
    }),
  ]);

  const playerIds =
    rosterRows.length > 0
      ? rosterRows.map((row) => row.playerId)
      : parsePlayerIds(roster?.playerIds);

  return {
    id: member.id,
    userId,
    teamName: member.teamName,
    playerIds,
    bench: parsePlayerIds(roster?.benchOrder),
    emergencies: [],
    leagueId,
    updatedAt: (roster?.updatedAt ?? new Date()).toISOString(),
    createdAt: (roster?.createdAt ?? new Date()).toISOString(),
  };
}

async function loadAvailablePlayers(input: {
  leagueId: string;
  limit: number;
  selectedCategories: FantasyCategoryKey[];
  statsLookup: DraftPlayerStatsLookup | null;
  cursor?: string;
}): Promise<{ items: PlayerLite[]; nextCursor: string | null }> {
  if (input.limit <= 0) {
    return { items: [], nextCursor: null };
  }

  const ownerships = await prisma.leagueRosterPlayer.findMany({
    where: { leagueId: input.leagueId },
    select: { playerId: true },
  });
  const waiverHolds = await prisma.teamAction.findMany({
    where: {
      leagueId: input.leagueId,
      actionType: 'DROP_PLAYER',
      status: 'PENDING',
      processingAt: { gt: new Date() },
    },
    select: { details: true },
  });
  const ownedPlayerIds = ownerships.map((ownership) => ownership.playerId);
  const heldPlayerIds = waiverHolds
    .map((hold) => parseActionDetails(hold.details).playerId)
    .filter((playerId): playerId is string => typeof playerId === 'string' && Boolean(playerId));
  const unavailablePlayerIds = [...new Set([...ownedPlayerIds, ...heldPlayerIds])];
  const idFilter: { notIn?: string[]; gt?: string } = {};

  if (unavailablePlayerIds.length > 0) {
    idFilter.notIn = unavailablePlayerIds;
  }
  if (input.cursor) {
    idFilter.gt = input.cursor;
  }

  const where = {
    active: true,
    ...(Object.keys(idFilter).length > 0 ? { id: idFilter } : {}),
  };
  const statlyZWhere = {
    active: true,
    ...(unavailablePlayerIds.length > 0 ? { id: { notIn: unavailablePlayerIds } } : {}),
  };
  const playerSelect = { id: true, name: true, club: true, position: true } as const;

  const [players, statlyZSourcePlayers] = await Promise.all([
    prisma.player.findMany({
      where,
      orderBy: { id: 'asc' },
      take: input.limit,
      select: playerSelect,
    }),
    prisma.player.findMany({
      where: statlyZWhere,
      orderBy: { id: 'asc' },
      select: playerSelect,
    }),
  ]);
  const statlyZCohortPlayers = statlyZSourcePlayers.map((player) =>
    buildAvailableDraftPlayer(player, input.statsLookup)
  );
  const statlyZScores = calculateStatlyZScores(statlyZCohortPlayers, input.selectedCategories);
  const items = players.map((player) => {
    const draftPlayer = buildAvailableDraftPlayer(player, input.statsLookup);
    const statlyZScore = statlyZScores.get(player.id);

    return {
      id: draftPlayer.id,
      name: draftPlayer.name,
      team: draftPlayer.club,
      club: draftPlayer.club,
      position: draftPlayer.position,
      ownership: 0,
      avgPoints: draftPlayer.avgPoints,
      averagePoints: draftPlayer.averagePoints,
      fantasyPoints: draftPlayer.fantasyPoints,
      gamesPlayed: draftPlayer.gamesPlayed,
      stats: draftPlayer.stats,
      statsTotal: draftPlayer.statsTotal,
      statlyZScore: statlyZScore?.score ?? 0,
      statlyZBreakdown: statlyZScore?.breakdown ?? [],
      statlyZMissingCategories: statlyZScore?.missingCategories ?? input.selectedCategories,
    };
  });
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: players.length === input.limit && last ? last.id : null,
  };
}

async function loadSelectedCategories(leagueId: string): Promise<FantasyCategoryKey[]> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { categoriesJson: true },
  });
  const selectedCategories = parseSelectedCategories(league?.categoriesJson);

  return selectedCategories.length > 0
    ? selectedCategories
    : [...REAL_DATA_NINE_CATEGORY_PRESET];
}

async function loadStatsLookup(leagueId: string): Promise<DraftPlayerStatsLookup | null> {
  try {
    return await loadDraftPlayerStatsLookup();
  } catch (error) {
    logger.warn('Waiver player stat enrichment unavailable', {
      leagueId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const userId = await getAuthenticatedUserId(req);

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getLeagueMembershipAccess(leagueId, userId);
  if (!access.isMember) {
    return NextResponse.json({ error: 'League membership required' }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const playersLimit = readBoundedInt(
      url.searchParams.get('playersLimit'),
      DEFAULT_PLAYERS_LIMIT,
      MAX_PLAYERS_LIMIT
    );
    const activityLimit = readBoundedInt(
      url.searchParams.get('activityLimit'),
      DEFAULT_ACTIVITY_LIMIT,
      MAX_ACTIVITY_LIMIT
    );
    const playersCursor = url.searchParams.get('playersCursor') || undefined;
    const activityCursor = url.searchParams.get('activityCursor') || undefined;
    const leagueRef = adminDb.collection('leagues').doc(leagueId);
    const [selectedCategories, statsLookup] = await Promise.all([
      loadSelectedCategories(leagueId),
      loadStatsLookup(leagueId),
    ]);

    let activityQuery: FirebaseFirestore.Query = leagueRef
      .collection('activity')
      .orderBy('timestamp', 'desc');
    if (activityCursor) {
      activityQuery = activityQuery.startAfter(new Date(activityCursor));
    }
    activityQuery = activityQuery.limit(activityLimit);

    const [
      claimsSnap,
      prioritySnap,
      activitySnap,
      settingsSnap,
      roster,
      availablePlayersResult,
    ] = await Promise.all([
      leagueRef.collection('waivers').where('userId', '==', userId).limit(100).get(),
      leagueRef.collection('waiverPriorities').doc(userId).get(),
      activityQuery.get(),
      leagueRef.collection('config').doc('settings').get(),
      loadCurrentRoster(leagueId, userId),
      loadAvailablePlayers({
        leagueId,
        limit: playersLimit,
        cursor: playersCursor,
        selectedCategories,
        statsLookup,
      }),
    ]);

    const claims = claimsSnap.docs
      .map((doc) => {
        const data = doc.data() as WaiverClaimDoc;
        const createdAt = toIso(data.createdAt);

        return {
          id: doc.id,
          userId: String(data.userId || userId),
          teamId: String(data.teamId || roster?.id || ''),
          playerId: String(data.playerId || ''),
          ...(data.dropPlayerId ? { dropPlayerId: String(data.dropPlayerId) } : {}),
          priority: Number(data.priority ?? 1),
          status: data.status || 'PENDING',
          createdAt,
          processingAt: data.processingAt ? toIso(data.processingAt) : undefined,
          processedAt: data.processedAt ? toIso(data.processedAt) : undefined,
          ...(typeof data.bidAmount === 'number' ? { bidAmount: data.bidAmount } : {}),
        };
      })
      .filter((claim) => claim.playerId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const activity = activitySnap.docs.map((doc) => {
      const data = doc.data() as ActivityDoc;

      return {
        id: doc.id,
        leagueId,
        type: String(data.type || ''),
        ...(data.userId ? { userId: String(data.userId) } : {}),
        ...(data.teamId ? { teamId: String(data.teamId) } : {}),
        ...(data.playerId ? { playerId: String(data.playerId) } : {}),
        ...(data.dropPlayerId ? { dropPlayerId: String(data.dropPlayerId) } : {}),
        ...(typeof data.bidAmount === 'number' ? { bidAmount: data.bidAmount } : {}),
        ...(typeof data.priority === 'number' ? { priority: data.priority } : {}),
        ...(data.claimId ? { claimId: String(data.claimId) } : {}),
        ...(data.reason ? { reason: String(data.reason) } : {}),
        timestamp: toIso(data.timestamp),
      };
    });

    const playerIdsForIndex = new Set<string>();
    for (const player of availablePlayersResult.items) playerIdsForIndex.add(player.id);
    for (const playerId of roster?.playerIds ?? []) playerIdsForIndex.add(playerId);
    for (const claim of claims) {
      playerIdsForIndex.add(claim.playerId);
      if (claim.dropPlayerId) playerIdsForIndex.add(claim.dropPlayerId);
    }
    for (const item of activity) {
      if (item.playerId) playerIdsForIndex.add(item.playerId);
      if (item.dropPlayerId) playerIdsForIndex.add(item.dropPlayerId);
    }

    const indexPlayers =
      playerIdsForIndex.size > 0
        ? await prisma.player.findMany({
            where: { id: { in: [...playerIdsForIndex] } },
            select: { id: true, name: true, club: true, position: true },
          })
        : [];
    const playersIndex: Record<string, PlayerLite> = Object.fromEntries(
      indexPlayers.map((player) => [player.id, toPlayerLite(player)])
    );
    for (const player of availablePlayersResult.items) {
      playersIndex[player.id] = player;
    }

    const priorityData = prioritySnap.exists
      ? (prioritySnap.data() as { remainingFAAB?: number })
      : undefined;
    const settingsData = settingsSnap.exists
      ? (settingsSnap.data() as { waiverSettings?: Record<string, unknown> })
      : undefined;
    const lastActivity = activity[activity.length - 1];

    return NextResponse.json(
      {
        claims,
        roster,
        activity,
        selectedCategories,
        remainingFAAB:
          typeof priorityData?.remainingFAAB === 'number' ? priorityData.remainingFAAB : undefined,
        initialSettings: settingsData?.waiverSettings
          ? { waiverSettings: settingsData.waiverSettings }
          : undefined,
        availablePlayers: availablePlayersResult.items,
        playersIndex,
        nextPlayersCursor: availablePlayersResult.nextCursor,
        activityNextCursor: lastActivity?.timestamp ?? null,
        activityHasMore: activity.length === activityLimit,
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('Failed to load league waivers', {
      leagueId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to load waiver data' }, { status: 500 });
  }
}
