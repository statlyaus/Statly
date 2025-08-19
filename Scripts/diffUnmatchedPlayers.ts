// scripts/diffUnmatchedPlayers.ts
import { cleanName, initFirestore, readJsonFile, logProgress, validateRequiredArgs } from './utils';

const db = initFirestore();

async function main() {
  try {
    validateRequiredArgs(process.argv, 1, 'npx tsx Scripts/diffUnmatchedPlayers.ts <datasetPath>');
    const datasetPath = process.argv[2];

    logProgress('Starting unmatched players analysis...', 'info');

    const matchLogs = await readJsonFile<Array<{ Player: string }>>(datasetPath);
    const namesFromMatchLogs = new Set<string>(matchLogs.map((entry) => cleanName(entry.Player)));

    const playersSnapshot = await db.collection('players').get();
    const firestoreNames = new Set<string>();

    for (const doc of playersSnapshot.docs) {
      const originalName = doc.data().name;
      const cleanedName = cleanName(originalName);
      firestoreNames.add(cleanedName);

      // Update Firestore if name needs cleaning
      if (originalName !== cleanedName) {
        await db.collection('players').doc(doc.id).update({ name: cleanedName });
        logProgress(`Updated name for doc ${doc.id}: '${originalName}' -> '${cleanedName}'`, 'info');
      }
    }

    const unmatched: string[] = [];
    namesFromMatchLogs.forEach((name) => {
      if (!firestoreNames.has(name)) {
        unmatched.push(name);
      }
    });

    logProgress(`Total unmatched: ${unmatched.length}`, 'warning');
    unmatched.forEach((name) => console.log(`⚠️ ${name}`));

    console.log('\n📌 First 5 from match logs:');
    console.log(Array.from(namesFromMatchLogs).slice(0, 5));

    console.log('\n📌 First 5 from Firestore:');
    console.log(Array.from(firestoreNames).slice(0, 5));
  } catch (err) {
    logProgress(`Error in unmatched players analysis: ${(err as Error).message}`, 'error');
    process.exit(1);
  }
}

main();
