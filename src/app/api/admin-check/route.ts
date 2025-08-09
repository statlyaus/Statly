// src/app/api/admin-check/route.ts
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';

function present(v: unknown) {
  return typeof v === 'string' ? v.length > 0 : v != null;
}

export async function GET() {
  const env = {
    FIREBASE_PROJECT_ID: present(process.env.FIREBASE_PROJECT_ID),
    FIREBASE_CLIENT_EMAIL: present(process.env.FIREBASE_CLIENT_EMAIL),
    FIREBASE_PRIVATE_KEY: present(process.env.FIREBASE_PRIVATE_KEY),
  };

  try {
    const { adminDb } = await import('@/lib/firebaseAdmin'); // uses your env-based init
    const snap = await adminDb.collection('__healthcheck').limit(1).get();
    const admin = (await import('firebase-admin')).default;
    const projectId =
      (admin.apps[0]?.options as { projectId?: string })?.projectId ?? null;

    return NextResponse.json({
      ok: true,
      env,
      projectId,
      firestoreOk: true,
      docsSeen: snap.size,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        env,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}