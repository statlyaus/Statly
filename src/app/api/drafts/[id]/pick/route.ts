import type { NextRequest } from 'next/server';
import { handlePickCommand } from '@/server/draft/api/handlePickCommand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handlePickCommand(request, params);
}
