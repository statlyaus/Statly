#!/usr/bin/env tsx

// Firestore database connectivity check (Firestore-only setup)
import '../src/lib/loadEnv';
import { adminDb } from '../src/lib/firebaseAdmin';

async function countCollection(path: string): Promise<number> {
  try {
    const aggSnap: any = await (adminDb.collection(path) as any).count().get();
    return (aggSnap.data().count as number) ?? 0;
  } catch {
    const snap = await adminDb.collection(path).get();
    return snap.size;
  }
}

async function countCollectionGroup(id: string): Promise<number> {
  try {
    const aggSnap: any = await (adminDb.collectionGroup(id) as any).count().get();
    return (aggSnap.data().count as number) ?? 0;
  } catch {
    const snap = await adminDb.collectionGroup(id).limit(1000).get();
    return snap.size;
  }
}

async function checkDatabase() {
  try {
    console.log('🔍 Checking Firestore database connectivity...');

    // Players
    const playerCount = await countCollection('players');
    console.log(`✅ Players in Firestore: ${playerCount}`);

    const playerSampleSnap = await adminDb
      .collection('players')
      .orderBy('name')
      .limit(3)
      .get();
    console.log('\n📋 Sample players:');
    if (playerSampleSnap.empty) {
      console.log('  (no players found)');
    } else {
      playerSampleSnap.docs.forEach((doc) => {
        const d = doc.data() as any;
        console.log(`  - ${d.name ?? doc.id} (${d.club ?? d.team ?? 'N/A'}) - ${d.position ?? 'N/A'}`);
      });
    }

    // Leagues (top-level collection)
    const leagueCount = await countCollection('leagues');
    console.log(`\n📊 Leagues: ${leagueCount}`);

    // Drafts (subcollection under leagues/*/drafts)
    const draftsCount = await countCollectionGroup('drafts');
    console.log(`📊 Drafts (collectionGroup): ${draftsCount}`);

    const draftSampleSnap = await adminDb.collectionGroup('drafts').limit(3).get();
    if (!draftSampleSnap.empty) {
      console.log('\n📋 Sample drafts:');
      draftSampleSnap.docs.forEach((doc) => {
        const path = doc.ref.path; // e.g., leagues/{leagueId}/drafts/{draftId}
        const parts = path.split('/');
        const leagueIdx = parts.indexOf('leagues');
        const leagueId = leagueIdx >= 0 && parts.length > leagueIdx + 1 ? parts[leagueIdx + 1] : 'unknown-league';
        console.log(`  - ${doc.id} (league: ${leagueId})`);
      });
    }

    console.log('\n✅ Firestore data model reachable and functional!');
  } catch (error) {
    console.error('❌ Firestore database check failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkDatabase();
}
