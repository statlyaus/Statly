import * as admin from 'firebase-admin';
import { spawn } from 'child_process';

// Initialize Firebase Admin using same pattern as main project
if (!admin.apps.length) {
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

const db = admin.firestore();

/**
 * Check if any matches are currently in progress
 * @returns true if any match has status == "in_progress"
 */
async function isLiveWindow(): Promise<boolean> {
  try {
    const snapshot = await db.collection('matches')
      .where('status', '==', 'in_progress')
      .limit(1)
      .get();
    
    const hasLiveMatches = !snapshot.empty;
    console.log(`Live window check: ${hasLiveMatches ? 'ACTIVE' : 'INACTIVE'} (${snapshot.size} live matches)`);
    
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
  return new Promise((resolve, reject) => {
    console.log('🔄 Starting fetch cycle...');
    
    const currentYear = new Date().getFullYear();
    const currentSeason = process.env.SEASON || currentYear.toString();
    const currentRound = process.env.ROUND || ''; // Let R script determine current round
    
    // Start R script
    const rScript = spawn('Rscript', ['fetch_fw_round.R', currentSeason, currentRound], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Start Node processor to read R script output
    const nodeProcessor = spawn('node', ['dist/processFootywireData.js'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Pipe R script STDOUT to Node processor STDIN
    rScript.stdout.pipe(nodeProcessor.stdin);
    
    let rError = '';
    let nodeError = '';
    
    rScript.stdout.on('data', () => {
      // R script output is piped to Node processor, no need to collect
    });
    
    rScript.stderr.on('data', (data) => {
      rError += data.toString();
    });
    
    nodeProcessor.stdout.on('data', (data) => {
      console.log(data.toString().trim());
    });
    
    nodeProcessor.stderr.on('data', (data) => {
      nodeError += data.toString();
      console.error(data.toString().trim());
    });
    
    let rFinished = false;
    let nodeFinished = false;
    
    const checkComplete = () => {
      if (rFinished && nodeFinished) {
        if (rError || nodeError) {
          console.error('❌ Fetch cycle failed');
          if (rError) console.error('R Script Error:', rError);
          if (nodeError) console.error('Node Processor Error:', nodeError);
          reject(new Error('Fetch cycle failed'));
        } else {
          console.log('✅ Fetch cycle completed successfully');
          resolve();
        }
      }
    };
    
    rScript.on('close', (code) => {
      rFinished = true;
      if (code !== 0) {
        console.error(`R script exited with code ${code}`);
      }
      nodeProcessor.stdin.end(); // Signal end of input to Node processor
      checkComplete();
    });
    
    nodeProcessor.on('close', (code) => {
      nodeFinished = true;
      if (code !== 0) {
        console.error(`Node processor exited with code ${code}`);
      }
      checkComplete();
    });
    
    // Set timeout for the entire process
    setTimeout(() => {
      rScript.kill();
      nodeProcessor.kill();
      reject(new Error('Fetch cycle timed out'));
    }, 300000); // 5 minutes timeout
  });
}

/**
 * Sleep with jitter
 */
function sleep(baseMs: number, jitterMs: number = 15000): Promise<void> {
  const delay = baseMs + Math.random() * jitterMs;
  console.log(`💤 Sleeping for ${Math.round(delay / 1000)}s...`);
  return new Promise(resolve => setTimeout(resolve, delay));
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
