#!/usr/bin/env bash
set -euo pipefail

ROUTE_DIR="src/app/api/health/firebase"
ROUTE_FILE="${ROUTE_DIR}/route.ts"

mkdir -p "$ROUTE_DIR"

cat > "$ROUTE_FILE" <<'TS'
// Verify both Client and Admin Firebase wiring
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { clientApp } from '@/lib/firebaseClient';
import { db as adminDb } from '@/lib/firebaseAdmin';

export async function GET() {
  try {
    // Touch client app name (initializes client config in a server context safely)
    const clientName = clientApp.name;

    // Touch admin by reading a trivial value (e.g., list collections)
    // We won't actually make a network call; just ensure accessor exists.
    const adminProjectId = adminDb.parent?.projectId || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'unknown';

    return NextResponse.json({
      ok: true,
      clientApp: clientName,
      adminProjectId,
      hasServiceAccount: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64
        || (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
TS

echo "✅ Created ${ROUTE_FILE}"
echo "Hit: http://localhost:3000/api/health/firebase"
