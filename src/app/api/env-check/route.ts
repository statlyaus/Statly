import { NextResponse } from 'next/server';

import { authorizeLocalOnlyRequest } from '@/lib/operationalAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const authorization = authorizeLocalOnlyRequest();
  if (!authorization.ok) return authorization.response;

  // Only return non-sensitive info and presence flags
  const nodeEnv = process.env.NODE_ENV || 'development';

  const serverVars = {
    APP_BASE_URL: process.env.APP_BASE_URL || null,
    APP_ORIGIN: process.env.APP_ORIGIN || null,
    SOCKETIO_PORT: process.env.SOCKETIO_PORT || null,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || null,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || null,
    NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL || null,
  } as const;

  const flags = {
    hasFirebaseBase64: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim()),
    hasFirebaseProjectId: Boolean(process.env.FIREBASE_PROJECT_ID),
    hasFirebaseClientEmail: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
    hasFirebasePrivateKey: Boolean(process.env.FIREBASE_PRIVATE_KEY),
  } as const;

  return NextResponse.json(
    {
      ok: true,
      nodeEnv,
      serverVars,
      flags,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
