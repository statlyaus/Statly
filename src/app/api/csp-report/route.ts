// src/app/api/csp-report/route.ts
import { NextResponse } from 'next/server';

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

    // Minimal logging. Replace with your logger or Sentry as desired.
    if (process.env.NODE_ENV !== 'production') {
       
      console.warn('[CSP REPORT]', JSON.stringify(payload));
    } else {
      // Hook in your prod pipeline here (e.g., send to a log sink / SIEM / Sentry)
      // logger.warn('csp_report', { payload });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

export function GET() {
  // Help sanity-check during setup
  return NextResponse.json({ ok: true, message: 'CSP report endpoint ready' });
}