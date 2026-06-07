import type { NextRequest } from 'next/server';

import { handlePickCommand } from '@/server/draft/api/handlePickCommand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return handlePickCommand(request, context.params);
}
