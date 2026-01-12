/**
 * Backfill leagueMembers collection from leagues/{leagueId}/members subcollections.
 */

import '../src/lib/loadEnv';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!serviceAccountBase64) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 environment variable is required');
  }
  const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
  const serviceAccount = JSON.parse(serviceAccountJson);

  initializeApp({
    credential: cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: String(serviceAccount.private_key).replace(/\\n/g, '\n'),
    }),
    projectId: serviceAccount.project_id,
  });
}

const adminDb = getFirestore();

type MemberDoc = {
  leagueId?: string;
  userId?: string;
  role?: string;
  teamName?: string;
  joinedAt?: unknown;
  leftAt?: unknown;
  isActive?: boolean;
};

async function backfillLeagueMembers(): Promise<void> {
  const leaguesSnapshot = await adminDb.collection('leagues').get();
  let totalMembers = 0;
  let batch = adminDb.batch();
  let batchCount = 0;

  for (const leagueDoc of leaguesSnapshot.docs) {
    const leagueId = leagueDoc.id;
    const membersSnapshot = await leagueDoc.ref.collection('members').get();

    for (const memberDoc of membersSnapshot.docs) {
      const data = memberDoc.data() as MemberDoc;
      const userId = data.userId || memberDoc.id;
      if (!userId) continue;

      const payload = {
        leagueId,
        userId,
        role: data.role || 'member',
        teamName: data.teamName || '',
        joinedAt: data.joinedAt ?? null,
        leftAt: data.leftAt ?? null,
        isActive: data.isActive !== false,
        updatedAt: FieldValue.serverTimestamp(),
      };

      const ref = adminDb.collection('leagueMembers').doc(`${leagueId}_${userId}`);
      batch.set(ref, payload, { merge: true });
      batchCount += 1;
      totalMembers += 1;

      if (batchCount >= 450) {
        await batch.commit();
        batch = adminDb.batch();
        batchCount = 0;
      }
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`Backfill complete: ${totalMembers} member records upserted.`);
}

backfillLeagueMembers().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
