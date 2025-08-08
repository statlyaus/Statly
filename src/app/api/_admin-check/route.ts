// src/app/api/_admin-check/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Lazy-load to catch init errors from firebaseAdmin.ts
    const { adminDb } = await import('@/lib/firebaseAdmin');
    const snap = await adminDb.collection('__healthcheck').limit(1).get();
    return NextResponse.json({ ok: true, size: snap.size }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}