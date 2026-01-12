/*
  Migration: copy legacy collections to canonical subcollection
  - Sources: `league_members`, `leagueMembers`
  - Target: `leagues/{leagueId}/members/{userId}`
  - Safe to run multiple times (idempotent by (leagueId,userId))
  - Batches writes; pauses between batches to avoid rate limits
  Usage: npx tsx Scripts/migrate-league-members.ts
*/
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { getServiceAccountFromEnv } from '../src/lib/serviceAccount';

import type { Query, QueryDocumentSnapshot, Timestamp } from 'firebase-admin/firestore';

type LegacyMember = {
  leagueId: string;
  userId: string;
  teamName?: string;
  role?: string;
  isActive?: boolean;
  joinedAt?: Timestamp | Date;
};

function getProjectId(): string | undefined {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    undefined
  );
}

function ensureAdminDb() {
  if (getApps().length === 0) {
    try {
      const sa = getServiceAccountFromEnv();
      const privateKey = (sa.privateKey ?? '').replace(/\\n/g, '\n');
      initializeApp({
        credential: cert({
          projectId: sa.projectId,
          clientEmail: sa.clientEmail,
          privateKey,
        }),
        projectId: sa.projectId,
      });
    } catch {
      initializeApp({
        credential: applicationDefault(),
        projectId: getProjectId(),
      });
    }
  }
  return getFirestore();
}

const adminDb = ensureAdminDb();

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function migrateBatch(collectionName: string, cursor?: QueryDocumentSnapshot) {
  let q: Query = adminDb.collection(collectionName).orderBy('__name__').limit(500);
  if (cursor) q = q.startAfter(cursor);
  const snap = await q.get();
  if (snap.empty) return { next: null, migrated: 0 } as const;

  const batch = adminDb.batch();
  let migrated = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as LegacyMember;
    if (!data.leagueId || !data.userId) {
      console.warn(`Skipping document ${doc.id}: missing leagueId or userId`, {
        leagueId: data.leagueId,
        userId: data.userId,
      });
      continue;
    }
    const target = adminDb
      .collection('leagues')
      .doc(data.leagueId)
      .collection('members')
      .doc(data.userId);
    batch.set(
      target,
      {
        leagueId: data.leagueId,
        userId: data.userId,
        teamName: data.teamName ?? null,
        role: data.role ?? 'member',
        isActive: data.isActive ?? true,
        joinedAt:
          data.joinedAt instanceof Date ? data.joinedAt : (data.joinedAt?.toDate?.() ?? new Date()),
        migratedFrom: collectionName,
        migratedAt: new Date(),
      },
      { merge: true }
    );
    migrated += 1;
  }
  await batch.commit();
  return { next: snap.docs[snap.docs.length - 1], migrated } as const;
}

async function main() {
  let cursor: QueryDocumentSnapshot | undefined = undefined;
  let total = 0;
  for (let i = 0; i < 100; i++) {
    const { next, migrated } = await migrateBatch('league_members', cursor);
    total += migrated;
    console.log(`Migrated ${migrated} members from league_members (total ${total})`);
    if (!next) break;
    cursor = next;
    await sleep(250); // backoff
  }
  cursor = undefined;
  for (let i = 0; i < 100; i++) {
    const { next, migrated } = await migrateBatch('leagueMembers', cursor);
    total += migrated;
    console.log(`Migrated ${migrated} members from leagueMembers (total ${total})`);
    if (!next) break;
    cursor = next;
    await sleep(250); // backoff
  }
  console.log('Done. Total migrated:', total);
}

main().catch((err) => {
  console.error('migration failed', err);
  process.exitCode = 1;
});
