import 'dotenv/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { runFetchPipeline } from './fetchPipeline';

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
 * Check if any matches are currently in progress
 * @returns true if any match has status == "in_progress"
 */
async function isLiveWindow(): Promise<boolean> {
  try {
    const snapshot = await db
      .collection('matches')
      .where('status', '==', 'in_progress')
      .limit(1)
      .get();

    const hasLiveMatches = !snapshot.empty;
    console.log(
      `Live window check: ${hasLiveMatches ? 'ACTIVE' : 'INACTIVE'} (${snapshot.size} live matches)`
    );

    return hasLiveMatches;
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

/**
 * Main guard loop
 */
async function runGuardLoop(): Promise<void> {
  console.log('🚀 Starting Live Guard...');

  while (true) {
    try {
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

export { isLiveWindow, runFetchCycle };
