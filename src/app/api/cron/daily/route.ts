import { NextResponse, type NextRequest } from "next/server";

// Daily cron endpoint triggered by Vercel (see vercel.json)
// - Runs on Node.js runtime so firebase-admin and other Node libs work
// - Optional protection via CRON_SECRET env var; pass ?token=... from Vercel
export const runtime = "nodejs";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const started = Date.now();

  // Optional: simple token auth via query param
  const token = req.nextUrl.searchParams.get("token");
  if (CRON_SECRET && token !== CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    // 👉 Put your daily job logic here (refresh stats, cleanup, reports, etc.)
    // Example:
    // const { db } = await import('@/lib/firebaseAdmin');
    // await db.collection('jobs').add({ job: 'daily', ranAt: Date.now() });

    const ranAt = new Date().toISOString();
    const durationMs = Date.now() - started;
    console.log("[CRON] Daily job ran", { ranAt, durationMs });

    return NextResponse.json(
      { ok: true, ranAt, durationMs },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isProd = process.env.NODE_ENV === "production";
    const errorLog: Record<string, unknown> = { message };
    if (!isProd && err instanceof Error && err.stack) {
      errorLog.stack = err.stack;
    }
    // Log details server-side; stack only in non-production
    console.error("[CRON] Daily job failed", errorLog);

    return NextResponse.json(
      { ok: false, error: message, ranAt: new Date().toISOString() },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
