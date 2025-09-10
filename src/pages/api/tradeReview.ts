import { db } from '@/lib/firebaseAdmin';
import { TradeReviewEngine } from '@/lib/tradeReviewEngine';
import type { TradeStatus } from '@/lib/tradeReviewEngine';
import type { Player } from '@/types/players';

import type { NextApiRequest, NextApiResponse } from 'next';

// In-memory variables removed; all state is now per-trade and loaded from Firestore
// Use tradeId from query or body, default to 'current' for backward compatibility
function getTradeId(req: NextApiRequest): string {
  return (req.query.tradeId as string) || (req.body && req.body.tradeId) || 'current';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=30');
  const tradeId = getTradeId(req);
  // Use per-trade in-memory store (not persistent across server restarts, but avoids cross-trade state)
  // For true multi-user, multi-instance, always load from Firestore
  let localTradeEngine: TradeReviewEngine | null = null;
  let localTeamPlayers: Player[] = [];
  let localNotifications: string[] = [];

  if (req.method === 'POST') {
    const { action, vetoThreshold, reviewWindowMs, players, overrideStatus, tradeName } = req.body;
    // Always load from Firestore for the given tradeId
    const doc = await db.collection('tradeReviews').doc(tradeId).get();
    const data = doc.exists && doc.data() ? doc.data() : {};
    localTradeEngine = new TradeReviewEngine(
      {
        vetoThreshold: vetoThreshold ?? (data && data.vetoThreshold) ?? 3,
        reviewWindowMs: reviewWindowMs ?? (data && data.reviewWindowMs) ?? 24 * 60 * 60 * 1000,
        validateRoster: (teamPlayers: Player[]) => teamPlayers.length <= 30,
      },
      (action, state) => {
        localNotifications.push(`Action: ${action}, Status: ${state.status}`);
      }
    );
    localTeamPlayers = players ?? (data && data.teamPlayers) ?? [];
    localNotifications = (data && data.notifications) ?? [];
    // Use tradeName from request, fallback to stored name, fallback to empty string
    const name = tradeName ?? (data && data.tradeName) ?? '';
    // Restore state and audit log if present
    if (data && data.state) localTradeEngine['state'] = data.state;
    if (data && data.auditLog) localTradeEngine['auditLog'] = data.auditLog;

    switch (action) {
      case 'accept':
        localTradeEngine.acceptTrade();
        break;
      case 'veto':
        localTradeEngine.vetoTrade();
        break;
      case 'process':
        localTradeEngine.processTrade(localTeamPlayers);
        break;
      case 'adminOverride':
        if (overrideStatus) {
          localTradeEngine.adminOverride(overrideStatus as TradeStatus);
        }
        break;
      case 'archive':
        await db
          .collection('tradeReviews')
          .doc(tradeId)
          .set(
            {
              ...(data || {}),
              archived: true,
            },
            { merge: true }
          );
        res.status(200).json({ archived: true });
        return;
      case 'reset':
        await db.collection('tradeReviews').doc(tradeId).delete();
        res.status(200).json({ state: null, auditLog: [], notifications: [] });
        return;
      default:
        break;
    }
    // Build trade summary for preview
    const summary = {
      tradeId,
      tradeName: name,
      status: localTradeEngine.getState().status,
      teamCount: localTeamPlayers.length,
      playerNames: Array.isArray(localTeamPlayers)
        ? localTeamPlayers.map((p) => p.name).slice(0, 5)
        : [],
      lastUpdated: Date.now(),
    };
    // Persist to Firestore
    await db.collection('tradeReviews').doc(tradeId).set({
      state: localTradeEngine.getState(),
      auditLog: localTradeEngine.getAuditLog(),
      notifications: localNotifications,
      teamPlayers: localTeamPlayers,
      vetoThreshold,
      reviewWindowMs,
      tradeName: name,
      summary,
    });
    // Persist to Firestore
    const state = localTradeEngine.getState();
    const auditLog = localTradeEngine.getAuditLog();
    await db.collection('tradeReviews').doc(tradeId).set({
      state,
      auditLog,
      notifications: localNotifications,
      teamPlayers: localTeamPlayers,
      vetoThreshold,
      reviewWindowMs,
      tradeName: name,
      summary,
    });
    res.status(200).json({
      state,
      auditLog,
      notifications: localNotifications,
    });
  } else if (req.method === 'GET') {
    const doc = await db.collection('tradeReviews').doc(tradeId).get();
    const data = doc.exists && doc.data() ? doc.data() : {};
    res.status(200).json({
      state: (data && data.state) ?? null,
      auditLog: (data && data.auditLog) ?? [],
      notifications: (data && data.notifications) ?? [],
    });
  } else {
    res.status(405).end();
  }
}
