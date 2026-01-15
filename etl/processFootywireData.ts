#!/usr/bin/env node
import { createHash } from 'crypto';
import * as readline from 'readline';
import * as admin from 'firebase-admin';
import { z } from 'zod';

// Lightweight structured logger wrapper (replace with '@/lib/logger' if available)
type Logger = {
  info: (message?: any, ...optionalParams: any[]) => void;
  warn: (message?: any, ...optionalParams: any[]) => void;
  error: (message?: any, ...optionalParams: any[]) => void;
  performanceWarn?: (message?: any, ...optionalParams: any[]) => void;
  time?: (label?: string) => void;
  timeEnd?: (label?: string) => void;
};
const logger: Logger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  performanceWarn: (...args) => console.warn(...args),
  time: (label?: string) => console.time(label),
  timeEnd: (label?: string) => console.timeEnd(label),
};

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

function computeChecksum(data: unknown): string {
  return createHash('md5').update(JSON.stringify(data)).digest('hex');
}

// ---- Firebase Admin initialization (lazy) ----
function initAdmin(): void {
  if (admin.apps.length) return;
  try {
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

    logger.info(`🔥 Firebase Admin initialized for project: ${serviceAccount.project_id}`);
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin:', error);
    throw error;
  }
}

function getDb(): FirebaseFirestore.Firestore {
  initAdmin();
  return admin.firestore();
}

// ---- Types ----
interface PlayerRow {
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

type MatchStatus = 'scheduled' | 'in_progress' | 'final' | 'unknown';
type ProcessResult = 'written' | 'skipped_status' | 'skipped_unchanged';

const PlayerRowSchema = z
  .object({
  season: z.coerce.number(),
  round: z.coerce.number(),
  team: z.string(),
  opposition: z.string().optional(),
  player_name: z.string().min(1),
  kicks: z.coerce.number().optional(),
  handballs: z.coerce.number().optional(),
  disposals: z.coerce.number().optional(),
  marks: z.coerce.number().optional(),
  tackles: z.coerce.number().optional(),
  goals: z.coerce.number().optional(),
  behinds: z.coerce.number().optional(),
  hit_outs: z.coerce.number().optional(),
  clearances: z.coerce.number().optional(),
  inside_50s: z.coerce.number().optional(),
  rebound_50s: z.coerce.number().optional(),
  clangers: z.coerce.number().optional(),
  contested_possessions: z.coerce.number().optional(),
  uncontested_possessions: z.coerce.number().optional(),
  frees_for: z.coerce.number().optional(),
  frees_against: z.coerce.number().optional(),
  one_percenters: z.coerce.number().optional(),
  goal_assists: z.coerce.number().optional(),
  turnovers: z.coerce.number().optional(),
  intercepts: z.coerce.number().optional(),
  metres_gained: z.coerce.number().optional(),
  contested_marks: z.coerce.number().optional(),
  effective_disposals: z.coerce.number().optional(),
  score_involvements: z.coerce.number().optional(),
  minutes: z.coerce.number().optional(),
  tog_pct: z.coerce.number().optional(),
})
  .passthrough();

function n(v: unknown): number {
  const num = Number(v);
  return Number.isFinite(num) ? num : 0;
}

async function checkMatchStatus(matchUid: string): Promise<MatchStatus> {
  try {
    const matchDoc = await getDb().collection('matches').doc(matchUid).get();
    const status = (matchDoc.exists ? (matchDoc.data()?.status as MatchStatus | undefined) : undefined) ?? 'unknown';
    return status;
  } catch (error) {
    logger.error(`Error checking match status for ${matchUid}:`, error);
    return 'unknown';
  }
}

async function processPlayerRow(
  row: PlayerRow,
  writer?: FirebaseFirestore.BulkWriter,
): Promise<ProcessResult> {
  const teamAbbr = getTeamAbbr(row.team);
  const oppAbbr = row.opposition ? getTeamAbbr(row.opposition) : 'UNK';

  const matchUid = `${row.season}-R${row.round}-${teamAbbr}-${oppAbbr}`;
  const playerUid = `ply_${slugify(row.player_name)}`;
  const docId = `${matchUid}_${playerUid}`;

  // Check if we're in backfill mode (skip match status validation for historical data)
  const isBackfillMode = process.env.BACKFILL_MODE === 'true';
  const logBackfill = process.env.BACKFILL_LOGS === 'true';

  // Configurable gating of allowed statuses (default to in_progress)
  const allowedStatuses = new Set(
    (process.env.ALLOWED_MATCH_STATUSES ?? 'in_progress')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // Check if match is still in progress before processing (skip in backfill mode)
  if (!isBackfillMode) {
    const matchStatus = await checkMatchStatus(matchUid);
    if (!allowedStatuses.has(matchStatus)) {
      if (!isBackfillMode || logBackfill) {
        logger.info(`Skipping ${docId} - match status: ${matchStatus}`);
      }
      return 'skipped_status';
    }
  }

  // Compute checksum of raw data
  const rawChecksum = computeChecksum(row);

  // Check if document exists and has same checksum
  const docRef = getDb().collection('player_match_stats').doc(docId);
  const existingDoc = await docRef.get();

  if (existingDoc.exists) {
    const existingData = existingDoc.data();
    if (existingData?.raw_checksum === rawChecksum) {
      if (!isBackfillMode || logBackfill) {
        logger.info(`Skipping ${docId} - no changes detected`);
      }
      return 'skipped_unchanged';
    }
  }

  // Map to processed stats (coerce to numbers)
  const stats: ProcessedStats = {
    kicks: n(row.kicks),
    handballs: n(row.handballs),
    disposals: n(row.disposals),
    marks: n(row.marks),
    tackles: n(row.tackles),
    goals: n(row.goals),
    behinds: n(row.behinds),
    hit_outs: n(row.hit_outs),
    clearances: n(row.clearances),
    inside_50s: n(row.inside_50s),
    rebound_50s: n(row.rebound_50s),
    clangers: n(row.clangers),
    contested_possessions: n(row.contested_possessions),
    uncontested_possessions: n(row.uncontested_possessions),
    frees_for: n(row.frees_for),
    frees_against: n(row.frees_against),
    one_percenters: n(row.one_percenters),
    goal_assists: n(row.goal_assists),
    turnovers: n(row.turnovers),
    intercepts: n(row.intercepts),
    metres_gained: n(row.metres_gained),
    contested_marks: n(row.contested_marks),
    effective_disposals: n(row.effective_disposals),
    score_involvements: n(row.score_involvements),
    minutes: n(row.minutes),
    tog_pct: n(row.tog_pct),
  };

  const dataSource = process.env.DATA_SOURCE || 'footywire_fitzroy';

  // Prepare document for upsert
  const documentData = {
    match_id: matchUid,
    matchUid,
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
    last_seen_at: new Date().toISOString(),
    last_updated: admin.firestore.FieldValue.serverTimestamp(),
    data_source: dataSource,
  } as const;

  // Upsert document
  try {
    if (writer) {
      await writer.set(docRef, documentData, { merge: true });
    } else {
      await docRef.set(documentData, { merge: true });
    }
    if (!isBackfillMode || logBackfill) {
      logger.info(`✓ Updated ${docId} - ${row.player_name} (${row.team})`);
    }
    return 'written';
  } catch (error) {
    logger.error(`✗ Failed to update ${docId}:`, error);
    throw error;
  }
}

async function main(): Promise<void> {
  logger.info('Starting Footywire ETL processor...');
  logger.info('Reading NDJSON from STDIN...');

  const rl = readline.createInterface({
    input: process.stdin,
  });

  let processedCount = 0;
  let errorCount = 0;
  let skippedStatusCount = 0;
  let skippedUnchangedCount = 0;
  let shuttingDown = false;

  // Initialize BulkWriter for efficient writes
  const writer = getDb().bulkWriter();

  process.on('SIGINT', () => {
    if (!shuttingDown) logger.info('\nReceived SIGINT, shutting down gracefully...');
    shuttingDown = true;
    rl.close();
  });

  process.on('SIGTERM', () => {
    if (!shuttingDown) logger.info('\nReceived SIGTERM, shutting down gracefully...');
    shuttingDown = true;
    rl.close();
  });

  try {
    for await (const line of rl) {
      if (shuttingDown) break;
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);
        const row: PlayerRow = PlayerRowSchema.parse(parsed);
        const result = await processPlayerRow(row, writer);
        if (result === 'written') processedCount++;
        if (result === 'skipped_status') skippedStatusCount++;
        if (result === 'skipped_unchanged') skippedUnchangedCount++;
      } catch (error) {
        logger.error(`Error processing line: ${line}`, error);
        errorCount++;
      }
    }
  } finally {
    // Ensure writer flushes remaining operations
    try {
      await writer.close();
    } catch (err) {
      logger.error('Error closing BulkWriter:', err);
      errorCount++;
    }
  }

  logger.info(
    `\nETL Complete: ${processedCount} written, ${skippedStatusCount} skipped_status, ${skippedUnchangedCount} skipped_unchanged, ${errorCount} errors`
  );

  if (errorCount > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    logger.error('Unhandled error in main()', err);
    process.exitCode = 1;
  });
}

export { processPlayerRow, checkMatchStatus };
