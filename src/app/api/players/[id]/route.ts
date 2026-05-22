export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getPlayer } from '@/lib/data';
import { adminDb } from '@/lib/firebaseAdmin';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { getLeagueOwnershipMap } from '@/lib/leagueOwnership';
import { logger } from '@/lib/logger';
import { buildCanonicalPlayerId } from '@/lib/playerIdentity';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import type { Player } from '@/types/players';

type PlayerStatSnapshot = {
  goals?: number;
  kicks?: number;
  handballs?: number;
  marks?: number;
  tackles?: number;
  disposals?: number;
  hitouts?: number;
  clearances?: number;
  inside50s?: number;
  rebound50s?: number;
  contestedPossessions?: number;
  effectiveDisposals?: number;
  scoreInvolvements?: number;
  intercepts?: number;
  contestedMarks?: number;
  metresGained?: number;
};

type LatestPlayerStats = {
  stats: PlayerStatSnapshot;
  team?: string;
  playerName?: string;
};

const CURRENT_YEAR = new Date().getFullYear();
let cachedStatsSeason: number | null = null;

function parseNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractStat(
  stats: Record<string, unknown>,
  data: Record<string, unknown>,
  key: string,
  altKey?: string
): number | undefined {
  const direct = parseNumber(stats[key]) ?? parseNumber(data[key]);
  if (direct != null) return direct;
  if (altKey) return parseNumber(stats[altKey]) ?? parseNumber(data[altKey]);
  return undefined;
}

function toStatSnapshot(data: Record<string, unknown>): PlayerStatSnapshot {
  const stats = (data.stats as Record<string, unknown> | undefined) ?? {};
  const kicks = extractStat(stats, data, 'kicks');
  const handballs = extractStat(stats, data, 'handballs');
  const disposals = extractStat(stats, data, 'disposals') ?? (kicks ?? 0) + (handballs ?? 0);

  return {
    goals: extractStat(stats, data, 'goals'),
    kicks,
    handballs,
    disposals,
    marks: extractStat(stats, data, 'marks'),
    tackles: extractStat(stats, data, 'tackles'),
    hitouts: extractStat(stats, data, 'hitouts', 'hit_outs'),
    clearances: extractStat(stats, data, 'clearances'),
    inside50s: extractStat(stats, data, 'inside50s', 'inside_50s'),
    rebound50s: extractStat(stats, data, 'rebound50s', 'rebound_50s'),
    contestedPossessions: extractStat(stats, data, 'contested_possessions'),
    effectiveDisposals: extractStat(stats, data, 'effective_disposals'),
    scoreInvolvements: extractStat(stats, data, 'score_involvements'),
    intercepts: extractStat(stats, data, 'intercepts'),
    contestedMarks: extractStat(stats, data, 'contested_marks'),
    metresGained: extractStat(stats, data, 'metres_gained'),
  };
}

function getStatSortKey(data: Record<string, unknown>): number {
  const lastSeen = data.last_seen_at;
  if (typeof lastSeen === 'string') {
    const parsed = Date.parse(lastSeen);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return parseNumber(data.round ?? data.round_number) ?? 0;
}

async function resolveStatsSeason(): Promise<number> {
  if (cachedStatsSeason) return cachedStatsSeason;
  try {
    const snap = await adminDb.collection('player_match_stats').limit(500).get();
    let maxSeason = 0;
    snap.forEach((doc) => {
      const season = parseNumber(doc.data().season);
      if (season && season > maxSeason) maxSeason = season;
    });
    cachedStatsSeason = maxSeason || CURRENT_YEAR;
  } catch {
    cachedStatsSeason = CURRENT_YEAR;
  }
  return cachedStatsSeason;
}

async function getLatestStatsByName(name: string): Promise<LatestPlayerStats | null> {
  const season = await resolveStatsSeason();
  const snap = await adminDb
    .collection('player_match_stats')
    .where('season', '==', season)
    .where('player_name', '==', name)
    .get();
  if (snap.empty) return null;

  let latest: LatestPlayerStats | null = null;
  let latestKey = -Infinity;
  snap.forEach((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const key = getStatSortKey(data);
    if (key >= latestKey) {
      latestKey = key;
      latest = {
        stats: toStatSnapshot(data),
        team: typeof data.team === 'string' ? data.team : undefined,
        playerName: typeof data.player_name === 'string' ? data.player_name : undefined,
      };
    }
  });
  return latest;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let playerIdForLog = 'unknown';
  try {
    const { id } = await context.params;
    playerIdForLog = id;
    const leagueId = new URL(request.url).searchParams.get('leagueId') || undefined;

    const decodedId = decodeURIComponent(id);
    const nameCandidate = decodedId.replace(/[_-]+/g, ' ');
    let fallbackPlayer: Player | null = null;

    let player = await prisma.player.findUnique({ where: { id: decodedId } });
    if (!player) {
      fallbackPlayer = await getPlayer(decodedId);
    }
    if (!player && fallbackPlayer?.id) {
      player = await prisma.player.findUnique({ where: { id: fallbackPlayer.id } });
    }
    if (!player) {
      player = await prisma.player.findFirst({
        where: { name: nameCandidate },
      });
    }

    let responsePlayer: Player | null = null;
    if (player) {
      const latest = await getLatestStatsByName(player.name);
      const stats = latest?.stats ?? null;
      responsePlayer = {
        id: player.id,
        name: player.name,
        team: latest?.team ?? player.club,
        position: player.position,
        ...(stats ?? {}),
        stats: stats ?? {},
      };
    }

    if (!responsePlayer && fallbackPlayer) {
      const latest = await getLatestStatsByName(fallbackPlayer.name);
      responsePlayer = latest
        ? {
            ...fallbackPlayer,
            team: latest.team ?? fallbackPlayer.team,
            ...(latest.stats ?? {}),
            stats: latest.stats ?? fallbackPlayer.stats ?? {},
          }
        : fallbackPlayer;
    }

    if (!responsePlayer) {
      const latest = await getLatestStatsByName(nameCandidate);
      if (latest?.playerName) {
        responsePlayer = {
          id: buildCanonicalPlayerId(latest.playerName),
          name: latest.playerName,
          team: latest.team,
          ...(latest.stats ?? {}),
          stats: latest.stats ?? {},
        };
      }
    }

    if (!responsePlayer) {
      return commonErrors.notFound('Player not found');
    }

    if (leagueId) {
      const uid = await getAuthenticatedUserId(request);
      if (!uid) return commonErrors.unauthorized();
      const membership = await verifyLeagueMembership(leagueId, uid);
      if (!membership.isMember) return commonErrors.forbidden('Forbidden');
      const { totalTeams, counts } = await getLeagueOwnershipMap(leagueId, [responsePlayer.id]);
      const count = counts.get(responsePlayer.id) ?? 0;
      const ownership = totalTeams > 0 ? Math.round((count / totalTeams) * 100) : 0;
      responsePlayer = { ...responsePlayer, ownership };
    }

    return successResponse(responsePlayer);
  } catch (error) {
    logger.error('Failed to fetch player', error, { playerId: playerIdForLog });
    return commonErrors.internalServerError('Failed to fetch player');
  }
}
