// scripts/diffUnmatchedPlayers.ts
import fs from 'fs/promises';
import { initializeApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import serviceAccount from '../serviceAccountKey.json' assert { type: 'json' };

initializeApp({
  credential: cert(serviceAccount as ServiceAccount),
});

const db = getFirestore();

function clean(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function main() {
  const json = await fs.readFile('./player_stats_2025.json', 'utf-8');
  const matchLogs = JSON.parse(json);

  const namesFromMatchLogs = new Set<string>(matchLogs.map((entry: any) => clean(entry.Player)));

  const playersSnapshot = await db.collection('players').get();
  const firestoreNames = new Set<string>();

  for (const doc of playersSnapshot.docs) {
    const originalName = doc.data().name;
    const cleanedName = clean(originalName);
    firestoreNames.add(cleanedName);

    // ✅ Update Firestore if name needs cleaning
    if (originalName !== cleanedName) {
      await db.collection('players').doc(doc.id).update({ name: cleanedName });
      console.log(`✅ Updated name for doc ${doc.id}: '${originalName}' -> '${cleanedName}'`);
    }
  }

  const unmatched: string[] = [];
  namesFromMatchLogs.forEach((name) => {
    const playerName = name;
    if (!firestoreNames.has(playerName)) {
      unmatched.push(playerName);
    }
  });

  console.log(`\n🔍 Total unmatched: ${unmatched.length}`);
  unmatched.forEach(name => console.log(`⚠️ ${name}`));

  console.log('\n📌 First 5 from match logs:');
  console.log(Array.from(namesFromMatchLogs).slice(0, 5));

  console.log('\n📌 First 5 from Firestore:');
  console.log(Array.from(firestoreNames).slice(0, 5));
}

main();