import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { privateLocalWorkbookReads } from '@/server/aflTradeIntelligence/development/privateLocalWorkbookReads';
import { parseAflTradePublicRouteParam } from '@/server/aflTradeIntelligence/runtime/publicTradeRouteParam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  const tradeId = parseAflTradePublicRouteParam((await params).tradeId);
  if (tradeId === null) {
    return new NextResponse(null, { status: 400, headers: privateHeaders });
  }

  try {
    const result = await privateLocalWorkbookReads.loadExactJsonExport(tradeId);
    if (result === null || result.state !== 'available') {
      return new NextResponse(null, { status: 404, headers: privateHeaders });
    }

    const filenameTradeId = tradeId.replaceAll(/[^a-zA-Z0-9._-]/gu, '-');
    return new NextResponse(Uint8Array.from(result.bytes).buffer, {
      status: 200,
      headers: {
        ...privateHeaders,
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filenameTradeId}-exact-evidence.json"`,
        'X-Content-Type-Options': 'nosniff',
        'X-Statly-Generation-Id': result.generationId,
        'X-Statly-Projection-Manifest-Id': result.projectionManifestId,
      },
    });
  } catch (error) {
    logger.error('Failed to read authenticated private trade evaluation export', error);
    return new NextResponse(null, { status: 500, headers: privateHeaders });
  }
}
