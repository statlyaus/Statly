// src/app/api/csp-report/route.ts
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';

export const runtime = 'nodejs'; // ensure it runs on the server

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let payload: any = null;

    if (contentType.includes('application/reports+json')) {
      // W3C Reporting API batched format
      payload = await req.json();
    } else if (contentType.includes('application/csp-report')) {
      // Legacy CSP report format
      payload = await req.json();
    } else {
      // Attempt JSON parse anyway
      try {
        payload = await req.json();
      } catch {
        payload = { raw: await req.text() };
      }
    }

    // Log CSP violations
    logger.warn('CSP violation reported', { payload });

    return NextResponse.json({ ok: true });
  } catch (_err) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

export function GET() {
  // Help sanity-check during setup
  return NextResponse.json({ ok: true, message: 'CSP report endpoint ready' });
}
