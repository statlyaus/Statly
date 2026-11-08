#!/usr/bin/env node
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'crypto';
import * as readline from 'readline';

import { findFixtureMatch, shouldStoreMatchStats, type FixtureMatch } from './fixtureIngest';
import { normalizePlayerRow, toProcessedStats, type PlayerRow } from './normalizePlayerRow';

// Initialize Firebase Admin using same pattern as main project
if (getApps().length === 0) {
  try {
    const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;

    if (!serviceAccountBase64) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 environment variable is required');
    }

    const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
    const serviceAccount = JSON.parse(serviceAccountJson);

    initializeApp({
      credential: cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key,
      }),
      projectId: serviceAccount.project_id,
    });

    console.log(`🔥 Firebase Admin initialized for project: ${serviceAccount.project_id}`);
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
    process.exit(1);
  }
}

const db = getFirestore();

// Team abbreviation mapping
const TEAM_ABBR: Record<string, string> = {
  Adelaide: 'ADE',
  'Adelaide Crows': 'ADE',
  'Brisbane Lions': 'BRL',
  Brisbane: 'BRL',
  Carlton: 'CAR',
  'Carlton Blues': 'CAR',
  Collingwood: 'COL',
  'Collingwood Magpies': 'COL',
  Essendon: 'ESS',
  'Essendon Bombers': 'ESS',
  Fremantle: 'FRE',
  'Fremantle Dockers': 'FRE',
  Geelong: 'GEE',
  'Geelong Cats': 'GEE',
  'Gold Coast': 'GCS',
  'Gold Coast Suns': 'GCS',
  GWS: 'GWS',
  'GWS Giants': 'GWS',
  'Greater Western Sydney': 'GWS',
  Hawthorn: 'HAW',
  'Hawthorn Hawks': 'HAW',
  Melbourne: 'MEL',
  'Melbourne Demons': 'MEL',
  'North Melbourne': 'NTH',
  'North Melbourne Kangaroos': 'NTH',
  'Port Adelaide': 'PTA',
  'Port Adelaide Power': 'PTA',
  Richmond: 'RIC',
  'Richmond Tigers': 'RIC',
  'St Kilda': 'STK',
  'St Kilda Saints': 'STK',
  Sydney: 'SYD',
  'Sydney Swans': 'SYD',
  'West Coast': 'WCE',
  'West Coast Eagles': 'WCE',
  'Western Bulldogs': 'WBD',
  Footscray: 'WBD',
};

function getTeamAbbr(team: string): string {
  if (!team || typeof team !== 'string') {
    return 'UNK';
  }
  return TEAM_ABBR[team] || team.substring(0, 3).toUpperCase();
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_');
}

function computeChecksum(data: any): string {
  return createHash('md5').update(JSON.stringify(data)).digest('hex');
}

function addJitter(baseMs: number, jitterMs: number = 6000): number {
  return baseMs + Math.random() * jitterMs;
}

type StoredFixtureMatch = Pick<FixtureMatch, 'match_uid' | 'home_team' | 'away_team' | 'status'>;

// The round's fixture is read once per run; etl/processFixtureData.ts writes it before the stats.
const fixtureByRound = new Map<string, Promise<StoredFixtureMatch[]>>();

function readRoundFixture(season: number, round: number): Promise<StoredFixtureMatch[]> {
  const key = `${season}:${round}`;
  let fixture = fixtureByRound.get(key);
  if (!fixture) {
    fixture = db
      .collection('matches')
      .where('season', '==', season)
      .where('round_number', '==', round)
      .get()
      .then((snapshot) => snapshot.docs.map((doc) => doc.data() as StoredFixtureMatch));
    // A failed read is retried by the next row rather than cached.
    fixture.catch(() => fixtureByRound.delete(key));
    fixtureByRound.set(key, fixture);
  }
  return fixture;
}

/** The fixture's HOME-AWAY match for a stats row, whichever club the row belongs to. */
async function resolveFixtureMatch(
  row: PlayerRow,
  teamAbbr: string,
  oppAbbr: string
): Promise<StoredFixtureMatch> {
  const match = findFixtureMatch(await readRoundFixture(row.season, row.round), teamAbbr, oppAbbr);
  if (!match) {
    throw new Error(
      `No fixture match for ${row.season} round ${row.round} ${row.team} v ${row.opposition}; ` +
        'load the fixture first (npm run fixture)'
    );
  }
  return match;
}

async function processPlayerRow(row: PlayerRow): Promise<void> {
  const teamAbbr = getTeamAbbr(row.team);
  const oppAbbr = row.opposition ? getTeamAbbr(row.opposition) : 'UNK';

  const match = await resolveFixtureMatch(row, teamAbbr, oppAbbr);
  const matchUid = match.match_uid;
  const playerUid = `ply_${slugify(row.player_name)}`;
  const docId = `${matchUid}_${playerUid}`;

  // Live runs store live and final games only; backfill stores historical games whatever their status.
  if (!shouldStoreMatchStats(match.status, process.env.BACKFILL_MODE === 'true')) {
    console.log(`Skipping ${docId} - match status: ${match.status ?? 'missing'}`);
    return;
  }

  // Compute checksum of raw data
  const rawChecksum = computeChecksum(row);

  // Check if document exists and has same checksum
  const docRef = db.collection('player_match_stats').doc(docId);
  const existingDoc = await docRef.get();

  if (existingDoc.exists) {
    const existingData = existingDoc.data();
    if (existingData?.raw_checksum === rawChecksum) {
      console.log(`Skipping ${docId} - no changes detected`);
      return;
    }
  }

  // Missing stats stay null; a row missing a category stat throws before anything is written.
  const stats = toProcessedStats(row);

  // Prepare document for upsert
  const documentData = {
    match_uid: matchUid,
    player_uid: playerUid,
    season: row.season,
    round: row.round,
    team: row.team,
    team_abbr: teamAbbr,
    opposition: row.opposition || 'Unknown',
    opposition_abbr: oppAbbr,
    player_name: row.player_name,
    stats,
    raw_row: row, // Store original data
    raw_checksum: rawChecksum,
    last_updated: FieldValue.serverTimestamp(),
    data_source: 'footywire_fitzroy',
  };

  await docRef.set(documentData, { merge: true });
  console.log(`✓ Updated ${docId} - ${row.player_name} (${row.team})`);

  // Add jitter delay
  const delay = addJitter(0, 6000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function main(): Promise<void> {
  console.log('Starting Footywire ETL processor...');
  console.log('Reading NDJSON from STDIN...');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  let processedCount = 0;
  let errorCount = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const row = normalizePlayerRow(JSON.parse(line));
      await processPlayerRow(row);
      processedCount++;
    } catch (error) {
      console.error(`Error processing line: ${line}`, error);
      errorCount++;
    }
  }

  console.log(`\nETL Complete: ${processedCount} processed, ${errorCount} errors`);

  if (errorCount > 0) {
    process.exitCode = 1;
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  process.exit(0);
});

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal ETL processor error:', error);
    process.exitCode = 1;
  });
}

export { processPlayerRow, normalizePlayerRow };
