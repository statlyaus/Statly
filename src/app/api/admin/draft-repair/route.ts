import { NextResponse, type NextRequest } from 'next/server';

import { z } from 'zod';

import { DRAFT_REPAIR_EVENT, inngest } from '@/lib/inngest/client';

export const runtime = 'nodejs';

const bodySchema = z.object({
  draftId: z.string().min(1),
  leagueId: z.string().min(1),
  season: z.number().int().min(2020).max(2035),
});

function isAuthorized(request: NextRequest): boolean {
  const configuredToken = process.env.ADMIN_API_TOKEN?.trim() || process.env.CRON_SECRET?.trim();
  if (configuredToken) {
    return request.headers.get('x-admin-token') === configuredToken;
  }

  return process.env.NODE_ENV !== 'production';
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const rawBody = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = {
    ...parsed.data,
    requestedAt: new Date().toISOString(),
  };

  await inngest.send({
    name: DRAFT_REPAIR_EVENT,
    data,
  });

  return NextResponse.json({
    success: true,
    queued: true,
    event: {
      name: DRAFT_REPAIR_EVENT,
      data,
    },
  });
}
