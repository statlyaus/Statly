// Clean player data in Firestore: ensure top-level name exists and is normalized
// - Reuses shared Admin SDK init and env autoload
// - Batches updates and keeps created_at immutable (only updates updated_at)

import '../src/lib/loadEnv';
import { adminDb as db } from '../src/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { fileURLToPath } from 'url';
import path from 'path';

// Expanded set of indicator symbols to remove from names
const ARROW_REGEX = /[↗↙↘↖↑↓▲▼⇧⇩]/g;

function normalizeName(name?: unknown): string | null {
  if (!name || typeof name !== 'string') return null;
  return name.replace(ARROW_REGEX, '').replace(/\s+/g, ' ').trim();
}

export async function cleanPlayers(
  options: { verbose?: boolean; dryRun?: boolean; limit?: number } = {}
) {
  const { verbose = false, dryRun = false, limit } = options;

  const baseQuery = db.collection('players');
  const query = typeof limit === 'number' && limit > 0 ? baseQuery.limit(limit) : baseQuery;

  const snapshot = await query.get();
  let updated = 0;
  let examined = 0;

  const batchSizeLimit = 400;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    examined++;
    const data = doc.data() as Record<string, any>;

    const currentName = typeof data.name === 'string' ? data.name : undefined;
    const nameFromLog = data.matchLogs?.[0]?.Player as string | undefined;

    // Choose candidate: prefer current name; else fallback to first match log name
    const candidate = currentName ?? nameFromLog;
    const normalized = normalizeName(candidate);

    const needsNameInsert = !currentName && !!normalized;
    const needsNormalization = !!currentName && !!normalized && normalized !== currentName;

    if (needsNameInsert || needsNormalization) {
      const update: Record<string, any> = {
        name: normalized,
        updated_at: FieldValue.serverTimestamp(),
      };

      if (verbose) {
        console.log(`Will update ${doc.id}: name ${currentName ?? '(missing)'} -> ${normalized}`);
      }

      if (!dryRun) {
        batch.set(doc.ref, update, { merge: true });
        batchCount++;
        updated++;
      }
    }

    if (!dryRun && batchCount >= batchSizeLimit) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (!dryRun && batchCount > 0) {
    await batch.commit();
  }

  if (verbose) {
    console.log(`Examined ${examined} player documents.`);
  }
  console.log(`\n✅ Cleaned ${updated} player documents${dryRun ? ' (dry-run)' : ''}.`);
}

// Run when executed directly
const isDirectRun = (() => {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    return process.argv[1] && path.resolve(process.argv[1]) === thisFile;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  cleanPlayers().catch((err) => {
    console.error('Error cleaning player data:', err);
    process.exit(1);
  });
}
