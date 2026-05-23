import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { commonErrors } from '@/lib/apiResponse';
import { listDraftTradesByYear } from '@/lib/draftTrades/firestore';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100),
  club: z.string().trim().toLowerCase().min(1).optional(),
  type: z.enum(['player', 'pick', 'future_pick']).optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      year: url.searchParams.get('year'),
      club: url.searchParams.get('club') ?? undefined,
      type: url.searchParams.get('type') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
    });
    if (!parsed.success) {
      return commonErrors.badRequest('Invalid export query');
    }

    const trades = await listDraftTradesByYear(parsed.data.year, {
      clubSlug: parsed.data.club,
      type: parsed.data.type,
      q: parsed.data.q,
    });

    const lines = [
      [
        'tradeId',
        'year',
        'seqInYear',
        'title',
        'clubNames',
        'partyCount',
        'assetCount',
        'hasPlayers',
        'hasPicks',
        'hasFuturePicks',
      ].join(','),
      ...trades.map((trade) =>
        [
          csvEscape(trade.tradeId),
          csvEscape(trade.year),
          csvEscape(trade.seqInYear),
          csvEscape(trade.title),
          csvEscape(trade.clubNames.join(' | ')),
          csvEscape(trade.partyCount),
          csvEscape(trade.assetCount),
          csvEscape(trade.hasPlayers),
          csvEscape(trade.hasPicks),
          csvEscape(trade.hasFuturePicks),
        ].join(',')
      ),
    ];

    const filename = `draft-trades-${parsed.data.year}.csv`;
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error('Failed to export draft trades CSV', error);
    return commonErrors.internalServerError('Failed to export draft trades');
  }
}
