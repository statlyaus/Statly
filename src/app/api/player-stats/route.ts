import { type NextRequest, NextResponse } from 'next/server';

import type { Firestore, QueryDocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore';

import { adminDb } from '@/lib/firebaseAdmin';
import { logger, withTiming } from '@/lib/logger';
import { withMetrics } from '@/lib/metrics';
import { getCanonicalPlayerName, PlayerNameParseError } from '@/lib/playerName';
import { withRateLimit, rateLimitConfigs } from '@/lib/rateLimit';
import { calculateTotalValue } from '@/types/fantasyCategories';
import type { PlayerStats } from '@/types/fantasyCategories';

export const runtime = 'nodejs';
export const preferredRegion = ['syd1', 'iad1'];

// Helper function to check available seasons in the database
async function getAvailableSeasons(db: Firestore): Promise<number[]> {
  try {
    // Query a sample of documents to find available seasons
    // Use a reasonable limit to avoid scanning the entire collection
    const snapshot = await db
      .collection('player_match_stats')
      .limit(500)
      .get();
    
    const seasons = new Set<number>();
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.season && typeof data.season === 'number') {
        seasons.add(data.season);
      }
    });
    
    return Array.from(seasons).sort((a, b) => b - a); // Sort descending (newest first)
  } catch (error) {
    logger.warn('Failed to fetch available seasons', { error });
    return [];
  }
}

function validateCursor(rawCursor: string | null): string | null {
  if (rawCursor == null) return null;
  const trimmed = rawCursor.trim();
  if (trimmed === '') return null;
  // Accept plain Firestore doc ids we issue as nextCursor. Be conservative and disallow '/'
  const idRegex = /^[A-Za-z0-9._: -]{1,512}$/;
  if (!trimmed.includes('/') && idRegex.test(trimmed)) {
    return trimmed;
  }
  // Optionally support base64-encoded cursor that contains an { id } shape
  try {
    const decodedStr = Buffer.from(trimmed, 'base64').toString('utf8');
    const maybe = JSON.parse(decodedStr) as { id?: string } | null;
    const candidate = typeof maybe?.id === 'string' ? maybe.id.trim() : '';
    if (candidate && !candidate.includes('/') && idRegex.test(candidate)) {
      return candidate;
    }
    logger.warn('Invalid cursor format for /api/player-stats', { cursorRaw: rawCursor });
    return null;
  } catch (_e) {
    logger.warn('Failed to decode cursor for /api/player-stats', { cursorRaw: rawCursor });
    return null;
  }
}

export const GET = withMetrics(async (request: NextRequest) => {
  // Basic public rate limit
  const guard = await withRateLimit(rateLimitConfigs.public)(request);
  if (!guard.success) {
    return NextResponse.json(guard.body, {
      status: guard.status as number,
      headers: guard.headers as Record<string, string>,
    });
  }
  try {
    const db = adminDb;
    const { searchParams } = new URL(request.url);
    const season = searchParams.get('season') || '2025';
    const round = searchParams.get('round');
    // Validate and parse cursor to avoid passing malformed values to Firestore
    const rawCursor = searchParams.get('cursor');
    const validatedCursor = validateCursor(rawCursor);
    if (rawCursor !== null && rawCursor.trim() !== '' && validatedCursor === null) {
      return NextResponse.json({ success: false, error: 'Invalid cursor' }, { status: 400 });
    }
    const cursor: string | undefined = validatedCursor ?? undefined;
    const limitParam = Number(searchParams.get('limit') || '500');
    const limit =
      Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 5000 ? limitParam : 500;
    // Safety guards to ensure pagination cannot run indefinitely
    const MAX_PAGES = 10;
    const MAX_DOCS = 5000;

    logger.apiRequest('GET', '/api/player-stats', { season, round, limit, cursor });

    const requestedSeason = parseInt(season);
    let actualSeason = requestedSeason;
    let usedFallback = false;

    // Query player_match_stats collection
    let query = db.collection('player_match_stats').where('season', '==', requestedSeason);

    if (round) {
      query = query.where('round_number', '==', parseInt(round));
    }

    // First attempt: try the requested season
    let { fetchedDocs, lastPageSize, computedNextCursor } = await withTiming(
      'player-stats.query',
      async () => {
        const collected: QueryDocumentSnapshot[] = [];
        let pageCount = 0;
        let docsFetched = 0;
        let pageCursor: string | undefined = cursor;
        let lastSize = 0;
        let nextCursor: string | null = null;

        // Start timeout protection for pagination loop
        const startTime = Date.now();
        const MAX_EXECUTION_TIME = 25000; // 25 seconds (leave buffer for response)

        while (pageCount < MAX_PAGES && docsFetched < MAX_DOCS) {
          // Check timeout
          if (Date.now() - startTime > MAX_EXECUTION_TIME) {
            logger.warn('player-stats pagination timeout', { pageCount, docsFetched });
            break;
          }

          let q = query.orderBy('__name__').limit(limit);
          if (pageCursor) q = q.startAfter(pageCursor);
          let snap: QuerySnapshot | null = null;
          try {
            snap = await q.get();
          } catch (err) {
            logger.warn('player-stats page fetch error, breaking', {
              pageCount,
              err: err instanceof Error ? err.message : String(err),
            });
            break; // Break on error to avoid infinite loop
          }

          if (!snap || !Array.isArray(snap.docs)) {
            logger.warn('player-stats unexpected response, breaking', { pageCount });
            break; // Fallback break on unexpected responses
          }

          if (snap.empty || snap.docs.length === 0) {
            // No more records
            lastSize = 0;
            break;
          }

          collected.push(...snap.docs);
          docsFetched += snap.docs.length;
          pageCount += 1;
          lastSize = snap.size;
          pageCursor = snap.docs[snap.docs.length - 1]?.id;

          // Prepare nextCursor if there might be more
          if (typeof snap.size === 'number' && snap.size === limit && pageCursor) {
            nextCursor = pageCursor;
          } else {
            // Fewer than requested means no more pages
            break;
          }

          // Enforce safety guards
          if (pageCount >= MAX_PAGES || docsFetched >= MAX_DOCS) {
            break;
          }
        }

        return { fetchedDocs: collected, lastPageSize: lastSize, computedNextCursor: nextCursor };
      }
    );

    // If no results and no round specified, try fallback to other seasons
    if (fetchedDocs.length === 0 && !round) {
      const availableSeasons = await getAvailableSeasons(db);
      
      // Try fallback if we found available seasons that differ from requested
      if (availableSeasons.length > 0) {
        // Find the most recent season that's different from requested
        const fallbackSeason = availableSeasons.find((s) => s !== requestedSeason) || availableSeasons[0];
        usedFallback = fallbackSeason !== requestedSeason;
        
        if (usedFallback) {
          actualSeason = fallbackSeason;
          logger.info('player-stats fallback: no data for requested season, trying available season', {
            requestedSeason,
            fallbackSeason: actualSeason,
            availableSeasons,
          });
        } else {
          logger.debug('player-stats: requested season has no data, and it is the only available season', {
            requestedSeason,
            availableSeasons,
          });
        }

        // Retry query with fallback season only if we found a different season
        if (usedFallback) {
          query = db.collection('player_match_stats').where('season', '==', actualSeason);
          
          const fallbackResult = await withTiming(
          'player-stats.query.fallback',
          async () => {
            const collected: QueryDocumentSnapshot[] = [];
            let pageCount = 0;
            let docsFetched = 0;
            let lastSize = 0;
            let nextCursor: string | null = null;

            const startTime = Date.now();
            const MAX_EXECUTION_TIME = 25000;

            while (pageCount < MAX_PAGES && docsFetched < MAX_DOCS) {
              if (Date.now() - startTime > MAX_EXECUTION_TIME) {
                break;
              }

              let q = query.orderBy('__name__').limit(limit);
              let snap: QuerySnapshot | null = null;
              try {
                snap = await q.get();
              } catch (err) {
                break;
              }

              if (!snap || !Array.isArray(snap.docs) || snap.empty || snap.docs.length === 0) {
                break;
              }

              collected.push(...snap.docs);
              docsFetched += snap.docs.length;
              pageCount += 1;
              lastSize = snap.size;
              const pageCursor = snap.docs[snap.docs.length - 1]?.id;

              if (typeof snap.size === 'number' && snap.size === limit && pageCursor) {
                nextCursor = pageCursor;
              } else {
                break;
              }

              if (pageCount >= MAX_PAGES || docsFetched >= MAX_DOCS) {
                break;
              }
            }

            return { fetchedDocs: collected, lastPageSize: lastSize, computedNextCursor: nextCursor };
          }
          );
          
          fetchedDocs = fallbackResult.fetchedDocs;
          lastPageSize = fallbackResult.lastPageSize;
          computedNextCursor = fallbackResult.computedNextCursor;
        }
      }
    }

    // Only log at info level if we have results or used fallback, otherwise use debug
    if (fetchedDocs.length > 0 || usedFallback) {
      logger.info('player-stats fetched', { 
        count: fetchedDocs.length, 
        season: actualSeason,
        fallback: usedFallback 
      });
    } else {
      logger.debug('player-stats fetched (empty)', { 
        count: fetchedDocs.length, 
        season: requestedSeason 
      });
    }

    const playerStats = fetchedDocs.map((doc) => {
      const data = doc.data();
      logger.debug('player-stats doc', { id: doc.id });

      // Resolve canonical player name robustly
      let playerName: string | null = null;
      try {
        playerName = getCanonicalPlayerName(data, doc.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof PlayerNameParseError) {
          logger.warn('player-stats name parse failed', { id: doc.id, error: message });
        } else {
          logger.error('player-stats unexpected name resolution error', {
            id: doc.id,
            error: message,
          });
        }
        // Safe fallback: surface as Unknown Player so downstream can render, but keep id
        playerName = null;
      }

      if (!playerName || playerName.trim() === '' || playerName.includes('____')) {
        logger.warn('Skipping invalid player name', { id: doc.id, playerName });
        return null;
      }

      playerName = playerName.trim();

      // Extract and calculate per-game averages for the 9 key categories
      // Each record is per game from AFL data

      // Your 9 defined categories (highest weighted in your algorithm)
      // These are the core stats that matter most for your custom scoring
      // Replaced missing categories with available high-value stats:
      // Clearances → Inside 50s, One Percenters → Effective Disposals, Goal Assists → Score Involvements
      const categories = {
        goals: data.goals || 0,
        tackles: data.tackles || 0,
        // Original category 'clearances' not in Firestore 'player_match_stats' (AFL feed);
        // using 'inside_50s' as the closest available proxy for clearance/territory impact.
        // Note: Revisit if source schema adds 'clearances'.
        inside50s: data.inside_50s || 0,
        intercepts: data.intercepts || 0,
        contestedMarks: data.contested_marks || 0,
        rebound50s: data.rebound_50s || 0,
        contestedPossessions: data.contested_possessions || 0,
        // Original 'onePercenters' not present in the raw feed; 'effective_disposals' is
        // the nearest available indicator of positive on-ball/off-ball impact. Revisit if
        // 'one_percenters' appears in the source.
        effectiveDisposals: data.effective_disposals || 0,
        // Original 'goalAssists' unavailable in the raw feed; 'score_involvements' reflects
        // broader contribution to scoring chains and is the closest available metric.
        // Revisit if 'goal_assists' is added to the source.
        scoreInvolvements: data.score_involvements || 0,
      };

      // Full stats object for total value calculation and profile log
      const playerStats: PlayerStats = {
        games: 1, // Each record is per game
        kicks: data.kicks || 0,
        handballs: data.handballs || 0,
        marks: data.marks || 0,
        tackles: categories.tackles,
        goals: categories.goals,
        hitouts: data.hitouts || 0,
        clearances: categories.inside50s, // Using inside 50s as clearances replacement
        inside50s: categories.inside50s,
        rebound50s: categories.rebound50s,
        clangers: data.clangers || 0,
        contestedPossessions: categories.contestedPossessions,
        uncontestedPossessions: data.uncontested_possessions || 0,
        freesFor: data.frees_for || 0,
        freesAgainst: data.frees_against || 0,
        onePercenters: categories.effectiveDisposals, // Using effective disposals as one percenters replacement
        goalAssists: categories.scoreInvolvements, // Using score involvements as goal assists replacement
        turnovers: data.turnovers || 0,
        intercepts: categories.intercepts,
        metresGained: data.metres_gained || 0,
        contestedMarks: categories.contestedMarks,
        effectiveDisposals: categories.effectiveDisposals,
        scoreInvolvements: categories.scoreInvolvements,
        timeOnGroundPct: data.tog_pct || 80, // Default 80% if missing
        disposalEffPct: data.disposal_efficiency || 75, // Default 75% if missing
        seasonTotal: 0,
        avgFantasyPoints: 0,
        lastGameFantasyPoints: 0,
      };

      // Calculate the custom total value using your algorithm
      const totalValue = calculateTotalValue(playerStats);

      return {
        id: data.player_uid || doc.id,
        player_id: data.player_uid || doc.id,
        player_name: playerName,
        team: data.team,
        position: data.position || 'MID',

        // 9 defined categories (per-game values from AFL data)
        categories,

        // Total value from your weighted algorithm
        totalValue,

        // 10th cell - efficiency metric as additional insight
        tenthCell: {
          type: 'efficiency',
          value: Math.round(playerStats.disposalEffPct),
          label: 'DE%',
        },

        // Complete per-game log for detailed profile view
        perGameLog: playerStats,

        // Match context information
        match_id: data.match_uid,
        season: data.season,
        round_number: data.round,
        opposition: data.opposition,

        // For component compatibility
        fantasy_points: totalValue,
      };
    });

    // Filter out null entries (invalid player records)
    const validPlayerStats = playerStats.filter((player) => player !== null);

    // Only log at info level if we have results, otherwise use debug
    if (validPlayerStats.length > 0 || usedFallback) {
      logger.info('player-stats returning', {
        valid: validPlayerStats.length,
        total: playerStats.length,
        season: actualSeason,
        fallback: usedFallback,
      });
    } else {
      logger.debug('player-stats returning (empty)', {
        valid: validPlayerStats.length,
        total: playerStats.length,
        season: requestedSeason,
      });
    }

    const nextCursor = lastPageSize === limit ? computedNextCursor : null;
    
    // Get available seasons for the response metadata
    const availableSeasons = await getAvailableSeasons(db);
    
    return NextResponse.json(
      {
        success: true,
        data: validPlayerStats,
        count: validPlayerStats.length,
        timestamp: new Date().toISOString(),
        query: {
          season: actualSeason, // Return the actual season used (may differ from requested if fallback was used)
          requestedSeason: requestedSeason, // Include the originally requested season
          round: round ? parseInt(round) : null,
          limit,
          cursor: cursor || null,
          nextCursor,
        },
        metadata: {
          usedFallback,
          availableSeasons: availableSeasons.length > 0 ? availableSeasons : undefined,
        },
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' } }
    );
  } catch (error) {
    logger.apiError('GET', '/api/player-stats', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch player stats',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}, 'GET /api/player-stats');
