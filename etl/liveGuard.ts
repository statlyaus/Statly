import 'dotenv/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { runFetchPipeline, runFixturePipeline } from './fetchPipeline';
import { FINAL_STATS_WINDOW_MS, statsWindowOpen, type FixtureMatch } from './fixtureIngest';

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

/**
 * Whether the stats pipeline should run: a game is in progress, or a game that started recently has
 * just turned final (see statsWindowOpen). Games that started before the window are not read.
 */
async function isLiveWindow(now = new Date()): Promise<boolean> {
  try {
    const since = new Date(now.getTime() - FINAL_STATS_WINDOW_MS).toISOString();
    const [inProgress, recent] = await Promise.all([
      db.collection('matches').where('status', '==', 'in_progress').limit(1).get(),
      db
        .collection('matches')
        .where('start_time_utc', '>=', since)
        .where('start_time_utc', '<=', now.toISOString())
        .get(),
    ]);
    const matches = [...inProgress.docs, ...recent.docs].map(
      (doc) => doc.data() as Pick<FixtureMatch, 'status' | 'start_time_utc'>
    );
    const open = statsWindowOpen(matches, now);
    console.log(
      `Live window check: ${open ? 'ACTIVE' : 'INACTIVE'} (${matches.length} recent matches)`
    );
    return open;
  } catch (error) {
    console.error('Error checking live window:', error);
    return false;
  }
}

/**
 * Run one fetch/upsert cycle using R script + Node processor
 */
async function runFetchCycle(): Promise<void> {
  console.log('🔄 Starting fetch cycle...');

  await runFetchPipeline({
    season: process.env.SEASON || new Date().getFullYear(),
    round: process.env.ROUND || undefined,
  });

  console.log('✅ Fetch cycle completed successfully');
}

/**
 * Sleep with jitter
 */
function sleep(baseMs: number, jitterMs: number = 15000): Promise<void> {
  const delay = baseMs + Math.random() * jitterMs;
  console.log(`💤 Sleeping for ${Math.round(delay / 1000)}s...`);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

const FIXTURE_REFRESH_MS = Number(process.env.FIXTURE_REFRESH_MS) || 15 * 60 * 1000;
let lastFixtureRefreshAt = 0;

/**
 * Refresh Firestore `matches` from the Footywire fixture when it is older than
 * FIXTURE_REFRESH_MS. Match status (scheduled, in_progress, final) comes from this refresh, so a
 * failure is thrown: the caller skips the stats cycle rather than gating on stale statuses.
 */
async function refreshFixtureIfDue(now = Date.now()): Promise<void> {
  if (now - lastFixtureRefreshAt < FIXTURE_REFRESH_MS) return;
  await runFixturePipeline({ season: process.env.SEASON || new Date().getFullYear() });
  lastFixtureRefreshAt = now;
}

/**
 * Main guard loop
 */
async function runGuardLoop(): Promise<void> {
  console.log('🚀 Starting Live Guard...');

  while (true) {
    try {
      try {
        await refreshFixtureIfDue();
      } catch (error) {
        console.error('Fixture refresh failed; skipping this cycle:', error);
        await sleep(60000, 30000);
        continue;
      }

      const isLive = await isLiveWindow();

      if (!isLive) {
        // No live matches - longer sleep
        await sleep(60000, 30000); // 60-90s
        continue;
      }

      // Live matches found - run fetch cycle
      try {
        await runFetchCycle();
      } catch (error) {
        console.error('Fetch cycle failed:', error);
      }

      // Sleep between live cycles
      await sleep(30000, 15000); // 30-45s with jitter
    } catch (error) {
      console.error('Guard loop error:', error);
      await sleep(30000, 15000); // Sleep on error
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

if (require.main === module) {
  runGuardLoop().catch((error) => {
    console.error('Fatal error in guard loop:', error);
    process.exit(1);
  });
}

export { isLiveWindow, refreshFixtureIfDue, runFetchCycle };
