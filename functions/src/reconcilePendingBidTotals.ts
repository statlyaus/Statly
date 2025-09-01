import * as functions from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

// HTTP-triggered reconciliation: recompute pendingBidTotal for all users in a league
export const reconcilePendingBidTotals = functions.https.onRequest(async (req, res) => {
  try {
    const leagueId = req.query.leagueId as string;
    if (!leagueId) {
      res.status(400).json({ error: 'Missing leagueId query param' });
      return;
    }
    const db = getFirestore();
    const waiversSnap = await db
      .collection(`leagues/${leagueId}/waivers`)
      .where('status', '==', 'PENDING')
      .get();
    const totals: Record<string, number> = {};
    waiversSnap.forEach((doc) => {
      const d = doc.data();
      const bid = typeof d.bidAmount === 'number' ? d.bidAmount : 0;
      if (bid > 0 && d.userId) {
        totals[d.userId] = (totals[d.userId] || 0) + bid;
      }
    });

    // Determine users missing from totals and set them to 0 to keep aggregate consistent
    // ID-only projection
    const prioSnap = await db.collection(`leagues/${leagueId}/waiverPriorities`).select().get();
    const allUserIds = prioSnap.docs.map((d) => d.id);
    const missingUserIds = allUserIds.filter((uid) => !(uid in totals));

    const updates: Array<{ userId: string; total: number }> = [
      ...Object.entries(totals).map(([userId, total]) => ({ userId, total })),
      ...missingUserIds.map((userId) => ({ userId, total: 0 })),
    ];

    const chunkSize = 500;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      const batch = db.batch();
      const updatedAt = FieldValue.serverTimestamp();
      for (const { userId, total } of chunk) {
        const ref = db.doc(`leagues/${leagueId}/waiverPriorities/${userId}`);
        batch.set(ref, { pendingBidTotal: total, updatedAt }, { merge: true });
      }
      await batch.commit();
    }

    res.json({ ok: true, leagueId, userCount: updates.length });
  } catch (e) {
    console.error('[reconcilePendingBidTotals] error', e);
    res.status(500).json({ error: 'Internal error' });
  }
});
