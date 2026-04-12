#!/usr/bin/env tsx
/**
 * Reports distribution of `tradeCount` on draft club documents (proxy for `tradeRefs` size).
 * Run after each import or in CI with credentials: `npm run report:draft-club-scale`
 *
 * Optional: `--strict` exits 1 if any club >= DRAFT_CLUB_TRADE_REFS_CRITICAL_THRESHOLD.
 */
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import '../src/lib/loadEnv';
import { DRAFT_TRADE_COLLECTIONS } from '../src/lib/draftTrades/contracts';
import {
  DRAFT_CLUB_TRADE_REFS_CRITICAL_THRESHOLD,
  DRAFT_CLUB_TRADE_REFS_WARN_THRESHOLD,
} from '../src/lib/draftTrades/scalePolicy';

function initFirestore() {
  if (!getApps().length) {
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    if (b64) {
      const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as {
        project_id?: string;
        projectId?: string;
        client_email?: string;
        clientEmail?: string;
        private_key?: string;
        privateKey?: string;
      };
      initializeApp({
        credential: cert({
          projectId: parsed.project_id ?? parsed.projectId,
          clientEmail: parsed.client_email ?? parsed.clientEmail,
          privateKey: String(parsed.private_key ?? parsed.privateKey ?? '').replace(/\\n/g, '\n'),
        }),
        projectId:
          parsed.project_id ??
          parsed.projectId ??
          process.env.FIREBASE_PROJECT_ID ??
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
    } else {
      initializeApp({
        credential: applicationDefault(),
        projectId:
          process.env.GOOGLE_CLOUD_PROJECT ??
          process.env.GCLOUD_PROJECT ??
          process.env.FIREBASE_PROJECT_ID ??
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
    }
  }
  return getFirestore();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? sorted[sorted.length - 1]!;
}

async function resolveClubsCollection(db: FirebaseFirestore.Firestore): Promise<string> {
  const pointerSnap = await db.collection(DRAFT_TRADE_COLLECTIONS.meta).doc('currentVersion').get();
  if (pointerSnap.exists) {
    const data = pointerSnap.data() as Record<string, unknown>;
    const collections = data.collections as { clubs?: string } | undefined;
    if (collections && typeof collections.clubs === 'string') {
      return collections.clubs;
    }
  }
  return DRAFT_TRADE_COLLECTIONS.clubs;
}

async function main() {
  const strict = process.argv.includes('--strict');
  const db = initFirestore();
  const clubsPath = await resolveClubsCollection(db);
  const snap = await db.collection(clubsPath).get();

  type Row = { slug: string; name: string; tradeCount: number };
  const rows: Row[] = snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const tradeCount =
      typeof data.tradeCount === 'number' && Number.isFinite(data.tradeCount) ? data.tradeCount : 0;
    const name = typeof data.clubName === 'string' ? data.clubName : doc.id;
    return { slug: doc.id, name, tradeCount };
  });

  const counts = rows.map((r) => r.tradeCount).sort((a, b) => a - b);
  const max = counts.length ? counts[counts.length - 1]! : 0;
  const min = counts.length ? counts[0]! : 0;
  const sum = counts.reduce((a, b) => a + b, 0);
  const mean = counts.length ? sum / counts.length : 0;
  const p95 = percentile(counts, 95);

  console.log(`Collection: ${clubsPath}`);
  console.log(`Clubs: ${rows.length}`);
  console.log(`tradeCount min: ${min}, max: ${max}, mean: ${mean.toFixed(1)}, p95: ${p95}`);
  console.log(
    `Warn threshold: ${DRAFT_CLUB_TRADE_REFS_WARN_THRESHOLD}, critical: ${DRAFT_CLUB_TRADE_REFS_CRITICAL_THRESHOLD}`
  );

  const top = [...rows].sort((a, b) => b.tradeCount - a.tradeCount).slice(0, 12);
  console.log('\nTop clubs by tradeCount (proxy for tradeRefs docs):');
  console.table(top.map((r) => ({ slug: r.slug, name: r.name, tradeCount: r.tradeCount })));

  if (max >= DRAFT_CLUB_TRADE_REFS_CRITICAL_THRESHOLD) {
    console.error(
      `\nCRITICAL: max tradeCount ${max} >= ${DRAFT_CLUB_TRADE_REFS_CRITICAL_THRESHOLD}`
    );
    if (strict) process.exitCode = 1;
  } else if (max >= DRAFT_CLUB_TRADE_REFS_WARN_THRESHOLD) {
    console.warn(`\nWARN: max tradeCount ${max} >= ${DRAFT_CLUB_TRADE_REFS_WARN_THRESHOLD}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
