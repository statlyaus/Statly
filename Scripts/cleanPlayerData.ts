import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { ServiceAccount } from 'firebase-admin/app';

let db: ReturnType<typeof getFirestore> | null = null;

async function initDb() {
  if (db) return db;
  try {
    const saPath = path.join(process.cwd(), 'secrets', 'serviceAccountKey.json');
    const raw = await fs.readFile(saPath, 'utf8');
    const serviceAccount = JSON.parse(raw) as ServiceAccount;
    if (!getApps().length) {
      initializeApp({ credential: cert(serviceAccount) });
    }
    db = getFirestore();
  } catch {
    console.warn('Service account credentials not found; skipping Firestore init.');
  }
  return db;
}

async function cleanPlayers(verbose = false) {
  const db = await initDb();
  if (!db) {
    throw new Error('Firestore not initialized; service account credentials missing.');
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
