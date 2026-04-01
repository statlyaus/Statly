import { type NextRequest, NextResponse } from 'next/server';

import { z } from 'zod';

import { importFootywireRounds } from '@/lib/footywireImporter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  season: z.number().int().min(2020).max(2035),
  rounds: z.array(z.number().int().min(0).max(40)).min(1),
  dryRun: z.boolean().optional().default(false),
});

function isAuthorized(request: NextRequest): boolean {
  const configuredToken = process.env.ETL_IMPORT_TOKEN?.trim();
  if (configuredToken) {
    return request.headers.get('x-etl-import-token') === configuredToken;
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

  const result = await importFootywireRounds(parsed.data);
  return NextResponse.json({ success: true, result });
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'POST { season, rounds, dryRun? } to import Footywire fixtures and player stats',
  });
}
