/**
 * Firebase Database Initialization Script
 * This script sets up the required Firebase collections with sample data
 * Run this to initialize your Firebase database for ETL integration
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

// Initialize Firebase Admin
if (!getApps().length) {
  try {
    let serviceAccount;

    // Try to get service account from different environment variables
    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
      const decodedJson = Buffer.from(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
        'base64'
      ).toString('utf-8');
      serviceAccount = JSON.parse(decodedJson);
    } else {
      // Fallback to file-based service account
      const serviceAccountPath = path.join(
        process.cwd(),
        'statly-4cbed-firebase-adminsdk-fbsvc-7df0e3dae3.json'
      );
      serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    }

    initializeApp({
      credential: cert(serviceAccount),
    });
    console.log('✅ Firebase Admin initialized');
  } catch (error) {
    console.error('❌ Failed to initialize Firebase Admin:', error);
    process.exit(1);
  }
}

const db = getFirestore();

// Sample match data
const sampleMatches = [
  {
    id: 'match_001',
    season: 2025,
    round_number: 1,
    home_team: 'Carlton',
    away_team: 'Richmond',
    home_score: 105,
    away_score: 98,
    match_date: '2025-03-20T19:30:00Z',
    venue: 'MCG',
    status: 'completed',
  },
  {
    id: 'match_002',
    season: 2025,
    round_number: 1,
    home_team: 'Collingwood',
    away_team: 'Essendon',
    home_score: 87,
    away_score: 92,
    match_date: '2025-03-21T14:10:00Z',
    venue: 'MCG',
    status: 'completed',
  },
  {
    id: 'match_003',
    season: 2025,
    round_number: 2,
    home_team: 'Melbourne',
    away_team: 'Sydney',
    home_score: 0,
    away_score: 0,
    match_date: '2025-03-28T19:30:00Z',
    venue: 'MCG',
    status: 'scheduled',
  },
];

// Sample player stats data
const samplePlayerStats = [
  {
    id: 'stats_001',
    player_id: 'player_001',
    player_name: 'Charlie Curnow',
    match_id: 'match_001',
    season: 2025,
    round_number: 1,
    team: 'Carlton',
    position: 'FWD',
    disposals: 18,
    kicks: 12,
    handballs: 6,
    marks: 8,
    goals: 3,
    behinds: 1,
    tackles: 4,
    hitouts: 0,
    fantasy_points: 98,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'stats_002',
    player_id: 'player_002',
    player_name: 'Patrick Cripps',
    match_id: 'match_001',
    season: 2025,
    round_number: 1,
    team: 'Carlton',
    position: 'MID',
    disposals: 32,
    kicks: 18,
    handballs: 14,
    marks: 6,
    goals: 1,
    behinds: 0,
    tackles: 8,
    hitouts: 2,
    fantasy_points: 124,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'stats_003',
    player_id: 'player_003',
    player_name: 'Dustin Martin',
    match_id: 'match_001',
    season: 2025,
    round_number: 1,
    team: 'Richmond',
    position: 'MID',
    disposals: 25,
    kicks: 15,
    handballs: 10,
    marks: 5,
    goals: 2,
    behinds: 1,
    tackles: 6,
    hitouts: 0,
    fantasy_points: 108,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// Sample players data
const samplePlayers = [
  {
    id: 'player_001',
    name: 'Charlie Curnow',
    team: 'Carlton',
    position: 'FWD',
    jersey_number: 43,
    season: 2025,
    games_played: 1,
    total_disposals: 18,
    total_goals: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'player_002',
    name: 'Patrick Cripps',
    team: 'Carlton',
    position: 'MID',
    jersey_number: 9,
    season: 2025,
    games_played: 1,
    total_disposals: 32,
    total_goals: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'player_003',
    name: 'Dustin Martin',
    team: 'Richmond',
    position: 'MID',
    jersey_number: 4,
    season: 2025,
    games_played: 1,
    total_disposals: 25,
    total_goals: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

async function initializeFirebaseCollections() {
  try {
    console.log('🚀 Starting Firebase database initialization...');

    // Create matches collection
    console.log('📝 Creating matches collection...');
    for (const match of sampleMatches) {
      await db.collection('matches').doc(match.id).set(match);
      console.log(`   ✅ Added match: ${match.home_team} vs ${match.away_team}`);
    }

    // Create players collection
    console.log('📝 Creating players collection...');
    for (const player of samplePlayers) {
      await db.collection('players').doc(player.id).set(player);
      console.log(`   ✅ Added player: ${player.name} (${player.team})`);
    }

    // Create player_match_stats collection
    console.log('📝 Creating player_match_stats collection...');
    for (const stat of samplePlayerStats) {
      await db.collection('player_match_stats').doc(stat.id).set(stat);
      console.log(`   ✅ Added stats: ${stat.player_name} - ${stat.fantasy_points} points`);
    }

    console.log('\n🎉 Firebase database initialization completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`   - ${sampleMatches.length} matches created`);
    console.log(`   - ${samplePlayers.length} players created`);
    console.log(`   - ${samplePlayerStats.length} player stats created`);

    console.log('\n🔗 Test your API endpoints:');
    console.log('   - GET /api/player-stats?season=2025&round=1');
    console.log('   - GET /api/matches/enhanced?season=2025');
  } catch (error) {
    console.error('❌ Failed to initialize Firebase collections:', error);
    throw error;
  }
}

// Run the initialization
initializeFirebaseCollections()
  .then(() => {
    console.log('\n✅ Initialization complete. You can now test your ETL integration!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Initialization failed:', error);
    process.exit(1);
  });

export { initializeFirebaseCollections };
