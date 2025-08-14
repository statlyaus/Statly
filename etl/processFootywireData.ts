#!/usr/bin/env node
import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import * as readline from 'readline';

// Initialize Firebase Admin
if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON 
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, 'base64').toString('utf-8'))
    : require('./serviceAccountKey.json');
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
  });
}

const db = admin.firestore();

// Team abbreviation mapping
const TEAM_ABBR: Record<string, string> = {
  'Adelaide': 'ADE', 'Adelaide Crows': 'ADE',
  'Brisbane Lions': 'BRL', 'Brisbane': 'BRL',
  'Carlton': 'CAR', 'Carlton Blues': 'CAR',
  'Collingwood': 'COL', 'Collingwood Magpies': 'COL',
  'Essendon': 'ESS', 'Essendon Bombers': 'ESS',
  'Fremantle': 'FRE', 'Fremantle Dockers': 'FRE',
  'Geelong': 'GEE', 'Geelong Cats': 'GEE',
  'Gold Coast': 'GCS', 'Gold Coast Suns': 'GCS',
  'GWS': 'GWS', 'GWS Giants': 'GWS', 'Greater Western Sydney': 'GWS',
  'Hawthorn': 'HAW', 'Hawthorn Hawks': 'HAW',
  'Melbourne': 'MEL', 'Melbourne Demons': 'MEL',
  'North Melbourne': 'NTH', 'North Melbourne Kangaroos': 'NTH',
  'Port Adelaide': 'PTA', 'Port Adelaide Power': 'PTA',
  'Richmond': 'RIC', 'Richmond Tigers': 'RIC',
  'St Kilda': 'STK', 'St Kilda Saints': 'STK',
  'Sydney': 'SYD', 'Sydney Swans': 'SYD',
  'West Coast': 'WCE', 'West Coast Eagles': 'WCE',
  'Western Bulldogs': 'WBD', 'Footscray': 'WBD'
};

function getTeamAbbr(team: string): string {
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

interface PlayerRow {
  season: number;
  round: number;
  team: string;
  opposition: string;
  player_name: string;
  kicks?: number;
  handballs?: number;
  disposals?: number;
  marks?: number;
  tackles?: number;
  goals?: number;
  behinds?: number;
  hit_outs?: number;
  clearances?: number;
  inside_50s?: number;
  rebound_50s?: number;
  clangers?: number;
  contested_possessions?: number;
  uncontested_possessions?: number;
  frees_for?: number;
  frees_against?: number;
  one_percenters?: number;
  goal_assists?: number;
  turnovers?: number;
  intercepts?: number;
  metres_gained?: number;
  contested_marks?: number;
  effective_disposals?: number;
  score_involvements?: number;
  minutes?: number;
  tog_pct?: number;
}

interface ProcessedStats {
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  tackles: number;
  goals: number;
  behinds: number;
  hit_outs: number;
  clearances: number;
  inside_50s: number;
  rebound_50s: number;
  clangers: number;
  contested_possessions: number;
  uncontested_possessions: number;
  frees_for: number;
  frees_against: number;
  one_percenters: number;
  goal_assists: number;
  turnovers: number;
  intercepts: number;
  metres_gained: number;
  contested_marks: number;
  effective_disposals: number;
  score_involvements: number;
  minutes: number;
  tog_pct: number;
}

async function checkMatchStatus(matchUid: string): Promise<string> {
  try {
    const matchDoc = await db.collection('matches').doc(matchUid).get();
    return matchDoc.exists ? matchDoc.data()?.status || 'unknown' : 'unknown';
  } catch (error) {
    console.error(`Error checking match status for ${matchUid}:`, error);
    return 'unknown';
  }
}

async function processPlayerRow(row: PlayerRow): Promise<void> {
  const teamAbbr = getTeamAbbr(row.team);
  const oppAbbr = row.opposition ? getTeamAbbr(row.opposition) : 'UNK';
  
  const matchUid = `${row.season}-R${row.round}-${teamAbbr}-${oppAbbr}`;
  const playerUid = `ply_${slugify(row.player_name)}`;
  const docId = `${matchUid}_${playerUid}`;
  
  // Check if match is still in progress before processing
  const matchStatus = await checkMatchStatus(matchUid);
  if (matchStatus !== 'in_progress') {
    console.log(`Skipping ${docId} - match status: ${matchStatus}`);
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
  
  // Map to processed stats (default to 0 for missing values)
  const stats: ProcessedStats = {
    kicks: row.kicks || 0,
    handballs: row.handballs || 0,
    disposals: row.disposals || 0,
    marks: row.marks || 0,
    tackles: row.tackles || 0,
    goals: row.goals || 0,
    behinds: row.behinds || 0,
    hit_outs: row.hit_outs || 0,
    clearances: row.clearances || 0,
    inside_50s: row.inside_50s || 0,
    rebound_50s: row.rebound_50s || 0,
    clangers: row.clangers || 0,
    contested_possessions: row.contested_possessions || 0,
    uncontested_possessions: row.uncontested_possessions || 0,
    frees_for: row.frees_for || 0,
    frees_against: row.frees_against || 0,
    one_percenters: row.one_percenters || 0,
    goal_assists: row.goal_assists || 0,
    turnovers: row.turnovers || 0,
    intercepts: row.intercepts || 0,
    metres_gained: row.metres_gained || 0,
    contested_marks: row.contested_marks || 0,
    effective_disposals: row.effective_disposals || 0,
    score_involvements: row.score_involvements || 0,
    minutes: row.minutes || 0,
    tog_pct: row.tog_pct || 0
  };
  
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
    last_updated: admin.firestore.FieldValue.serverTimestamp(),
    data_source: 'footywire_fitzroy'
  };
  
  // Upsert document
  try {
    await docRef.set(documentData, { merge: true });
    console.log(`✓ Updated ${docId} - ${row.player_name} (${row.team})`);
    
    // Add jitter delay
    const delay = addJitter(0, 6000);
    await new Promise(resolve => setTimeout(resolve, delay));
    
  } catch (error) {
    console.error(`✗ Failed to update ${docId}:`, error);
  }
}

async function main(): Promise<void> {
  console.log('Starting Footywire ETL processor...');
  console.log('Reading NDJSON from STDIN...');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
  
  let processedCount = 0;
  let errorCount = 0;
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      const row: PlayerRow = JSON.parse(line);
      await processPlayerRow(row);
      processedCount++;
    } catch (error) {
      console.error(`Error processing line: ${line}`, error);
      errorCount++;
    }
  }
  
  console.log(`\nETL Complete: ${processedCount} processed, ${errorCount} errors`);
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
  main().catch(console.error);
}

export { processPlayerRow, checkMatchStatus };
