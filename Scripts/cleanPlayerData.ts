import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import serviceAccount from '../serviceAccountKey.json' assert { type: 'json' };

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount as any) });
}
const db = getFirestore();

async function cleanPlayers() {
  const snapshot = await db.collection('players').get();
  let updated = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    let needsUpdate = false;
    const update: Record<string, any> = {};

    // Ensure id is a string and matches doc.id
    if (data.id !== doc.id) {
      update.id = doc.id;
      needsUpdate = true;
    }

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
      console.log(`Updated player doc ${doc.id}:`, update);
    }
  }

  console.log(`\n✅ Cleaned ${updated} player documents.`);
}

cleanPlayers().catch((err) => {
  console.error("Error cleaning player data:", err);
});
