import { spawn } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin (expects GOOGLE_SERVICE_ACCOUNT env var)
const svcKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT as string);
initializeApp({ credential: cert(svcKey) });
const db = getFirestore();

type Row = {
  season: number;
  round: number;
  team: string;
  opposition?: string;
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
};

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toUid(name: string): string {
  return (
    'ply_' +
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
  );
}

function matchUid(season: number, round: number, team: string, opp?: string): string {
  const t = (team || '').slice(0, 3).toUpperCase();
  const o = (opp || '').slice(0, 3).toUpperCase();
  return `${season}-R${round}-${t}-${o || 'UNK'}`;
}

function checksum(obj: unknown): string {
  return 'sha256:' + createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

async function upsertRow(row: Row): Promise<void> {
  const playerUid = toUid(row.player_name);
  const matchId = matchUid(row.season, row.round, row.team, row.opposition);

  const docId = `${matchId}_${playerUid}`;
  const ref = db.collection('player_match_stats').doc(docId);

  const stats = {
    kicks: row.kicks ?? null,
    handballs: row.handballs ?? null,
    disposals: row.disposals ?? (row.kicks ?? 0) + (row.handballs ?? 0),
    marks: row.marks ?? null,
    tackles: row.tackles ?? null,
    goals: row.goals ?? null,
    behinds: row.behinds ?? null,
    hitouts: row.hit_outs ?? null,
    clearances: row.clearances ?? null,
    inside50s: row.inside_50s ?? null,
    rebound50s: row.rebound_50s ?? null,
    clangers: row.clangers ?? null,
    contested_possessions: row.contested_possessions ?? null,
    uncontested_possessions: row.uncontested_possessions ?? null,
    frees_for: row.frees_for ?? null,
    frees_against: row.frees_against ?? null,
    one_percenters: row.one_percenters ?? null,
    goal_assists: row.goal_assists ?? null,
    turnovers: row.turnovers ?? null,
    intercepts: row.intercepts ?? null,
    metres_gained: row.metres_gained ?? null,
    contested_marks: row.contested_marks ?? null,
    effective_disposals: row.effective_disposals ?? null,
    score_involvements: row.score_involvements ?? null,
    minutes: row.minutes ?? null,
    tog_pct: row.tog_pct ?? null,
  };

  const payload = {
    match_uid: matchId,
    player_uid: playerUid,
    team: row.team,
    season: row.season,
    round_number: row.round,
    source: 'footywire',
    last_seen_at: new Date().toISOString(),
    raw_checksum: checksum(stats),
    stats,
  };

  // Check if data has changed to avoid unnecessary writes
  const prev = await ref.get();
  if (prev.exists && prev.data()?.raw_checksum === payload.raw_checksum) {
    console.log(`No change for ${docId}, skipping...`);
    return;
  }

  await ref.set(payload, { merge: true });
  console.log(`Updated ${docId}`);
}

async function runOnce(): Promise<void> {
  const outfile = '/tmp/player_stats_footywire.json';

  // Try Python script first, fallback to R script
  const pythonScript = 'etl/fetch_fw_round.py';
  const rScript = 'etl/fetch_fw_round.R';

  let args: string[];
  let command: string;

  // Check if Python script exists and is executable
  if (fs.existsSync(pythonScript)) {
    command = 'python3';
    args = [pythonScript];
    console.log(`Using Python script: ${pythonScript}`);
  } else {
    command = 'Rscript';
    args = [rScript];
    console.log(`Using R script: ${rScript}`);
  }

  const env = { ...process.env, OUTFILE: outfile };

  console.log(`Running data fetch script...`);

  await new Promise<void>((resolve, reject) => {
    const p = spawn(command, args, { env });
    p.on('exit', (code) => {
      if (code === 0) {
        console.log('Data fetch script completed successfully');
        resolve();
      } else {
        reject(new Error(`${command} failed with code ${code}`));
      }
    });
    p.on('error', (error) => {
      console.error(`Failed to start ${command}:`, error);
      reject(error);
    });
  });

  if (!fs.existsSync(outfile)) {
    throw new Error(`Output file ${outfile} not found`);
  }

  const lines = fs.readFileSync(outfile, 'utf8').trim().split('\n');
  console.log(`Processing ${lines.length} player records...`);

  let processed = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      await upsertRow(JSON.parse(line) as Row);
      processed++;
    } catch (error) {
      console.error(`Error processing line: ${line}`, error);
    }
  }

  console.log(`Processed ${processed} player records`);
}

// Decide if any matches are live right now
async function isLiveWindow(): Promise<boolean> {
  try {
    const snap = await db.collection('matches').where('status', '==', 'in_progress').limit(1).get();
    return !snap.empty;
  } catch (error) {
    console.error('Error checking live window:', error);
    return false; // Default to false if we can't check
  }
}

// Main polling loop
async function main(): Promise<void> {
  console.log('Starting Footywire data ingestor...');

  const targetSecs = 30;

  while (true) {
    const started = Date.now();

    try {
      const live = await isLiveWindow();

      if (live) {
        console.log('Live matches detected, fetching data...');
        await runOnce();
      } else {
        console.log('No live matches, skipping this cycle...');
      }
    } catch (error) {
      console.error('Error in polling cycle:', error);
    }

    const elapsed = (Date.now() - started) / 1000;
    const jitter = Math.floor(Math.random() * 7) - 3; // -3..+3s
    const sleepMs = Math.max(5, targetSecs + jitter - elapsed) * 1000;

    console.log(`Sleeping for ${sleepMs / 1000}s...`);
    await SLEEP(sleepMs);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Start the main loop
if (require.main === module) {
  main().catch(console.error);
}

export { runOnce, isLiveWindow };
