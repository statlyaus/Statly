#!/usr/bin/env node
/**
 * Pre-compute season stats for fast player lookups
 * 
 * Usage:
 *   node Scripts/precompute-season-stats.js [options]
 * 
 * Options:
 *   --dry-run           Don't write to Firestore, just show what would be done
 *   --player=NAME       Process single player only (for testing)
 *   --season=YEAR       Process single season only
 *   --limit=N           Process first N players only
 * 
 * Examples:
 *   node Scripts/precompute-season-stats.js --dry-run --limit=5
 *   node Scripts/precompute-season-stats.js --player="Josh Daicos" --season=2025
 */

require('dotenv').config({ path: '.env.local' });

const admin = require('firebase-admin');
const { PrismaClient } = require('@prisma/client');

const DEFAULT_SEASONS = [2025, 2024, 2023];

// Initialize Firebase Admin
if (!admin.apps || !admin.apps.length) {
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

const CANONICAL_STAT_KEYS = [
  'goals', 'behinds', 'kicks', 'handballs', 'disposals', 'marks', 'tackles',
  'hitouts', 'clearances', 'inside50s', 'rebound50s', 'contestedPossessions',
  'uncontestedPossessions', 'goalAssists', 'scoreInvolvements', 'effectiveDisposals',
  'disposalEffPct', 'timeOnGroundPct', 'contestedMarks', 'intercepts', 'metresGained',
  'turnovers', 'freesFor', 'freesAgainst', 'onePercenters', 'clangers'
];

function buildEmptyStats() {
  const empty = {};
  for (const key of CANONICAL_STAT_KEYS) {
    empty[key] = 0;
  }
  return empty;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const RAW_KEY_MAP = {
  goals: 'goals',
  behinds: 'behinds',
  kicks: 'kicks',
  handballs: 'handballs',
  disposals: 'disposals',
  marks: 'marks',
  tackles: 'tackles',
  hitouts: 'hitouts',
  hit_outs: 'hitouts',
  clearances: 'clearances',
  inside_50s: 'inside50s',
  inside50s: 'inside50s',
  i50: 'inside50s',
  rebound_50s: 'rebound50s',
  rebound50s: 'rebound50s',
  r50: 'rebound50s',
  contested_possessions: 'contestedPossessions',
  contestedPossessions: 'contestedPossessions',
  uncontested_possessions: 'uncontestedPossessions',
  uncontestedPossessions: 'uncontestedPossessions',
  goal_assists: 'goalAssists',
  goalAssists: 'goalAssists',
  score_involvements: 'scoreInvolvements',
  scoreInvolvements: 'scoreInvolvements',
  effective_disposals: 'effectiveDisposals',
  effectiveDisposals: 'effectiveDisposals',
  disposal_efficiency_percentage: 'disposalEffPct',
  disposal_efficiency: 'disposalEffPct',
  disposalEfficiency: 'disposalEffPct',
  disposalEffPct: 'disposalEffPct',
  time_on_ground_percentage: 'timeOnGroundPct',
  timeOnGroundPct: 'timeOnGroundPct',
  contested_marks: 'contestedMarks',
  contestedMarks: 'contestedMarks',
  intercepts: 'intercepts',
  metres_gained: 'metresGained',
  metresGained: 'metresGained',
  turnovers: 'turnovers',
  frees_for: 'freesFor',
  freesFor: 'freesFor',
  frees_against: 'freesAgainst',
  freesAgainst: 'freesAgainst',
  one_percenters: 'onePercenters',
  onePercenters: 'onePercenters',
  clangers: 'clangers',
};

function canonicalStatKeyFromRaw(key) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return RAW_KEY_MAP[key] || RAW_KEY_MAP[normalized];
}

function normalizeStatsSimple(...sources) {
  const normalized = buildEmptyStats();
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const [rawKey, rawValue] of Object.entries(source)) {
      const canonicalKey = canonicalStatKeyFromRaw(rawKey);
      if (!canonicalKey) continue;
      const numeric = toNumber(rawValue);
      if (numeric === null) continue;
      normalized[canonicalKey] = numeric;
    }
  }
  return normalized;
}

function stableMatchKey(record) {
  const matchId = String(record.match_id || record.matchId || record.match_uid || record.matchUid || '').trim();
  if (matchId) return matchId;
  const season = String(record.season || record.year || '');
  const round = String(record.round_number || record.round || record.match_round || '');
  const date = String(record.match_date || record.date || '');
  const home = String(record.match_home_team || record.home_team || record.team || '').trim().toLowerCase();
  const away = String(record.match_away_team || record.away_team || record.opponent || '').trim().toLowerCase();
  return `${season}|${round}|${date}|${home}|${away}`;
}

function readCanonicalPlayerId(record) {
  const playerId = String(record.playerId || '').trim();
  if (playerId) return playerId;

  const legacyPlayerId = String(record.player_id || '').trim();
  return legacyPlayerId || null;
}

async function aggregatePlayerSeasonStats(playerName, playerId, season) {
  const seen = new Set();
  const aggregate = { totals: buildEmptyStats(), games: 0 };

  let snapshot = await adminDb
    .collection('player_match_stats')
    .where('playerId', '==', playerId)
    .where('season', '==', season)
    .get();

  if (snapshot.empty) {
    snapshot = await adminDb
      .collection('player_match_stats')
      .where('player_id', '==', playerId)
      .where('season', '==', season)
      .get();
  }

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (readCanonicalPlayerId(data) !== playerId) continue;
    const matchKey = stableMatchKey(data);
    const dedupeKey = `${playerId}|${matchKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const normalized = normalizeStatsSimple(data.stats, data.raw_row, data);

    for (const key of CANONICAL_STAT_KEYS) {
      aggregate.totals[key] = (aggregate.totals[key] || 0) + (Number(normalized[key] || 0) || 0);
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
    playerId,
    playerName,
    season,
    gamesPlayed: aggregate.games,
    stats: statsPerGame,
    totals: aggregate.totals,
    lastUpdated: new Date(),
  };
}

async function writePlayerSeasonStat(stat, dryRun) {
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
    lastUpdated: admin.firestore.Timestamp.fromDate(stat.lastUpdated),
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const playerFilter = args.find(a => a.startsWith('--player='))?.split('=')[1];
  const seasonFilter = args.find(a => a.startsWith('--season='))?.split('=')[1];
  const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;

  console.log('🚀 Player Season Stats Pre-Computation');
  console.log('======================================');
  if (dryRun) console.log('MODE: DRY RUN (no writes)');
  if (playerFilter) console.log(`FILTER: Player = "${playerFilter}"`);
  if (seasonFilter) console.log(`FILTER: Season = ${seasonFilter}`);
  if (limit) console.log(`LIMIT: ${limit} players`);
  console.log('');

  const seasons = seasonFilter ? [parseInt(seasonFilter, 10)] : DEFAULT_SEASONS;

  // Get all players from Prisma
  let players = await prisma.player.findMany({
    select: { id: true, name: true },
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

  let processed = 0;
  let written = 0;
  let skipped = 0;
  let errors = 0;

  const startTime = Date.now();

  for (const player of players) {
    for (const season of seasons) {
      processed++;
      try {
        const stat = await aggregatePlayerSeasonStats(player.name, player.id, season);
        
        if (!stat) {
          skipped++;
          if (processed % 50 === 0) {
            console.log(`[${processed}/${players.length * seasons.length}] Skipped ${player.name} ${season} (no matches)`);
          }
          continue;
        }

        await writePlayerSeasonStat(stat, dryRun);
        written++;

        if (processed % 10 === 0 || players.length === 1) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = processed / elapsed;
          const remaining = (players.length * seasons.length - processed) / rate;
          console.log(`[${processed}/${players.length * seasons.length}] ${player.name} ${season}: ${stat.gamesPlayed} games (${rate.toFixed(1)}/s, ~${Math.round(remaining)}s remaining)`);
        }
      } catch (error) {
        errors++;
        console.error(`❌ Error processing ${player.name} ${season}:`, error.message || String(error));
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

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
