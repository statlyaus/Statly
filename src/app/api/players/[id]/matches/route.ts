export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getPlayer } from '@/lib/data';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { dedupeMatchRows, dedupeByDateOpponent } from '@/lib/matchLogs';
import type { MatchLogRow } from '@/lib/matchLogs';
import { prisma } from '@/lib/prisma';
import { normalizeStats } from '@/lib/stats/normalizeStats';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';

import type { Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';

// Team name mapping to ensure consistency (never render both "Brisbane Lions" and "Brisbane")
const TEAM_NAME_MAP: Record<string, string> = {
  Brisbane: 'Brisbane Lions',
  'Brisbane Lions': 'Brisbane Lions',
  BRIS: 'Brisbane Lions',
  BL: 'Brisbane Lions',
  BRI: 'Brisbane Lions',
  GWS: 'Greater Western Sydney',
  'Greater Western Sydney': 'Greater Western Sydney',
  'GWS Giants': 'Greater Western Sydney',
  WB: 'Western Bulldogs',
  Bulldogs: 'Western Bulldogs',
  'Western Bulldogs': 'Western Bulldogs',
  WBD: 'Western Bulldogs',
  DOGS: 'Western Bulldogs',
};

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readStat(
  data: Record<string, unknown>,
  key: string,
  altKeys: string[] = []
): number {
  const stats = (data.stats as Record<string, unknown> | undefined) ?? {};
  const raw = (data.raw_row as Record<string, unknown> | undefined) ?? {};
  const candidates = [key, ...altKeys];
  for (const candidate of candidates) {
    if (candidate in stats) return toNumber(stats[candidate]);
    if (candidate in raw) return toNumber(raw[candidate]);
    if (candidate in data) return toNumber(data[candidate]);
  }
  return 0;
}

function normalizeTeamName(value: string | null | undefined): string {
  const name = (value ?? '').trim();
  if (!name) return '';
  // Use TEAM_NAME_MAP for consistent team names
  return TEAM_NAME_MAP[name] ?? name;
}

function resolveOpponent(
  data: Record<string, unknown>,
  playerTeam: string | null | undefined
): string {
  const team = normalizeTeamName(playerTeam);
  const rawHome =
    (data.match_home_team as unknown) ??
    (data.raw_row as Record<string, unknown> | undefined)?.match_home_team ??
    (data.raw_row as Record<string, unknown> | undefined)?.match_home_team_name;
  const rawAway =
    (data.match_away_team as unknown) ??
    (data.raw_row as Record<string, unknown> | undefined)?.match_away_team ??
    (data.raw_row as Record<string, unknown> | undefined)?.match_away_team_name;
  const home = normalizeTeamName(typeof rawHome === 'string' ? rawHome : undefined);
  const away = normalizeTeamName(typeof rawAway === 'string' ? rawAway : undefined);
  if (team && home && away) {
    if (team.toLowerCase() === home.toLowerCase()) return away;
    if (team.toLowerCase() === away.toLowerCase()) return home;
  }
  const rawFallback =
    (data.opposition as unknown) ??
    (data.raw_row as Record<string, unknown> | undefined)?.opposition ??
    (data.opponent as unknown);
  const fallback = typeof rawFallback === 'string' ? rawFallback : 'Unknown';
  return normalizeTeamName(fallback) || 'Unknown';
}

/**
 * Derives matchId from doc ID prefix if no match_id/matchUid fields are present.
 * Supports formats like: `${season}-R${round}-${teamAbbr}-${oppAbbr}_ply_${slug}`
 * Returns the prefix before `_ply_` if it matches the match UID pattern.
 */
function deriveMatchIdFromDocId(docId: string): string | null {
  const id = String(docId || '').trim();
  if (!id) return null;

  // Pattern: `${season}-R${round}-${teamAbbr}-${oppAbbr}_ply_${slug}`
  // Extract prefix before `_ply_`
  const plyMatch = id.match(/^(.+?)_ply_/i);
  if (plyMatch && plyMatch[1]) {
    const prefix = plyMatch[1];
    // Validate it looks like a match UID: e.g., "2025-R18-ADE-COL"
    if (/^\d{4}-R\d+-\w{3}-\w{3}$/i.test(prefix)) {
      return prefix;
    }
  }

  // Pattern: `${season}-R${round}-${teamAbbr}-${oppAbbr}` (standalone)
  if (/^\d{4}-R\d+-\w{3}-\w{3}$/i.test(id)) {
    return id;
  }

  return null;
}

/**
 * Checks if a match ID looks canonical (e.g., 2025-R23-COL-ADE)
 */
function looksCanonicalMatchId(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-R/.test(v);
}

/**
 * Checks if a value is numeric-only (e.g., "11383" or 11383)
 */
function isNumericOnly(v: unknown): boolean {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '';
  return /^\d+$/.test(s);
}

/**
 * Checks if a value is a numeric match ID (e.g., 11383 from Fryzigg)
 */
function asNumericMatchId(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) {
    const parsed = Number.parseInt(v, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Resolves matchId with priority: canonical UID > non-numeric string > derived from docId > numeric (last resort)
 * Never uses numeric IDs if a canonical one can be derived.
 */
function resolveMatchId(
  data: Record<string, unknown>,
  docId: string
): { matchId: string | null; numericId: number | null } {
  // Priority 1: Check matchUid/match_uid first (these are usually canonical)
  const matchUid = data.matchUid ?? data.match_uid;
  if (matchUid) {
    const uidStr = String(matchUid).trim();
    if (uidStr) {
      // If it's canonical, use it immediately
      if (looksCanonicalMatchId(uidStr)) {
        return { matchId: uidStr, numericId: null };
      }
      // If it's non-numeric, use it (might be a valid non-canonical format)
      if (!isNumericOnly(uidStr)) {
        return { matchId: uidStr, numericId: null };
      }
    }
  }

  // Priority 2: Try to derive from doc ID prefix (often has canonical format)
  const derived = deriveMatchIdFromDocId(docId);
  if (derived) {
    return { matchId: derived, numericId: null };
  }

  // Priority 3: Check matchId/match_id (but only if not numeric-only)
  const matchIdRaw = data.matchId ?? data.match_id;
  if (matchIdRaw) {
    const idStr = String(matchIdRaw).trim();
    if (idStr) {
      // Use non-numeric string matchId
      if (!isNumericOnly(idStr)) {
        return { matchId: idStr, numericId: null };
      }
      // Collect numeric ID for resolution (don't use as matchId yet)
      const numericId = asNumericMatchId(matchIdRaw);
      if (numericId !== null) {
        return { matchId: null, numericId };
      }
    }
  }

  // Priority 4: If we have a numeric matchUid (shouldn't happen, but handle it)
  if (matchUid) {
    const numericId = asNumericMatchId(matchUid);
    if (numericId !== null) {
      return { matchId: null, numericId };
    }
  }

  return { matchId: null, numericId: null };
}

/**
 * Chunks an array into smaller arrays of specified size
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Resolves numeric match IDs to canonical match UIDs by querying the matches collection.
 * Returns a map: numericId -> canonicalUID (doc.id)
 */
async function resolveCanonicalMatchIdsByNumeric(
  db: typeof adminDb,
  numericIds: number[]
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const uniq = Array.from(new Set(numericIds));
  if (uniq.length === 0) return map;

  // Firestore 'in' queries are limited to 10 items
  for (const group of chunkArray(uniq, 10)) {
    try {
      const snap = await db.collection('matches').where('match_id', 'in', group).get();
      for (const doc of snap.docs) {
        const data = doc.data();
        const mid = asNumericMatchId(data.match_id);
        if (mid != null) {
          // Canonical ID is the doc.id (e.g., "2025-R23-COL-ADE")
          map.set(mid, doc.id);
        }
      }
    } catch (error) {
      logger.warn('Failed to resolve numeric match IDs', {
        error: error instanceof Error ? error.message : String(error),
        groupSize: group.length,
      });
    }
  }
  return map;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    const { id } = resolvedParams;
    const url = new URL(_request.url);
    const seasonsParam = url.searchParams.get('seasons') ?? '';
    const seasonParam = url.searchParams.get('season') ?? '';
    const debugFlag = url.searchParams.get('debug') === '1';
    const isDebugMode = debugFlag || process.env.NODE_ENV !== 'production';
    
    const seasons =
      seasonsParam.trim().length > 0
        ? seasonsParam
            .split(',')
            .map((value) => Number(value.trim()))
            .filter((num) => Number.isFinite(num) && num > 0)
        : seasonParam.trim().length > 0
          ? [Number(seasonParam.trim())].filter((num) => Number.isFinite(num) && num > 0)
          : [2025, 2024, 2023];

    const seasonFilter = Array.from(new Set(seasons));

    logger.debug('Fetching matches for player', { playerId: id });

    const decodedId = decodeURIComponent(id);
    const player =
      (await prisma.player.findUnique({ where: { id: decodedId } })) ??
      (await prisma.player.findFirst({ where: { name: decodedId.replace(/[_-]+/g, ' ') } }));
    const fallback = player ? null : await getPlayer(decodedId);
    const playerName = player?.name ?? fallback?.name ?? decodedId;

    // Query player match stats for the specific player
    let snapshot;
    try {
      let query: Query = adminDb
        .collection('player_match_stats')
        .where('player_name', '==', playerName);
      if (seasonFilter.length > 0) {
        query = query.where('season', 'in', seasonFilter.slice(0, 10));
      }
      snapshot = await query.orderBy('round_number', 'desc').get();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string | number }).code;
      if (String(code).includes('FAILED_PRECONDITION') || msg.includes('FAILED_PRECONDITION')) {
        logger.warn('Matches query requires index; falling back to unordered query', { playerId: id });
        let fallbackQuery: Query = adminDb
      .collection('player_match_stats')
          .where('player_name', '==', playerName);
        if (seasonFilter.length > 0) {
          fallbackQuery = fallbackQuery.where('season', 'in', seasonFilter.slice(0, 10));
        }
        snapshot = await fallbackQuery.get();
      } else {
        throw error;
      }
    }

    logger.debug('Found match records', { playerId: id, recordCount: snapshot.size });

    if (snapshot.empty) {
      return successResponse([]);
    }

    // Debug counters for dropped rows
    let droppedMissingMatchId = 0;
    let droppedMissingDate = 0;
    let duplicateMatchIds = 0;
    let duplicateByDateOpponent = 0;
    const missingDateMatchIds: string[] = [];
    const duplicateMatchIdSamples: string[] = [];
    const numericMatchIds: number[] = []; // Collect numeric IDs for resolution

    // First pass: collect all match IDs using proper priority (canonical > non-numeric > derived > numeric)
    const matchesWithRawIds = snapshot.docs.map((doc: QueryDocumentSnapshot) => {
      const data = doc.data();
      const roundNumber =
        readStat(data, 'round_number', ['round', 'match_round']) ||
        toNumber((data.raw_row as Record<string, unknown> | undefined)?.round) ||
        0;
      const team: string | null | undefined =
        (typeof data.team === 'string' ? data.team : undefined) ||
        (typeof (data.raw_row as Record<string, unknown> | undefined)?.team === 'string'
          ? ((data.raw_row as Record<string, unknown> | undefined)?.team as string)
          : undefined) ||
        player?.club ||
        null;
      const opposition = resolveOpponent(data, team);
      
      // Use resolveMatchId helper which prioritizes canonical UIDs
      const docId = String(doc.id || '').trim();
      const { matchId, numericId } = resolveMatchId(data, docId);
      
      // Collect numeric IDs for resolution (if we couldn't get a canonical matchId)
      if (numericId !== null && !matchId) {
        numericMatchIds.push(numericId);
      }
      
      return {
        doc,
        data,
        roundNumber,
        team,
        opposition,
        matchId,
        numericId,
      };
    });

    // Resolve numeric match IDs to canonical UIDs
    let numericIdMap: Map<number, string> = new Map();
    if (numericMatchIds.length > 0) {
      logger.debug('Resolving numeric match IDs to canonical UIDs', {
        playerId: id,
        count: numericMatchIds.length,
      });
      numericIdMap = await resolveCanonicalMatchIdsByNumeric(adminDb, numericMatchIds);
      logger.debug('Resolved numeric match IDs', {
        playerId: id,
        resolved: numericIdMap.size,
        total: numericMatchIds.length,
      });
    }

    // Second pass: normalize match IDs and build match rows
    const matches = matchesWithRawIds
      .map(({ doc, data, roundNumber, opposition, matchId: rawMatchId, numericId }) => {
      // Use resolved canonical UID if we have a numeric ID
      let matchId = rawMatchId;
      if (!matchId && numericId !== null) {
        const resolved = numericIdMap.get(numericId);
        if (resolved) {
          matchId = resolved;
          if (isDebugMode) {
            logger.debug('Resolved numeric match ID to canonical', {
              playerId: id,
              numericId,
              canonicalId: resolved,
            });
          }
        } else {
          // Keep numeric ID as string if resolution failed (better than nothing)
          matchId = String(numericId);
          if (isDebugMode) {
            logger.debug('Could not resolve numeric match ID', {
              playerId: id,
              numericId,
            });
          }
        }
      }
      
      // If we still have a numeric matchId string, try to resolve it
      if (matchId && /^\d+$/.test(matchId)) {
        const numId = Number.parseInt(matchId, 10);
        if (Number.isFinite(numId)) {
          const resolved = numericIdMap.get(numId);
          if (resolved) {
            matchId = resolved;
          }
        }
      }
      // Normalize date to YYYY-MM-DD format (date-only, not datetime)
      // This avoids timezone issues and ensures lexicographic sorting works correctly
      const matchDateRaw =
        (data.match_date as string | undefined) ||
        (data.date as string | undefined) ||
        (data.raw_row as Record<string, unknown> | undefined)?.date ||
        null;
      
      // Convert to date-only ISO format if it's a full datetime
      let normalizedDateRaw: string | null = null;
      if (matchDateRaw) {
        try {
          const dateStr = String(matchDateRaw);
          // If it's already YYYY-MM-DD format, use as-is
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            normalizedDateRaw = dateStr;
          } else {
            // Parse and extract date-only part
            const parsed = new Date(dateStr);
            if (!Number.isNaN(parsed.getTime())) {
              const year = parsed.getFullYear();
              const month = String(parsed.getMonth() + 1).padStart(2, '0');
              const day = String(parsed.getDate()).padStart(2, '0');
              normalizedDateRaw = `${year}-${month}-${day}`;
            }
          }
        } catch {
          // If parsing fails, use original string (might be invalid, but preserve it)
          normalizedDateRaw = String(matchDateRaw);
        }
      }

      const normalizedStats = normalizeStats(
        (data.stats as Record<string, unknown> | undefined) ?? undefined,
        (data.raw_row as Record<string, unknown> | undefined) ?? undefined,
        (data as Record<string, unknown> | undefined) ?? undefined
      );

      // Ensure matchId exists - if not, skip this row (can't dedupe without it)
      if (!matchId) {
        droppedMissingMatchId++;
        logger.warn('Dropped: missing matchId', {
          playerId: id,
          round: roundNumber,
          docId: doc.id,
          season: data.season,
        });
        return null;
      }

      // Ensure all required fields are present
      const normalizedOpponent = normalizeTeamName(opposition);
      const normalizedDate = normalizedDateRaw || '';
      const normalizedSeason = Number(data.season) || 2025;
      // Round 0 is valid for finals - don't default it, use actual value (including 0)
      const normalizedRoundNumber = Number.isFinite(Number(roundNumber)) ? Number(roundNumber) : 0;

      // Track missing dates for debugging (but don't drop - date is optional for sorting)
      if (!normalizedDate) {
        droppedMissingDate++;
        if (missingDateMatchIds.length < 50) {
          // Cap at 50 to prevent huge arrays
          missingDateMatchIds.push(matchId);
        }
        if (isDebugMode) {
          logger.debug('Match row missing date', {
            playerId: id,
            matchId,
            round: normalizedRoundNumber,
            season: normalizedSeason,
          });
        }
      }

      // Ensure stats object has all canonical keys
      const completeStats = normalizedStats as Record<CanonicalStatKey, number>;

      return {
          matchId,
          season: normalizedSeason,
          roundNumber: normalizedRoundNumber,
          date: normalizedDate,
          opponent: normalizedOpponent,
          stats: completeStats,
        } as MatchLogRow;
      })
      .filter((row): row is MatchLogRow => row !== null);

    // Track duplicates after deduplication
    const beforeDedup = matches.length;
    
    // Build a map to find duplicate matchIds for debug output
    const matchIdCounts = new Map<string, number>();
    matches.forEach((row) => {
      const count = matchIdCounts.get(row.matchId) || 0;
      matchIdCounts.set(row.matchId, count + 1);
    });
    
    // Collect sample duplicate matchIds (first 10)
    matchIdCounts.forEach((count, matchId) => {
      if (count > 1 && duplicateMatchIdSamples.length < 10) {
        duplicateMatchIdSamples.push(matchId);
      }
    });
    
    // First dedupe: by matchId (now all should be canonical after normalization)
    const dedupedByMatchId = dedupeMatchRows(matches);
    duplicateMatchIds = beforeDedup - dedupedByMatchId.length;
    
    // Second dedupe: by date+opponent+season as safety net (catches cases where numeric IDs weren't resolved)
    const deduped = dedupeByDateOpponent(dedupedByMatchId);
    const beforeDateOpponentDedup = dedupedByMatchId.length;
    duplicateByDateOpponent = beforeDateOpponentDedup - deduped.length;
    
    if (isDebugMode && (droppedMissingMatchId > 0 || droppedMissingDate > 0 || duplicateMatchIds > 0 || duplicateByDateOpponent > 0)) {
      logger.info('Match processing summary', {
        playerId: id,
        totalDocs: snapshot.size,
        processed: deduped.length,
        droppedMissingMatchId,
        droppedMissingDate,
        duplicateMatchIds,
        duplicateByDateOpponent,
        missingDateMatchIds: missingDateMatchIds.slice(0, 10), // Sample first 10
        duplicateMatchIdSamples: duplicateMatchIdSamples.slice(0, 10),
      });
    }

    // Sort by date DESC, then roundNumber DESC
    // Missing dates (empty string) sort last (time = 0)
    deduped.sort((a, b) => {
      const timeA = a.date && a.date.trim() ? new Date(a.date).getTime() : 0;
      const timeB = b.date && b.date.trim() ? new Date(b.date).getTime() : 0;
      // If both have dates, sort by date DESC
      if (timeA > 0 && timeB > 0 && timeA !== timeB) return timeB - timeA;
      // If one has date and one doesn't, date comes first
      if (timeA > 0 && timeB === 0) return -1;
      if (timeB > 0 && timeA === 0) return 1;
      // Both missing dates or same date: sort by roundNumber DESC
      return b.roundNumber - a.roundNumber;
    });
    
    logger.debug('Returning matches', { playerId: id, matchCount: deduped.length });
    
    // Include debug info in response if debug flag is set
    if (debugFlag) {
      return successResponse({
        rows: deduped,
        debug: {
          totalDocs: snapshot.size,
          processed: deduped.length,
          droppedMissingMatchId,
          droppedMissingDate,
          missingDateMatchIdsCount: droppedMissingDate,
          missingDateMatchIdsSample: missingDateMatchIds.slice(0, 25), // Cap at 25
          duplicateMatchIds,
          duplicateMatchIdSamples: duplicateMatchIdSamples.slice(0, 10), // Sample first 10 duplicates
          duplicateByDateOpponent, // Different matchIds for same date+opponent+season
        },
      });
    }
    
    return successResponse(deduped);
  } catch (error) {
    const { id } = resolvedParams;
    logger.error('Failed to fetch player matches', error, { playerId: id });
    return commonErrors.internalServerError('Failed to fetch player matches');
  }
}
