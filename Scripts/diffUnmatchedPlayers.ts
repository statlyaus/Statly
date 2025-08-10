// scripts/diffUnmatchedPlayers.ts
import { cleanName, initFirestore, readJsonFile } from './utils';

const db = initFirestore();

async function main() {
  const datasetPath = process.argv[2];
  if (!datasetPath) {
    console.error('Usage: ts-node Scripts/diffUnmatchedPlayers.ts <datasetPath>');
    process.exit(1);
  }
  const matchLogs = await readJsonFile<Array<{ Player: string }>>(datasetPath);

  const namesFromMatchLogs = new Set<string>(
    matchLogs.map((entry) => cleanName(entry.Player))
  );

  const playersSnapshot = await db.collection('players').get();
  const firestoreNames = new Set<string>();

  for (const doc of playersSnapshot.docs) {
    const originalName = doc.data().name;
    const cleanedName = cleanName(originalName);
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
  unmatched.forEach((name) => console.log(`⚠️ ${name}`));

  console.log('\n📌 First 5 from match logs:');
  console.log(Array.from(namesFromMatchLogs).slice(0, 5));

  console.log('\n📌 First 5 from Firestore:');
  console.log(Array.from(firestoreNames).slice(0, 5));
}

main();
