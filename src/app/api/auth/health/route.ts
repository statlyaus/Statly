import { NextResponse } from 'next/server';
import admin from 'firebase-admin';
import { adminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    // Importing adminAuth ensures firebase-admin has been initialized via our wrapper
    void adminAuth;

    const initialized = admin.apps.length > 0;
    const projectId = initialized ? (admin.app().options.projectId as string | undefined) : undefined;

    return NextResponse.json(
      {
        ok: true,
        initialized,
        projectId: projectId ?? null,
        env: process.env.NODE_ENV,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
