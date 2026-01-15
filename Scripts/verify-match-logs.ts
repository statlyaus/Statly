#!/usr/bin/env tsx
/**
 * Comprehensive verification script for match log API
 * 
 * Usage:
 *   npm run verify-match-logs -- "Josh Daicos" --seasons=2023,2024,2025 [--league-id=<id>] [--user-id=<id>]
 *   tsx scripts/verify-match-logs.ts "Josh Daicos" --seasons=2023,2024,2025 [--league-id=<id>] [--user-id=<id>]
 * 
 * Verifies:
 * - Every row has matchId
 * - roundNumber includes 0 for finals
 * - date is YYYY-MM-DD format
 * - No duplicate matchId values
 * - Averages consistency across all league columns
 * - Auto-compares against roster endpoint (if league-id provided)
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Simplified canonical stat key mapping (same logic as useLeagueStatColumns)
function canonicalStatKeyFromCategory(category: string): string | undefined {
  const normalized = category.toLowerCase().replace(/[^a-z0-9]/g, '');
  const map: Record<string, string> = {
    goals: 'goals',
    goalspergame: 'goals',
    g: 'goals',
    kicks: 'kicks',
    k: 'kicks',
    handballs: 'handballs',
    hb: 'handballs',
    disposals: 'disposals',
    d: 'disposals',
    marks: 'marks',
    m: 'marks',
    tackles: 'tackles',
    t: 'tackles',
    hitouts: 'hitouts',
    ho: 'hitouts',
    clearances: 'clearances',
    cl: 'clearances',
    inside50s: 'inside50s',
    i50: 'inside50s',
    insidefifties: 'inside50s',
    rebound50s: 'rebound50s',
    r50: 'rebound50s',
    contestedpossessions: 'contestedPossessions',
    cp: 'contestedPossessions',
    uncontestedpossessions: 'uncontestedPossessions',
    goalassists: 'goalAssists',
    ga: 'goalAssists',
    scoreinvolvements: 'scoreInvolvements',
    si: 'scoreInvolvements',
    effectivedisposals: 'effectiveDisposals',
    ed: 'effectiveDisposals',
    disposaleffpct: 'disposalEffPct',
    timeongroundpct: 'timeOnGroundPct',
    contestedmarks: 'contestedMarks',
    cm: 'contestedMarks',
    intercepts: 'intercepts',
    int: 'intercepts',
    metresgained: 'metresGained',
    mg: 'metresGained',
    turnovers: 'turnovers',
    to: 'turnovers',
    freesfor: 'freesFor',
    ff: 'freesFor',
    freesagainst: 'freesAgainst',
    fa: 'freesAgainst',
    onepercenters: 'onePercenters',
    clangers: 'clangers',
  };
  return map[normalized];
}

async function fetchLeagueCategories(leagueId: string): Promise<string[]> {
  try {
    const response = await fetch(`${API_BASE}/api/leagues/${leagueId}`);
    if (!response.ok) return [];
    const data = await response.json();
    const categories = data.data?.league?.categories ?? [];
    if (!Array.isArray(categories)) return [];
    return categories
      .map((cat: unknown) => canonicalStatKeyFromCategory(String(cat)))
      .filter((key): key is string => Boolean(key));
  } catch {
    return [];
  }
}

function slugifyPlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function findPlayerInRoster(
  leagueId: string,
  userId: string,
  playerName: string,
  seasons: number[]
): Promise<{ stats?: Record<string, number>; gamesPlayed?: number } | null> {
  try {
    const seasonParam = `seasons=${seasons.join(',')}`;
    const response = await fetch(
      `${API_BASE}/api/leagues/${leagueId}/roster/${userId}?${seasonParam}`,
      {
        headers: {
          // Note: This requires auth in real usage, but for verification we'll try
          Cookie: process.env.VERIFY_AUTH_COOKIE || '',
        },
      }
    );
    if (!response.ok) {
      console.log(`   ⚠️  Roster endpoint returned ${response.status} (auth may be required)`);
      return null;
    }
    const data = await response.json();
    const players = data.data?.roster?.players ?? [];
    const slug = slugifyPlayerName(playerName);
    
    // Try exact name match first
    let player = players.find((p: { name?: string }) => 
      p.name?.toLowerCase() === playerName.toLowerCase()
    );
    
    // Fallback to slug match
    if (!player) {
      player = players.find((p: { id?: string; name?: string }) => {
        const playerSlug = slugifyPlayerName(p.name || p.id || '');
        return playerSlug === slug || p.id?.includes(slug);
      });
    }
    
    if (player) {
      return {
        stats: player.stats as Record<string, number> | undefined,
        gamesPlayed: player.gamesPlayed as number | undefined,
      };
    }
    return null;
  } catch (error) {
    console.log(`   ⚠️  Failed to fetch roster: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function verifyMatchLogs(
  playerId: string,
  seasons?: string[],
  leagueId?: string,
  userId?: string
) {
  const seasonParam = seasons?.length ? `seasons=${seasons.join(',')}` : '';
  const debugParam = 'debug=1';
  const url = `${API_BASE}/api/players/${encodeURIComponent(playerId)}/matches?${seasonParam}&${debugParam}`;
  
  console.log(`\n🔍 Verifying match logs for player: ${playerId}`);
  console.log(`📡 URL: ${url}\n`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`❌ HTTP ${response.status}: ${response.statusText}`);
      const text = await response.text();
      console.error(`Response: ${text}`);
      process.exit(1);
    }

    const data = await response.json();
    const rows = data.data?.rows ?? data.data ?? [];
    const debug = data.data?.debug;

    console.log(`✅ Response received: ${rows.length} matches`);
    
    if (debug) {
      console.log(`\n📊 Debug Info:`);
      console.log(`   Total docs: ${debug.totalDocs}`);
      console.log(`   Processed: ${debug.processed}`);
      console.log(`   Dropped (missing matchId): ${debug.droppedMissingMatchId}`);
      console.log(`   Missing dates: ${debug.droppedMissingDate} (count: ${debug.missingDateMatchIdsCount ?? debug.droppedMissingDate})`);
      console.log(`   Duplicates removed: ${debug.duplicateMatchIds}`);
      if (debug.missingDateMatchIdsSample?.length > 0) {
        console.log(`   Sample missing date matchIds: ${debug.missingDateMatchIdsSample.slice(0, 5).join(', ')}`);
      }
      if (debug.duplicateMatchIdSamples?.length > 0) {
        console.log(`   Sample duplicate matchIds: ${debug.duplicateMatchIdSamples.slice(0, 5).join(', ')}`);
      }
      if (debug.duplicateByDateOpponent) {
        console.log(`   Duplicates by date+opponent: ${debug.duplicateByDateOpponent}`);
      }
    }

    // Validation checks
    const checks = {
      allHaveMatchId: true,
      hasFinals: false,
      allDatesAreISO: true,
      noDuplicates: true,
      allHaveRequiredFields: true,
    };

    const matchIds = new Set<string>();
    const dateOpponentKeys = new Map<string, string[]>(); // key -> [matchIds]
    const issues: string[] = [];

    for (const row of rows) {
      // Check matchId
      if (!row.matchId || typeof row.matchId !== 'string') {
        checks.allHaveMatchId = false;
        issues.push(`Row missing matchId: ${JSON.stringify(row)}`);
      } else {
        if (matchIds.has(row.matchId)) {
          checks.noDuplicates = false;
          issues.push(`Duplicate matchId: ${row.matchId}`);
        }
        matchIds.add(row.matchId);
        
        // Track by date+opponent+season for duplicate detection
        if (row.date && row.opponent && row.season) {
          const key = `${row.season}|${row.date}|${row.opponent}`;
          if (!dateOpponentKeys.has(key)) {
            dateOpponentKeys.set(key, []);
          }
          dateOpponentKeys.get(key)!.push(row.matchId);
        }
      }

      // Check finals
      if (row.roundNumber === 0) {
        checks.hasFinals = true;
      }

      // Check date format - should be YYYY-MM-DD (date-only, not datetime)
      if (row.date) {
        const dateStr = String(row.date);
        // Strict check: must be exactly YYYY-MM-DD format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          checks.allDatesAreISO = false;
          issues.push(`Invalid date format for matchId ${row.matchId}: ${dateStr} (expected YYYY-MM-DD)`);
        }
      }

      // Check required fields
      if (
        typeof row.season !== 'number' ||
        typeof row.roundNumber !== 'number' ||
        typeof row.opponent !== 'string' ||
        !row.stats ||
        typeof row.stats !== 'object'
      ) {
        checks.allHaveRequiredFields = false;
        issues.push(`Row missing required fields: ${JSON.stringify(row)}`);
      }
    }

    // Check for duplicates by date+opponent (different matchIds for same match)
    const duplicateByDateOpponent: string[] = [];
    dateOpponentKeys.forEach((matchIdsForKey, key) => {
      if (matchIdsForKey.length > 1) {
        duplicateByDateOpponent.push(`${key} -> [${matchIdsForKey.join(', ')}]`);
      }
    });

    console.log(`\n✅ Validation Results:`);
    console.log(`   All rows have matchId: ${checks.allHaveMatchId ? '✅' : '❌'}`);
    console.log(`   Includes finals (round 0): ${checks.hasFinals ? '✅' : '⚠️  (none found)'}`);
    console.log(`   All dates are ISO format: ${checks.allDatesAreISO ? '✅' : '❌'}`);
    console.log(`   No duplicate matchIds: ${checks.noDuplicates ? '✅' : '❌'}`);
    console.log(`   All have required fields: ${checks.allHaveRequiredFields ? '✅' : '❌'}`);
    if (duplicateByDateOpponent.length > 0) {
      console.log(`   ⚠️  Found ${duplicateByDateOpponent.length} potential duplicates by date+opponent+season`);
      duplicateByDateOpponent.slice(0, 3).forEach((dup) => console.log(`      ${dup}`));
    }

    if (issues.length > 0) {
      console.log(`\n⚠️  Issues found (showing first 5):`);
      issues.slice(0, 5).forEach((issue) => console.log(`   - ${issue}`));
      if (issues.length > 5) {
        console.log(`   ... and ${issues.length - 5} more`);
      }
    }

    // Sample output
    if (rows.length > 0) {
      console.log(`\n📋 Sample matches (first 3):`);
      rows.slice(0, 3).forEach((row: unknown) => {
        const r = row as {
          matchId: string;
          season: number;
          roundNumber: number;
          date: string;
          opponent: string;
        };
        const roundLabel = r.roundNumber === 0 ? 'Finals' : `R${r.roundNumber}`;
        console.log(`   ${r.season} ${roundLabel} vs ${r.opponent} (${r.date || 'no date'}) [${r.matchId}]`);
      });
    }

    // Averages consistency check - all league columns
    const seasonNums = seasons?.map((s) => Number(s)).filter((n) => Number.isFinite(n)) || [];
    let leagueCategories: string[] = [];
    
    if (leagueId) {
      console.log(`\n📊 Fetching league categories...`);
      leagueCategories = await fetchLeagueCategories(leagueId);
      if (leagueCategories.length > 0) {
        console.log(`   Found ${leagueCategories.length} league categories: ${leagueCategories.slice(0, 5).join(', ')}...`);
      } else {
        console.log(`   ⚠️  No league categories found, using common stats`);
        leagueCategories = ['kicks', 'handballs', 'marks', 'tackles', 'goals', 'disposals'];
      }
    } else {
      // Default to common stats if no league provided
      leagueCategories = ['kicks', 'handballs', 'marks', 'tackles', 'goals', 'disposals'];
    }

    // Calculate match log averages for each category
    const matchLogAverages: Record<string, { avg: number; count: number }> = {};
    const filteredRows = seasonNums.length > 0
      ? rows.filter((r: { season?: number }) => seasonNums.includes(r.season ?? 0))
      : rows;

    for (const category of leagueCategories) {
      const matchesWithStat = filteredRows.filter((r: { stats?: Record<string, number> }) => 
        r.stats && typeof r.stats[category] === 'number' && Number.isFinite(r.stats[category])
      );
      
      if (matchesWithStat.length > 0) {
        const total = matchesWithStat.reduce((sum: number, r: { stats: Record<string, number> }) => 
          sum + (r.stats[category] || 0), 0
        );
        matchLogAverages[category] = {
          avg: total / matchesWithStat.length,
          count: matchesWithStat.length,
        };
      }
    }

    // Compare with roster endpoint if available
    let rosterStats: Record<string, number> | null = null;
    if (leagueId && userId) {
      console.log(`\n📊 Fetching roster stats for comparison...`);
      const rosterData = await findPlayerInRoster(leagueId, userId, playerId, seasonNums);
      if (rosterData?.stats) {
        rosterStats = rosterData.stats;
        console.log(`   Found player in roster (games: ${rosterData.gamesPlayed ?? 'unknown'})`);
      }
    }

    // Print comparison table
    if (Object.keys(matchLogAverages).length > 0) {
      console.log(`\n📊 Averages Consistency Check:`);
      console.log(`   ${'Stat'.padEnd(20)} ${'Match Log Avg'.padEnd(15)} ${'Roster Avg'.padEnd(15)} ${'Diff'.padEnd(10)} ${'Status'}`);
      console.log(`   ${'-'.repeat(80)}`);
      
      let allMatch = true;
      for (const [category, matchLog] of Object.entries(matchLogAverages)) {
        const rosterValue = rosterStats?.[category];
        const diff = rosterValue !== undefined 
          ? Math.abs(matchLog.avg - rosterValue)
          : null;
        const status = diff === null
          ? '⚠️  (no roster)'
          : diff < 0.5
            ? '✅'
            : diff < 2.0
              ? '⚠️  (close)'
              : '❌ (mismatch)';
        
        if (diff !== null && diff >= 0.5) allMatch = false;
        
        const rosterStr = rosterValue !== undefined ? rosterValue.toFixed(2) : 'N/A';
        const diffStr = diff !== null ? diff.toFixed(2) : 'N/A';
        console.log(`   ${category.padEnd(20)} ${matchLog.avg.toFixed(2).padEnd(15)} ${rosterStr.padEnd(15)} ${diffStr.padEnd(10)} ${status}`);
      }
      
      if (!rosterStats) {
        console.log(`\n   ℹ️  No roster comparison (provide --league-id and --user-id for auto-comparison)`);
        console.log(`   ℹ️  Match log averages should match players list if roster stats are per-game`);
      } else if (!allMatch) {
        console.log(`\n   ⚠️  Some discrepancies found:`);
        console.log(`      - If roster values are lower → double-division issue`);
        console.log(`      - If roster values are higher → roster stats may be totals, not per-game`);
      } else {
        console.log(`\n   ✅ All averages match closely!`);
      }
    }

    // Summary
    const allPassed =
      checks.allHaveMatchId &&
      checks.allDatesAreISO &&
      checks.noDuplicates &&
      checks.allHaveRequiredFields &&
      duplicateByDateOpponent.length === 0;

    if (allPassed) {
      console.log(`\n✅ All checks passed!`);
      if (debug) {
        if (debug.droppedMissingMatchId > 0) {
          console.log(`⚠️  Warning: ${debug.droppedMissingMatchId} rows dropped due to missing matchId`);
        }
        if (debug.droppedMissingDate > 10) {
          console.log(`⚠️  Warning: ${debug.droppedMissingDate} rows missing dates (may indicate ingest issue)`);
        }
        if (debug.duplicateMatchIds > 0 && debug.duplicateMatchIdSamples?.length > 0) {
          console.log(`ℹ️  Info: ${debug.duplicateMatchIds} duplicates removed (see samples above)`);
        }
      }
      process.exit(0);
    } else {
      console.log(`\n❌ Some checks failed. See issues above.`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Error:`, error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Parse command line args
const args = process.argv.slice(2);
const playerId = args.find((arg) => !arg.startsWith('--')) || '';
const seasonsArg = args.find((arg) => arg.startsWith('--seasons='))?.split('=')[1];
const leagueIdArg = args.find((arg) => arg.startsWith('--league-id='))?.split('=')[1];
const userIdArg = args.find((arg) => arg.startsWith('--user-id='))?.split('=')[1];

if (!playerId) {
  console.error('Usage:');
  console.error('  npm run verify-match-logs -- "Josh Daicos" --seasons=2023,2024,2025 [--league-id=<id>] [--user-id=<id>]');
  console.error('  OR');
  console.error('  tsx scripts/verify-match-logs.ts "Josh Daicos" --seasons=2023,2024,2025 [--league-id=<id>] [--user-id=<id>]');
  console.error('');
  console.error('Note: npm requires -- before script arguments');
  console.error('      --league-id and --user-id enable auto-comparison with roster endpoint');
  process.exit(1);
}

const seasons = seasonsArg?.split(',').map((s) => s.trim()).filter(Boolean);

void verifyMatchLogs(playerId, seasons, leagueIdArg, userIdArg);
