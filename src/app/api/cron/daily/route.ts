import { NextResponse } from "next/server";

// Force Node.js runtime (not Edge) so firebase-admin works
export const runtime = "nodejs";

// Optional auth for Vercel cron: add CRON_SECRET in env and append ?token=... in vercel.json
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: Request) {
  // simple bearer via query token
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (CRON_SECRET && token !== CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    // 👉 TODO: your daily job logic here
    const ranAt = new Date().toISOString();
    console.log("[CRON] Daily job ran at", ranAt);
    return NextResponse.json({ ok: true, ranAt });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[CRON] Daily job failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
