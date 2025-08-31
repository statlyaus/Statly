import type { NextApiRequest, NextApiResponse } from 'next';
import { adminDb } from '@/lib/firebaseAdmin';
import { getLeagueMeta } from '@/lib/data/leagueApi';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { leagueId } = req.query;

  if (typeof leagueId !== 'string') {
    res.status(400).json({ error: 'leagueId is required' });
    return;
  }

  try {
    const meta = await getLeagueMeta(adminDb, leagueId);
    res.status(200).json({ joined: meta.memberCount, total: meta.maxTeams });
  } catch (err) {
    console.error('Failed to load join status', err);
    res.status(500).json({ error: 'Failed to load join status' });
  }
}
