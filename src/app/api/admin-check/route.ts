import { NextResponse } from 'next/server';
export const runtime = 'nodejs';

export async function GET() {
  // 1) Check presence of both styles WITHOUT leaking secrets
  const hasBase64 = typeof process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 === 'string'
    && process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64.length > 100;

  const hasTriplet = Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );

  // 2) Try to decode base64 and extract project_id (without returning the secret)
  let decodedProjectId: string | null = null;
  let decodedClientEmail: string | null = null;
  let decodeError: string | null = null;

  if (hasBase64) {
    try {
      const json = Buffer
        .from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 as string, 'base64')
        .toString('utf-8');
      const parsed = JSON.parse(json) as {
        project_id?: string; client_email?: string; private_key?: string;
      };
      decodedProjectId = parsed.project_id ?? null;
      decodedClientEmail = parsed.client_email ?? null;
    } catch (e) {
      decodeError = e instanceof Error ? e.message : String(e);
    }
  }

  try {
    const { adminDb } = await import('@/lib/firebaseAdmin');
    const admin = (await import('firebase-admin')).default;
    const app = admin.apps[0];
    const appProjectId =
      (app?.options as { projectId?: string })?.projectId ?? null;

    // force a tiny read
    const snap = await adminDb.collection('__healthcheck').limit(1).get();

    return NextResponse.json({
      ok: true,
      env: {
        hasBase64,
        hasTriplet,
        FIREBASE_PROJECT_ID: Boolean(process.env.FIREBASE_PROJECT_ID),
        FIREBASE_CLIENT_EMAIL: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
        FIREBASE_PRIVATE_KEY: Boolean(process.env.FIREBASE_PRIVATE_KEY),
      },
      decoded: {
        decodedProjectId,
        decodedClientEmail,
        decodeError,
      },
      initializedProjectId: appProjectId,
      firestoreOk: true,
      docsSeen: snap.size,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        env: {
          hasBase64,
          hasTriplet,
          FIREBASE_PROJECT_ID: Boolean(process.env.FIREBASE_PROJECT_ID),
          FIREBASE_CLIENT_EMAIL: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
          FIREBASE_PRIVATE_KEY: Boolean(process.env.FIREBASE_PRIVATE_KEY),
        },
        decoded: {
          decodedProjectId,
          decodedClientEmail,
          decodeError,
        },
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}