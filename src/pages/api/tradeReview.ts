import { TradeReviewEngine } from '@/lib/tradeReviewEngine';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Player } from '@/types/players';

// Example in-memory store (replace with DB integration)
let tradeEngine: TradeReviewEngine | null = null;
let teamPlayers: Player[] = [];

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const { action, vetoThreshold, reviewWindowMs, players } = req.body;
    if (!tradeEngine) {
      tradeEngine = new TradeReviewEngine({
        vetoThreshold: vetoThreshold ?? 3,
        reviewWindowMs: reviewWindowMs ?? 24 * 60 * 60 * 1000,
        validateRoster: (teamPlayers: Player[]) => teamPlayers.length <= 30,
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
      case 'reset':
        tradeEngine = null;
        teamPlayers = [];
        break;
      default:
        break;
    }
    return res.status(200).json({ state: tradeEngine?.getState() });
  }
  if (req.method === 'GET') {
    return res.status(200).json({ state: tradeEngine?.getState() });
  }
  res.status(405).end();
}
