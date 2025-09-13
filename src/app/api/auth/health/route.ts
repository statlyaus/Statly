import { NextResponse } from 'next/server';

import { adminDb as db } from '@/lib/firebaseAdmin';

// Ensure Node runtime (not edge) for firebase-admin
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const ref = db.collection('_health').doc('ping');
    await ref.set({ at: Date.now() }, { merge: true });
    const snap = await ref.get();

    return NextResponse.json({
      ok: true,
      hasData: snap.exists,
      at: snap.get('at') ?? null,
      project: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? null,
      mode: process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 ? 'service_account' : 'adc',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
