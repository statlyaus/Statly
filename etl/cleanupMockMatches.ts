#!/usr/bin/env node
import * as admin from 'firebase-admin';

function initAdmin(): admin.firestore.Firestore {
  if (admin.apps.length) return admin.firestore();
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
      privateKey: String(serviceAccount.private_key).replace(/\\n/g, '\n'),
    }),
    projectId: serviceAccount.project_id,
  });

  return admin.firestore();
}

function parseSeasons(raw: string | undefined): number[] {
  const seasons = (raw ?? '2025')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  return seasons.length > 0 ? seasons : [new Date().getFullYear()];
}

function isLegacyMockMatch(docId: string, data: FirebaseFirestore.DocumentData): boolean {
  if (!/^match_\d+$/.test(docId)) return false;

  const dataSource = typeof data.data_source === 'string' ? data.data_source : '';
  const hasSeason = typeof data.season === 'number';
  const hasRound = typeof data.round_number === 'number';

  return dataSource === 'mock' || !hasSeason || !hasRound;
}

async function run(): Promise<void> {
  const db = initAdmin();
  const seasons = parseSeasons(process.env.SEASONS);
  const dryRun = process.env.DRY_RUN === 'true';

  console.log(`🧹 Cleaning mock matches for seasons: ${seasons.join(', ')} (dryRun=${dryRun})`);

  for (const season of seasons) {
    const snap = await db.collection('matches').where('season', '==', season).get();
    const writer = db.bulkWriter();
    let candidates = 0;
    let deleted = 0;

    for (const doc of snap.docs) {
      if (!isLegacyMockMatch(doc.id, doc.data())) continue;
      candidates++;
      if (!dryRun) {
        writer.delete(doc.ref);
        deleted++;
      }
    }

    await writer.close();
    console.log(`Season ${season}: ${candidates} mock matches ${dryRun ? 'found' : 'deleted'}`);
  }

  console.log('✅ Mock matches cleanup complete.');
}

run().catch((error) => {
  console.error('❌ Mock matches cleanup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
