export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export async function GET() {
  try {
    const snap = await adminDb.collection('__healthcheck').limit(1).get();
    return new NextResponse(
      JSON.stringify({ ok: true, size: snap.size }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(
      JSON.stringify({ ok: false, error: msg }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      }
    );
  }
}
