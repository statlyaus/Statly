import { db } from '@/lib/firebase';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }
  // List all trades with summaries from Firestore
  const snapshot = await db.collection('tradeReviews').get();
  const trades = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      tradeId: doc.id,
      summary: {
        ...(data.summary ?? {
          tradeId: doc.id,
          status: data.state?.status ?? 'unknown',
          teamCount: Array.isArray(data.teamPlayers) ? data.teamPlayers.length : 0,
    playerNames: Array.isArray(data.teamPlayers) ? data.teamPlayers.map((p: { name: string }) => p.name).slice(0, 5) : [],
          lastUpdated: data.lastUpdated ?? null,
        }),
        archived: !!data.archived,
      },
    };
  });
  res.status(200).json({ trades });
}
