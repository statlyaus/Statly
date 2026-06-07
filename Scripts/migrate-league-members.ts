/*
  Migration: copy legacy collection `league_members` to canonical `leagueMembers`
  and backfill embedded `leagues/{leagueId}/members/{userId}` docs.
  - Safe to run multiple times (idempotent by (leagueId,userId))
  - Batches writes; pauses between batches to avoid rate limits
  Usage: npx tsx Scripts/migrate-league-members.ts
*/
import { adminDb } from '../src/lib/firebaseAdmin';
import { queueLeagueMembershipSet } from '../src/lib/leagueMembership';
import type { Query, QueryDocumentSnapshot, Timestamp } from 'firebase-admin/firestore';

type LegacyMember = {
  leagueId: string;
  userId: string;
  teamName?: string;
  role?: string;
  isActive?: boolean;
  joinedAt?: Timestamp | Date;
  leftAt?: Timestamp | Date;
};

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function migrateBatch(
  sourceCollection: 'league_members' | 'leagueMembers',
  cursor?: QueryDocumentSnapshot
) {
  let q: Query = adminDb.collection(sourceCollection).orderBy('__name__').limit(500);
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
    queueLeagueMembershipSet(
      batch,
      {
        leagueId: data.leagueId,
        userId: data.userId,
        teamName: data.teamName ?? 'Team',
        role: data.role ?? 'member',
        isActive: data.isActive ?? true,
        joinedAt:
          data.joinedAt instanceof Date ? data.joinedAt : (data.joinedAt?.toDate?.() ?? new Date()),
        ...(data.leftAt && {
          leftAt: data.leftAt instanceof Date ? data.leftAt : data.leftAt.toDate(),
        }),
        migratedFrom: sourceCollection,
        migratedAt: new Date(),
      },
      sourceCollection === 'leagueMembers' ? { topLevelMemberId: doc.id } : undefined
    );
    migrated += 1;
  }
  await batch.commit();
  return { next: snap.docs[snap.docs.length - 1], migrated } as const;
}

async function main() {
  let total = 0;
  for (const sourceCollection of ['league_members', 'leagueMembers'] as const) {
    let cursor: QueryDocumentSnapshot | undefined = undefined;
    for (let i = 0; i < 100; i++) {
      const { next, migrated } = await migrateBatch(sourceCollection, cursor);
      total += migrated;
      console.log(`Migrated ${migrated} members from ${sourceCollection} (total ${total})`);
      if (!next) break;
      cursor = next;
      await sleep(250); // backoff
    }
  }
  console.log('Done. Total migrated:', total);
}

main().catch((err) => {
  console.error('migration failed', err);
  process.exitCode = 1;
});
