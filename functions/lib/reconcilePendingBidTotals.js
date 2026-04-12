'use strict';
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v });
      }
    : function (o, v) {
        o['default'] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== 'default') __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, '__esModule', { value: true });
exports.reconcilePendingBidTotals = void 0;
const firestore_1 = require('firebase-admin/firestore');
const firestore_2 = require('firebase-admin/firestore');
const functions = __importStar(require('firebase-functions'));
// HTTP-triggered reconciliation: recompute pendingBidTotal for all users in a league
exports.reconcilePendingBidTotals = functions.https.onRequest(async (req, res) => {
  try {
    const leagueId = req.query.leagueId;
    if (!leagueId) {
      res.status(400).json({ error: 'Missing leagueId query param' });
      return;
    }
    const db = (0, firestore_1.getFirestore)();
    const waiversSnap = await db
      .collection(`leagues/${leagueId}/waivers`)
      .where('status', '==', 'PENDING')
      .get();
    const totals = {};
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
    const updates = [
      ...Object.entries(totals).map(([userId, total]) => ({ userId, total })),
      ...missingUserIds.map((userId) => ({ userId, total: 0 })),
    ];
    const chunkSize = 500;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      const batch = db.batch();
      const updatedAt = firestore_2.FieldValue.serverTimestamp();
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
//# sourceMappingURL=reconcilePendingBidTotals.js.map
