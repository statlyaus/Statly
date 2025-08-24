import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; id2: string; userId: string }> }) {
  const { id, id2, userId } = await params;
  return NextResponse.json(
    { success: false, error: 'Not implemented', route: { id, id2, userId } },
    { status: 501 }
  );
}
