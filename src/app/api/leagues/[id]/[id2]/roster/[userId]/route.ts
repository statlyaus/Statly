import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { TripleIdParams } from '@/types/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_req: NextRequest, { params }: TripleIdParams) {
  const { id, id2, userId } = params;
  return NextResponse.json(
    { success: false, error: 'Not implemented', route: { id, id2, userId } },
    { status: 501 }
  );
}
