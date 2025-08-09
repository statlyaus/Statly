// src/app/api/admin-check/route.ts  (replace the file's GET with this)
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';

export async function GET() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || '';
  let decodedProjectId: string | null = null;
  let decodedClientEmail: string | null = null;
  let decodedKeyId: string | null = null;
  let decodeError: string | null = null;

  if (b64) {
    try {
      const json = Buffer.from(b64, 'base64').toString('utf-8');
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

  try {
    const { adminDb } = await import('@/lib/firebaseAdmin');
    await adminDb.collection('__healthcheck').limit(1).get();

    return NextResponse.json({
      ok: true,
      decoded: { decodedProjectId, decodedClientEmail, decodedKeyId, decodeError },
      firestoreOk: true,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        decoded: { decodedProjectId, decodedClientEmail, decodedKeyId, decodeError },
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}