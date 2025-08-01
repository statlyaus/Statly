import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import type { ServiceAccount } from 'firebase-admin';

import serviceAccount from '../serviceAccountKey.json' assert { type: 'json' };

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount as ServiceAccount) });
}

const db = getFirestore();

async function cleanPlayers(verbose = false) {
  const snapshot = await db.collection('players').get();
  let updated = 0;
  const updatedDocs: string[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    let needsUpdate = false;
    const update: Record<string, any> = {};

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
