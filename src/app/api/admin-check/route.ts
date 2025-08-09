// src/app/api/admin-check/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function present(v: unknown) {
  return typeof v === 'string' ? v.length > 0 : v != null;
}

export async function GET() {
  const vars = {
    FIREBASE_PROJECT_ID: present(process.env.FIREBASE_PROJECT_ID),
    FIREBASE_CLIENT_EMAIL: present(process.env.FIREBASE_CLIENT_EMAIL),
    FIREBASE_PRIVATE_KEY: present(process.env.FIREBASE_PRIVATE_KEY),
    // If you chose the ADMIN_ names, include them too:
    FIREBASE_ADMIN_PROJECT_ID: present(process.env.FIREBASE_ADMIN_PROJECT_ID),
    FIREBASE_ADMIN_CLIENT_EMAIL: present(process.env.FIREBASE_ADMIN_CLIENT_EMAIL),
    FIREBASE_ADMIN_PRIVATE_KEY: present(process.env.FIREBASE_ADMIN_PRIVATE_KEY),
  };

  try {
    // Import here so we test runtime env loading at the same time
    const { adminDb } = await import('@/lib/firebaseAdmin');
    // Force a trivial read to confirm Firestore works
    const snap = await adminDb.collection('__healthcheck').limit(1).get();

    // Try to read resolved projectId from the initialized app
    const admin = (await import('firebase-admin')).default;
    const app = admin.apps[0];
    const projectId =
      (app?.options as { projectId?: string })?.projectId ??
      process.env.FIREBASE_PROJECT_ID ??
      process.env.FIREBASE_ADMIN_PROJECT_ID ??
      null;

    return NextResponse.json({
      ok: true,
      env: vars,
      projectId,
      firestoreOk: true,
      docsSeen: snap.size,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        env: vars,
        error: msg,
      },
      { status: 500 }
    );
  }
}