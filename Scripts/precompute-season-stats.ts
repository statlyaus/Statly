#!/usr/bin/env tsx
/**
 * Pre-compute season stats for fast player lookups
 * 
 * Usage:
 *   tsx Scripts/precompute-season-stats.ts [options]
 * 
 * Options:
 *   --dry-run           Don't write to Firestore, just show what would be done
 *   --player=NAME       Process single player only (for testing)
 *   --season=YEAR       Process single season only
 *   --limit=N           Process first N players only
 *   --validate          Compare pre-computed vs on-demand for sample players
 * 
 * Examples:
 *   tsx Scripts/precompute-season-stats.ts --dry-run --limit=5
 *   tsx Scripts/precompute-season-stats.ts --player="Josh Daicos" --season=2025
 *   tsx Scripts/precompute-season-stats.ts --validate
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import admin from 'firebase-admin';
import { PrismaClient } from '@prisma/client';
import { getRecentAflSeasons } from '../src/lib/aflSeason';
import { readCanonicalMatchKey, readCanonicalPlayerId } from '../src/lib/playerMatchStats';
import { normalizeStats } from '../src/lib/stats/normalizeStats';
import { CANONICAL_STAT_KEYS, type CanonicalStatKey } from '../src/lib/stats/statColumns';

// Initialize Firebase Admin
if (!admin || !admin.apps || !admin.apps.length) {
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!serviceAccountBase64) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 environment variable is required');
  }
  const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
  const serviceAccount = JSON.parse(serviceAccountJson);

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: String(serviceAccount.private_key).replace(/\\n/g, '\n'),
    }),
    projectId: serviceAccount.project_id,
  });
}

const adminDb = admin.firestore();
const prisma = new PrismaClient();

const DEFAULT_SEASONS = getRecentAflSeasons();

type StatsAggregate = {
  totals: Record<CanonicalStatKey, number>;
  games: number;
};

type PlayerSeasonStat = {
  playerId: string;
  playerName: string;
  season: number;
  gamesPlayed: number;
  stats: Record<CanonicalStatKey, number>;
  totals: Record<CanonicalStatKey, number>;
  lastUpdated: Date;
};

function buildEmptyStats(): Record<CanonicalStatKey, number> {
  const empty = {} as Record<CanonicalStatKey, number>;
  for (const key of CANONICAL_STAT_KEYS) {
    empty[key] = 0;
  }
  return empty;
}

function stableMatchKey(record: Record<string, unknown>): string {
  return readCanonicalMatchKey(record);
}

async function aggregatePlayerSeasonStats(
  player: { id: string; name: string; club?: string | null },
  season: number
): Promise<PlayerSeasonStat | null> {
  const seen = new Set<string>();
  const aggregate: StatsAggregate = { totals: buildEmptyStats(), games: 0 };
  let snapshot = await adminDb
    .collection('player_match_stats')
    .where('playerId', '==', player.id)
    .where('season', '==', season)
    .get();

  if (snapshot.empty) {
    snapshot = await adminDb
      .collection('player_match_stats')
      .where('player_id', '==', player.id)
      .where('season', '==', season)
      .get();
  }

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (readCanonicalPlayerId(data) !== player.id) continue;
    const matchKey = stableMatchKey(data);
    const dedupeKey = `${player.id}|${matchKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const normalized = normalizeStats(
      (data.stats as Record<string, unknown> | undefined) ?? undefined,
      (data.raw_row as Record<string, unknown> | undefined) ?? undefined,
      data
    );

    for (const key of CANONICAL_STAT_KEYS) {
      aggregate.totals[key] = (aggregate.totals[key] ?? 0) + (Number(normalized[key] ?? 0) || 0);
    }
    aggregate.games += 1;
  }

  if (aggregate.games === 0) {
    return null; // Player has no matches for this season
  }

  const statsPerGame = buildEmptyStats();
  for (const key of CANONICAL_STAT_KEYS) {
    statsPerGame[key] = aggregate.totals[key] / aggregate.games;
  }

  return {
    playerId: player.id,
    playerName: player.name,
    season,
    gamesPlayed: aggregate.games,
    stats: statsPerGame,
    totals: aggregate.totals,
    lastUpdated: new Date(),
  };
}

async function writePlayerSeasonStat(stat: PlayerSeasonStat, dryRun: boolean): Promise<void> {
  const docId = `${stat.playerId}_${stat.season}`;
  
  if (dryRun) {
    console.log(`[DRY RUN] Would write ${docId}:`, {
      playerName: stat.playerName,
      season: stat.season,
      games: stat.gamesPlayed,
      sampleStats: {
        goals: stat.stats.goals.toFixed(2),
        kicks: stat.stats.kicks.toFixed(2),
        handballs: stat.stats.handballs.toFixed(2),
      },
    });
    return;
  }

  await adminDb.collection('player_season_stats').doc(docId).set({
    playerId: stat.playerId,
    playerName: stat.playerName,
    season: stat.season,
    gamesPlayed: stat.gamesPlayed,
    stats: stat.stats,
    totals: stat.totals,
    lastUpdated: stat.lastUpdated,
  });
}

async function validateAgainstOnDemand(
  player: { id: string; name: string; club?: string | null },
  season: number
): Promise<boolean> {
  const precomputed = await aggregatePlayerSeasonStats(player, season);
  if (!precomputed) {
    console.log(`⚠️  No matches found for ${player.name} in ${season}`);
    return true;
  }

  // Read what would be written
  const docId = `${player.id}_${season}`;
  const existing = await adminDb.collection('player_season_stats').doc(docId).get();
  
  if (!existing.exists) {
    console.log(`ℹ️  ${player.name} ${season}: Not yet pre-computed`);
    return true;
  }

  const data = existing.data() as PlayerSeasonStat;
  
  // Compare key stats
  const diffs: string[] = [];
  const sampleKeys: CanonicalStatKey[] = ['goals', 'kicks', 'handballs', 'marks', 'tackles'];
  for (const key of sampleKeys) {
    const expected = precomputed.stats[key];
    const actual = data.stats[key];
    const delta = Math.abs(expected - actual);
    if (delta > 0.01) {
      diffs.push(`${key}: expected=${expected.toFixed(2)}, actual=${actual.toFixed(2)}, delta=${delta.toFixed(3)}`);
    }
  }

  if (diffs.length > 0) {
    console.log(`❌ ${player.name} ${season}: Validation failed`);
    diffs.forEach(d => console.log(`   ${d}`));
    return false;
  }

  console.log(`✅ ${player.name} ${season}: Validated (${precomputed.gamesPlayed} games)`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const validateMode = args.includes('--validate');
  const playerFilter = args.find(a => a.startsWith('--player='))?.split('=')[1];
  const seasonFilter = args.find(a => a.startsWith('--season='))?.split('=')[1];
  const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;

  console.log('🚀 Player Season Stats Pre-Computation');
  console.log('======================================');
  if (dryRun) console.log('MODE: DRY RUN (no writes)');
  if (validateMode) console.log('MODE: VALIDATION');
  if (playerFilter) console.log(`FILTER: Player = "${playerFilter}"`);
  if (seasonFilter) console.log(`FILTER: Season = ${seasonFilter}`);
  if (limit) console.log(`LIMIT: ${limit} players`);
  console.log('');

  const seasons = seasonFilter ? [parseInt(seasonFilter, 10)] : DEFAULT_SEASONS;

  // Get all players from Prisma
  let players = await prisma.player.findMany({
    select: { id: true, name: true, club: true },
    orderBy: { name: 'asc' },
  });

  if (playerFilter) {
    players = players.filter(p => p.name.toLowerCase().includes(playerFilter.toLowerCase()));
  }

  if (limit) {
    players = players.slice(0, limit);
  }

  console.log(`📊 Processing ${players.length} players across ${seasons.length} seasons`);
  console.log(`   Total documents to process: ${players.length * seasons.length}`);
  console.log('');

  if (validateMode) {
    console.log('🔍 Validation Mode: Comparing pre-computed vs on-demand');
    console.log('');
    let passed = 0;
    let failed = 0;
    for (const player of players.slice(0, 10)) {
      for (const season of seasons) {
        const valid = await validateAgainstOnDemand(player, season);
        if (valid) passed++;
        else failed++;
      }
    }
    console.log('');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
  }

  let processed = 0;
  let written = 0;
  let skipped = 0;
  let errors = 0;

  const startTime = Date.now();

  for (const player of players) {
    for (const season of seasons) {
      processed++;
      try {
        const stat = await aggregatePlayerSeasonStats(player, season);
        
        if (!stat) {
          skipped++;
          if (processed % 50 === 0) {
            console.log(`[${processed}/${players.length * seasons.length}] Skipped ${player.name} ${season} (no matches)`);
          }
          continue;
        }

        await writePlayerSeasonStat(stat, dryRun);
        written++;

        if (processed % 10 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = processed / elapsed;
          const remaining = (players.length * seasons.length - processed) / rate;
          console.log(`[${processed}/${players.length * seasons.length}] ${player.name} ${season}: ${stat.gamesPlayed} games (${rate.toFixed(1)}/s, ~${Math.round(remaining)}s remaining)`);
        }
      } catch (error) {
        errors++;
        console.error(`❌ Error processing ${player.name} ${season}:`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log('');
  console.log('✅ Computation complete');
  console.log(`   Processed: ${processed}`);
  console.log(`   Written: ${written}`);
  console.log(`   Skipped: ${skipped} (no matches)`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Time: ${Math.round(elapsed)}s (${(processed / elapsed).toFixed(1)}/s)`);

  if (dryRun) {
    console.log('');
    console.log('ℹ️  This was a DRY RUN. No data was written.');
    console.log('   Run without --dry-run to write to Firestore.');
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
