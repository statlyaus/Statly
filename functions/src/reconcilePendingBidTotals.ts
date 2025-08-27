import * as functions from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';

// HTTP-triggered reconciliation: recompute pendingBidTotal for all users in a league
export const reconcilePendingBidTotals = functions.https.onRequest(async (req, res) => {
  try {
    const leagueId = req.query.leagueId as string;
    if (!leagueId) {
      res.status(400).json({ error: 'Missing leagueId query param' });
      return;
    }
    const db = getFirestore();
    const waiversSnap = await db.collection(`leagues/${leagueId}/waivers`).where('status', '==', 'PENDING').get();
    const totals: Record<string, number> = {};
    waiversSnap.forEach(doc => {
      const d = doc.data();
      const bid = typeof d.bidAmount === 'number' ? d.bidAmount : 0;
      if (bid > 0 && d.userId) {
        totals[d.userId] = (totals[d.userId] || 0) + bid;
      }
    });

    const batch = db.batch();
    Object.entries(totals).forEach(([userId, total]) => {
      const ref = db.doc(`leagues/${leagueId}/waiverPriorities/${userId}`);
      batch.set(ref, { pendingBidTotal: total, updatedAt: new Date() }, { merge: true });
    });
    await batch.commit();
    res.json({ ok: true, leagueId, userCount: Object.keys(totals).length });
  } catch (e) {
    console.error('[reconcilePendingBidTotals] error', e);
    res.status(500).json({ error: 'Internal error' });
  }
});
