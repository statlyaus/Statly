#!/usr/bin/env node
import * as admin from 'firebase-admin';

type DocData = FirebaseFirestore.DocumentData;

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

function isMockDoc(data: DocData): boolean {
  const playerUid = typeof data.player_uid === 'string' ? data.player_uid : '';
  const playerName = typeof data.player_name === 'string' ? data.player_name : '';
  const playerId = typeof data.player_id === 'string' ? data.player_id : '';
  const matchId = typeof data.match_id === 'string' ? data.match_id : '';
  const matchUid = typeof data.match_uid === 'string' ? data.match_uid : '';
  const rawName =
    data.raw_row && typeof data.raw_row === 'object' && typeof data.raw_row.player_name === 'string'
      ? data.raw_row.player_name
      : '';
  const dataSource = typeof data.data_source === 'string' ? data.data_source : '';

  const looksMock =
    playerUid.startsWith('ply_player_') ||
    playerId.startsWith('player_') ||
    matchId.startsWith('match_') ||
    matchUid.startsWith('match_') ||
    /^Player \d+/.test(playerName) ||
    /^Player \d+/.test(rawName);

  const legacySource = dataSource === 'footywire_fitzroy' || dataSource === 'mock';

  return looksMock || legacySource;
}

async function run(): Promise<void> {
  const db = initAdmin();
  const seasons = parseSeasons(process.env.SEASONS);
  const dryRun = process.env.DRY_RUN === 'true';

  console.log(
    `🧹 Cleaning mock player_match_stats for seasons: ${seasons.join(', ')} (dryRun=${dryRun})`
  );

  for (const season of seasons) {
    const snaps = await Promise.all([
      db.collection('player_match_stats').where('season', '==', season).get(),
      db.collection('player_match_stats').where('season', '==', String(season)).get(),
    ]);
    const seen = new Set<string>();
    const docs = snaps
      .flatMap((s) => s.docs)
      .filter((doc) => {
        if (seen.has(doc.id)) return false;
        seen.add(doc.id);
        return true;
      });
    const writer = db.bulkWriter();
    let candidates = 0;
    let deleted = 0;

    for (const doc of docs) {
      if (!isMockDoc(doc.data())) continue;
      candidates++;
      if (!dryRun) {
        writer.delete(doc.ref);
        deleted++;
      }
    }

    await writer.close();
    console.log(`Season ${season}: ${candidates} mock docs ${dryRun ? 'found' : 'deleted'}`);
  }

  console.log('✅ Mock cleanup complete.');
}

run().catch((error) => {
  console.error('❌ Mock cleanup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
