// src/app/api/admin-check/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // --- env flags the server can actually see ---
  const env = {
    hasBase64: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim()),
    FIREBASE_PROJECT_ID: Boolean(process.env.FIREBASE_PROJECT_ID),
    FIREBASE_CLIENT_EMAIL: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
    FIREBASE_PRIVATE_KEY: Boolean(process.env.FIREBASE_PRIVATE_KEY),
  };

  // --- decode base64 (metadata only; no secrets echoed back) ---
  let decodedProjectId: string | null = null;
  let decodedClientEmail: string | null = null;
  let decodedKeyId: string | null = null;
  let decodeError: string | null = null;

  if (env.hasBase64) {
    try {
      const json = Buffer.from(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 as string,
        'base64'
      ).toString('utf-8');

      const parsed = JSON.parse(json) as {
        project_id?: string;
        client_email?: string;
        private_key_id?: string;
      };

      decodedProjectId = parsed.project_id ?? null;
      decodedClientEmail = parsed.client_email ?? null;
      decodedKeyId = parsed.private_key_id ?? null;
    } catch (e) {
      decodeError = e instanceof Error ? e.message : String(e);
    }
  }

  // --- try a tiny Firestore read to prove auth works ---
  try {
    const { adminDb } = await import('@/lib/firebaseAdmin');
    await adminDb.collection('__healthcheck').limit(1).get();

    return NextResponse.json(
      {
        ok: true,
        env,
        decoded: { decodedProjectId, decodedClientEmail, decodedKeyId, decodeError },
        firestoreOk: true,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        env,
        decoded: { decodedProjectId, decodedClientEmail, decodedKeyId, decodeError },
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}