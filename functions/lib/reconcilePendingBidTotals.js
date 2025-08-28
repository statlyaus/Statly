"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcilePendingBidTotals = void 0;
const functions = __importStar(require("firebase-functions"));
const firestore_1 = require("firebase-admin/firestore");
// HTTP-triggered reconciliation: recompute pendingBidTotal for all users in a league
exports.reconcilePendingBidTotals = functions.https.onRequest(async (req, res) => {
    try {
        const start = Date.now();
        // Method guard
        if (req.method === 'OPTIONS') {
            res.setHeader('Allow', 'POST, OPTIONS');
            res.status(204).end();
            return;
        }
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST, OPTIONS');
            res.status(405).json({ error: 'Method Not Allowed' });
            return;
        }
        const rawLeagueId = req.query.leagueId;
        if (!rawLeagueId) {
            res.status(400).json({ error: 'Missing leagueId query param' });
            return;
        }
        if (Array.isArray(rawLeagueId)) {
            res.status(400).json({ error: 'Invalid leagueId: multiple values' });
            return;
        }
        const leagueId = String(rawLeagueId).trim();
        const byteLen = Buffer.byteLength(leagueId, 'utf8');
        const idOk = /^[A-Za-z0-9_-]{1,256}$/.test(leagueId) && byteLen <= 256;
        if (!idOk) {
            res.status(400).json({ error: 'Invalid leagueId' });
            return;
        }
        // Simple admin auth via Bearer token custom claim (emulated: shared secret header fallback)
        const authHeader = req.headers['authorization'] || req.headers['Authorization'];
        const secretHeader = req.headers['x-internal-secret'];
        const allowedSecret = process.env.INTERNAL_TASK_SECRET;
        const bearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
            ? authHeader.slice('Bearer '.length)
            : undefined;
        const secretOk = Boolean(secretHeader && allowedSecret && secretHeader === allowedSecret);
        const bearerOk = Boolean(bearerToken && allowedSecret && bearerToken === allowedSecret);
        if (!(secretOk || bearerOk)) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const db = (0, firestore_1.getFirestore)();
        const waiversSnap = await db.collection(`leagues/${leagueId}/waivers`).where('status', '==', 'PENDING').get();
        const totals = {};
        waiversSnap.forEach(doc => {
            const d = doc.data();
            const bid = typeof d.bidAmount === 'number' ? d.bidAmount : 0;
            if (bid > 0 && d.userId) {
                totals[d.userId] = (totals[d.userId] || 0) + bid;
            }
        });
        const entries = Object.entries(totals);
        // Identify users with no pending bids -> set to 0
        const prioSnap = await db.collection(`leagues/${leagueId}/waiverPriorities`).select(firestore_1.FieldPath.documentId()).get();
        const allUserIds = prioSnap.docs.map(d => d.id);
        const missingUserIds = allUserIds.filter(uid => !(uid in totals));
        const chunkSize = 500;
        // Safety cap for extremely large leagues
        if (entries.length + missingUserIds.length > 25000) {
            res.status(422).json({ error: 'Too many documents to update in single request' });
            return;
        }
        function isRetriableFirestoreError(err) {
            const code = err && (err.code || err.status || err.errorCode);
            const retriable = ['ABORTED', 'DEADLINE_EXCEEDED', 'UNAVAILABLE', 10, 4, 14];
            return retriable.includes(code);
        }
        async function commitWithRetry(batch, ctx) {
            const maxAttempts = 5;
            let delay = 200;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    await batch.commit();
                    return;
                }
                catch (err) {
                    console.error('[reconcilePendingBidTotals] batch commit failed', { attempt, ctx, err });
                    if (!isRetriableFirestoreError(err)) {
                        throw err;
                    }
                    if (attempt === maxAttempts) throw err;
                    const jitter = Math.floor(Math.random() * 100);
                    await new Promise(r => setTimeout(r, delay + jitter));
                    delay *= 2;
                }
            }
        }
        // Update users with totals
        for (let i = 0; i < entries.length; i += chunkSize) {
            const batch = db.batch();
            const chunk = entries.slice(i, i + chunkSize);
            chunk.forEach(([userId, total]) => {
                const ref = db.doc(`leagues/${leagueId}/waiverPriorities/${userId}`);
                batch.set(ref, { pendingBidTotal: total, updatedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
            });
            await commitWithRetry(batch, { type: 'totals', index: i / chunkSize });
        }
        // Zero out missing users
        for (let i = 0; i < missingUserIds.length; i += chunkSize) {
            const batch = db.batch();
            const chunk = missingUserIds.slice(i, i + chunkSize);
            chunk.forEach((userId) => {
                const ref = db.doc(`leagues/${leagueId}/waiverPriorities/${userId}`);
                batch.set(ref, { pendingBidTotal: 0, updatedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
            });
            await commitWithRetry(batch, { type: 'zeros', index: i / chunkSize });
        }
        const durationMs = Date.now() - start;
        res.json({ ok: true, leagueId, userCount: Object.keys(totals).length, zeroed: missingUserIds.length, durationMs });
    }
    catch (e) {
        console.error('[reconcilePendingBidTotals] error', e);
        res.status(500).json({ error: 'Internal error' });
    }
});
//# sourceMappingURL=reconcilePendingBidTotals.js.map