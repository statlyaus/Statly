import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { commonErrors } from '@/lib/apiResponse';
import { getDraftTradeById } from '@/lib/draftTrades/firestore';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  tradeId: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
});

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      return commonErrors.badRequest('Invalid trade id');
    }

    const detail = await getDraftTradeById(parsed.data.tradeId);
    if (!detail) {
      return commonErrors.notFound('Trade not found');
    }

    const partyHeader = 'section,club,rowOrder,assetsRaw,expected,actual';
    const partyLines = detail.parties.map((party) =>
      [
        'party',
        csvEscape(party.clubName),
        csvEscape(party.rowOrder),
        csvEscape(party.assetsRaw),
        csvEscape(party.expected),
        csvEscape(party.actual),
      ].join(',')
    );

    const assetHeader = 'section,club,assetIndex,assetType,assetText,playerOrDrafted,games';
    const assetLines = detail.assets.map((asset) =>
      [
        'asset',
        csvEscape(asset.clubName),
        csvEscape(asset.assetIndex),
        csvEscape(asset.assetType),
        csvEscape(asset.assetText),
        csvEscape(asset.playerName ?? asset.draftedPlayer),
        csvEscape(asset.games),
      ].join(',')
    );

    const lines = [
      `tradeId,${csvEscape(detail.trade.tradeId)}`,
      `title,${csvEscape(detail.trade.title)}`,
      `year,${csvEscape(detail.trade.year)}`,
      `seqInYear,${csvEscape(detail.trade.seqInYear)}`,
      '',
      partyHeader,
      ...partyLines,
      '',
      assetHeader,
      ...assetLines,
    ];

    const filename = `draft-trade-${detail.trade.tradeId}.csv`;
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error('Failed to export draft trade detail CSV', error);
    return commonErrors.internalServerError('Failed to export draft trade detail');
  }
}
