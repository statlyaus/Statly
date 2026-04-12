#!/usr/bin/env node
import * as admin from 'firebase-admin';

type MatchDoc = { id: string };

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
  const seasons = (raw ?? '2023,2024,2025')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  return seasons.length > 0 ? seasons : [new Date().getFullYear()];
}

async function getSeasonCount(db: admin.firestore.Firestore, season: number): Promise<number> {
  const query = db.collection('player_match_stats').where('season', '==', season);
  const countFn = (query as any).count;
  if (typeof countFn === 'function') {
    const snap = await (query as any).count().get();
    return Number(snap.data().count || 0);
  }

  const snap = await query.select('season').get();
  return snap.size;
}

function extractMatchId(data: FirebaseFirestore.DocumentData): string | null {
  const candidate =
    data.match_id || data.matchUid || data.matchId || data.match_uid || data.match_uid;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

async function run(): Promise<void> {
  const db = initAdmin();
  const seasons = parseSeasons(process.env.SEASONS);

  console.log(`🔎 Validating Fryzigg backfill for seasons: ${seasons.join(', ')}`);

  for (const season of seasons) {
    console.log(`\nSeason ${season}`);

    const matchSnap = await db.collection('matches').where('season', '==', season).get();
    const matchIds = new Set(matchSnap.docs.map((d) => d.id));
    console.log(`Matches found: ${matchIds.size}`);

    const totalStats = await getSeasonCount(db, season);
    console.log(`player_match_stats count: ${totalStats}`);

    // Spot check a few stats docs
    const sampleSnap = await db
      .collection('player_match_stats')
      .where('season', '==', season)
      .limit(3)
      .get();

    const samples = sampleSnap.docs.map((d) => ({
      id: d.id,
      match_id: extractMatchId(d.data()),
      player_uid: d.data().player_uid,
    }));
    console.log('Sample stats docs:', samples);

    // Missing joins: stats docs whose match_id doesn't exist in matches
    let missingJoins = 0;
    let checked = 0;
    const statsSnap = await db
      .collection('player_match_stats')
      .where('season', '==', season)
      .select('match_id', 'matchUid', 'matchId', 'match_uid')
      .get();

    for (const doc of statsSnap.docs) {
      const matchId = extractMatchId(doc.data());
      if (matchId && !matchIds.has(matchId)) missingJoins += 1;
      checked += 1;
    }

    console.log(`Missing joins: ${missingJoins} of ${checked}`);
  }
}

run().catch((error) => {
  console.error('❌ Validation failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
