export const runtime = 'nodejs';

// Updated to support higher limits for player linking functionality
import { NextResponse } from 'next/server';

import { z } from 'zod';

import { middlewareConfigs } from '@/lib/apiMiddleware';
import { buildPlayerStatsKey, getPlayers } from '@/lib/data';
import { adminDb } from '@/lib/firebaseAdmin';
import { getLeagueOwnershipDetails } from '@/lib/leagueOwnership';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { getCanonicalPlayerName } from '@/lib/playerName';
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

const STAT_CHUNK_SIZE = 10;
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
  const disposals =
    extractStat(stats, data, 'disposals') ??
    ((kicks ?? 0) + (handballs ?? 0));

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
  const round = parseNumber(data.round ?? data.round_number) ?? 0;
  return round;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length <= size) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function safeGetPlayerName(data: Record<string, unknown>, docId: string): string | null {
  try {
    return getCanonicalPlayerName(data, docId);
  } catch {
    return null;
  }
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

async function getLatestStatsByPlayerIds(
  playerIds: string[],
  nameKeyToId: Map<string, string>,
  nameOnlyToId: Map<string, string>,
  idToName: Map<string, string>,
  nameToId: Map<string, string>
): Promise<Map<string, PlayerStatSnapshot>> {
  if (playerIds.length === 0) return new Map();
  const season = await resolveStatsSeason();
  const targetIds = new Set(playerIds);
  const statsMap = new Map<string, { key: number; stats: PlayerStatSnapshot }>();

  const chunks = chunkArray(playerIds, STAT_CHUNK_SIZE);
  for (const chunk of chunks) {
    const foundIds = new Set<string>();
    if (chunk.length > 0) {
      const nameChunk = chunk
        .map((id) => idToName.get(id))
        .filter((name): name is string => typeof name === 'string' && name.length > 0);
      if (nameChunk.length > 0) {
        const nameSnap = await adminDb
          .collection('player_match_stats')
          .where('season', '==', season)
          .where('player_name', 'in', nameChunk)
          .get();

        nameSnap.forEach((doc) => {
          const data = doc.data() as Record<string, unknown>;
          const nameRaw =
            typeof data.player_name === 'string' ? data.player_name : safeGetPlayerName(data, doc.id);
          if (!nameRaw) return;
          const nameKey = nameRaw.toLowerCase();
          let playerId = nameToId.get(nameKey);
          if (!playerId) {
            const keyWithTeam = buildPlayerStatsKey(nameRaw, data.team as string | undefined);
            playerId = nameKeyToId.get(keyWithTeam);
          }
          if (!playerId || !targetIds.has(playerId)) return;
          foundIds.add(playerId);
          const sortKey = getStatSortKey(data);
          const existing = statsMap.get(playerId);
          if (!existing || sortKey >= existing.key) {
            statsMap.set(playerId, { key: sortKey, stats: toStatSnapshot(data) });
          }
        });
      }
    }
  }

  const out = new Map<string, PlayerStatSnapshot>();
  statsMap.forEach((value, key) => out.set(key, value.stats));
  return out;
}

const querySchema = z.object({
  search: z.string().optional(),
  team: z.string().optional(),
  position: z.string().optional(),
  page: z
    .string()
    .optional()
    .transform((val, ctx) => {
      if (!val || val.trim() === '') return 1; // default
      const num = Number(val);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Page must be a positive integer',
        });
        return z.NEVER;
      }
      return num;
    })
    .default(1),
  limit: z
    .string()
    .optional()
    .transform((val, ctx) => {
      if (!val || val.trim() === '') return 20; // default
      const num = Number(val);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1 || num > 1000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Limit must be an integer between 1 and 1000',
        });
        return z.NEVER;
      }
      return num;
    })
    .default(20),
});

export const GET = middlewareConfigs.public(async ({ req }) => {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(params);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ errors }, { status: 400 });
  }

  const { search, team, position, page, limit } = parsed.data;
  const leagueId = req.nextUrl.searchParams.get('leagueId') || undefined;

  let players: Player[] = [];
  let total = 0;
  let pagedPlayers: Player[] = [];

  if (leagueId) {
    const uid = await getAuthenticatedUserId(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const membership = await verifyLeagueMembership(leagueId, uid);
    if (!membership.isMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const where: {
      name?: { contains: string; mode: 'insensitive' };
      club?: string;
      position?: string;
      OR?: Array<{
        name?: { contains: string; mode: 'insensitive' };
        club?: { contains: string; mode: 'insensitive' };
        position?: { contains: string; mode: 'insensitive' };
      }>;
    } = {};
    if (team) where.club = team;
    if (position) where.position = position;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { club: { contains: search, mode: 'insensitive' } },
        { position: { contains: search, mode: 'insensitive' } },
      ];
    }

    total = await prisma.player.count({ where });
    const start = (page - 1) * limit;
    const dbPlayers = await prisma.player.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: start,
      take: limit,
    });

    const nameKeyToId = new Map<string, string>();
    const nameOnlyToId = new Map<string, string>();
    const nameOnlyDuplicates = new Set<string>();
    const idToName = new Map<string, string>();
    const nameToId = new Map<string, string>();
    const nameDuplicates = new Set<string>();
    dbPlayers.forEach((p) => {
      nameKeyToId.set(buildPlayerStatsKey(p.name, p.club), p.id);
      const nameOnlyKey = buildPlayerStatsKey(p.name, undefined);
      if (nameOnlyToId.has(nameOnlyKey)) {
        nameOnlyDuplicates.add(nameOnlyKey);
      } else {
        nameOnlyToId.set(nameOnlyKey, p.id);
      }
      idToName.set(p.id, p.name);
      const nameKey = p.name.toLowerCase();
      if (nameToId.has(nameKey)) {
        nameDuplicates.add(nameKey);
      } else {
        nameToId.set(nameKey, p.id);
      }
    });
    nameOnlyDuplicates.forEach((key) => nameOnlyToId.delete(key));
    nameDuplicates.forEach((key) => nameToId.delete(key));

    const statsById = await getLatestStatsByPlayerIds(
      dbPlayers.map((p) => p.id),
      nameKeyToId,
      nameOnlyToId,
      idToName,
      nameToId
    );

    pagedPlayers = dbPlayers.map((p) => {
      const stats = statsById.get(p.id);
      return {
        id: p.id,
        name: p.name,
        team: p.club,
        position: p.position,
        ...(stats ?? {}),
        stats: stats ?? {},
      };
    });
    players = pagedPlayers;
  } else {
    players = await getPlayers({ search, team, position });
    total = players.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    pagedPlayers = players.slice(start, end);
  }

  let enrichedPlayers = pagedPlayers;
  if (leagueId) {
    const ids = pagedPlayers.map((p) => p.id);
    const { totalTeams, counts, owners } = await getLeagueOwnershipDetails(leagueId, ids);
    const waiverSet = new Set<string>();

    try {
      const waiversSnap = await adminDb
        .collection('leagues')
        .doc(leagueId)
        .collection('waivers')
        .where('status', '==', 'PENDING')
        .get();
      waiversSnap.forEach((doc) => {
        const playerId = doc.data()?.playerId;
        if (playerId != null) waiverSet.add(String(playerId));
      });
    } catch {
      // Waiver status is best-effort; ignore failures.
    }

    enrichedPlayers = pagedPlayers.map((p) => {
      const count = counts.get(p.id) ?? 0;
      const ownership = totalTeams > 0 ? Math.round((count / totalTeams) * 100) : 0;
      const ownerTeams = owners.get(p.id) ?? [];
      const ownerTeam = ownerTeams.length ? ownerTeams.join(', ') : undefined;
      const ownershipStatus = waiverSet.has(String(p.id))
        ? 'Waiver'
        : count > 0
          ? 'Owned'
          : 'Available';
      return { ...p, ownership, ownershipStatus, ownerTeam };
    });
  }

  return NextResponse.json({
    players: enrichedPlayers,
    total,
    page,
    limit,
  });
});
