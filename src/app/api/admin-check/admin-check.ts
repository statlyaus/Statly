import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const env = {
    FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
  };

  try {
    const { adminDb } = await import('@/lib/firebaseAdmin');
    const snap = await adminDb.collection('__healthcheck').limit(1).get();
    res.status(200).json({ ok: true, env, firestoreOk: true, docsSeen: snap.size });
  } catch (e: any) {
    res.status(500).json({ ok: false, env, error: e?.message || String(e) });
  }
}