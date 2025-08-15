import { TradeReviewEngine } from '@/lib/tradeReviewEngine';
import type { TradeStatus } from '@/lib/tradeReviewEngine';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Player } from '@/types/players';

// Example in-memory store (replace with DB integration)
let tradeEngine: TradeReviewEngine | null = null;
let teamPlayers: Player[] = [];
let notifications: string[] = [];

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const { action, vetoThreshold, reviewWindowMs, players, overrideStatus } = req.body;
    if (!tradeEngine) {
      tradeEngine = new TradeReviewEngine({
        vetoThreshold: vetoThreshold ?? 3,
        reviewWindowMs: reviewWindowMs ?? 24 * 60 * 60 * 1000,
        validateRoster: (teamPlayers: Player[]) => teamPlayers.length <= 30,
      }, (action, state) => {
        notifications.push(`Action: ${action}, Status: ${state.status}`);
      });
      teamPlayers = players ?? [];
    }
    switch (action) {
      case 'accept':
        tradeEngine.acceptTrade();
        break;
      case 'veto':
        tradeEngine.vetoTrade();
        break;
      case 'process':
        tradeEngine.processTrade(teamPlayers);
        break;
      case 'adminOverride':
        if (overrideStatus) {
          tradeEngine.adminOverride(overrideStatus as TradeStatus);
        }
        break;
      case 'reset':
        tradeEngine = null;
        teamPlayers = [];
        notifications = [];
        break;
      default:
        break;
    }
    return res.status(200).json({ state: tradeEngine?.getState(), auditLog: tradeEngine?.getAuditLog(), notifications });
  } else if (req.method === 'GET') {
    return res.status(200).json({ state: tradeEngine?.getState(), auditLog: tradeEngine?.getAuditLog(), notifications });
  } else {
    res.status(405).end();
  }
}
