import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

import type { ServiceAccount } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
let db: Firestore | null = null;

function loadServiceAccount(): ServiceAccount | null {
  try {
    const keyPath = new URL('../secrets/serviceAccountKey.json', import.meta.url);
    return JSON.parse(fs.readFileSync(keyPath, 'utf8')) as ServiceAccount;
  } catch (err) {
    console.warn(
      'Service account key not found; skipping Firebase initialization.',
      err
    );
    return null;
  }
}

const serviceAccount = loadServiceAccount();
if (serviceAccount) {
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
  }
  db = getFirestore();
}

async function cleanPlayers(verbose = false) {
  if (!db) {
    console.warn('Firestore not initialized. Aborting player cleanup.');
    return;
  }

  const snapshot = await db.collection('players').get();
  let updated = 0;
  const updatedDocs: string[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    let needsUpdate = false;
    const update: Record<string, unknown> = {};

    // Ensure name is present at top level
    if (!data.name) {
      // Try to get name from first match log
      const nameFromLog = data.matchLogs?.[0]?.Player;
      if (nameFromLog) {
        update.name = nameFromLog;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await doc.ref.set(update, { merge: true });
      updated++;
      updatedDocs.push(doc.id);
      if (verbose) {
        console.log(`Updated player doc ${doc.id}:`, update);
      }
    }
  }

  if (!verbose && updatedDocs.length > 0) {
    console.log(`Updated ${updatedDocs.length} player documents:`, updatedDocs.join(', '));
  }
  console.log(`\n✅ Cleaned ${updated} player documents.`);
}

if (require.main === module) {
  cleanPlayers().catch((err) => {
    console.error('Error cleaning player data:', err);
  });
}
