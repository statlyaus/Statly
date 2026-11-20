import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

import { SHARE_CARD_SIZE, TradeShareCard } from '@/components/aflTradeStory/TradeShareCard';
import { tradeShareCardModel } from '@/components/aflTradeStory/shareCardModel';
import { publicTradeStoryReads } from '@/server/aflTradeIntelligence/publication/publicTradeStoryReads';

import { parseTradeRouteId } from '../../tradeRouteParams';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ tradeId: string }> };

// Shipped with the server function by `outputFileTracingIncludes` in next.config.mjs.
const FONT_DIR = join(process.cwd(), 'src', 'assets', 'fonts');
const FONTS = [
  { name: 'Geist', file: 'Geist-Bold.ttf', weight: 700 },
  { name: 'Geist', file: 'Geist-ExtraBold.ttf', weight: 800 },
  { name: 'Saira', file: 'Saira-Regular.ttf', weight: 400 },
] as const;

let fonts: ReturnType<typeof loadFonts> | null = null;

function loadFonts() {
  return Promise.all(
    FONTS.map(async ({ name, file, weight }) => ({
      name,
      data: await readFile(join(FONT_DIR, file)),
      weight,
      style: 'normal' as const,
    }))
  );
}

const notFound = () => new Response('Not found', { status: 404 });

/**
 * The share card image of one public trade (1200 × 630 PNG), linked from the trade page's Open Graph
 * and X tags. Only the owner-approved bundle is drawn. While the trades are unavailable it answers
 * 503 (the public pages' one-hour CDN rule still applies, as for the pages); an unknown trade is a 404.
 */
export async function GET(_request: Request, { params }: Params) {
  const tradeId = parseTradeRouteId((await params).tradeId);
  if (tradeId === null) return notFound();
  const read = await publicTradeStoryReads.loadStory(tradeId);
  if (!read.available)
    return new Response('AFL trades are unavailable', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  if (read.value === null) return notFound();
  fonts ??= loadFonts();
  try {
    return new ImageResponse(<TradeShareCard card={tradeShareCardModel(read.value)} />, {
      ...SHARE_CARD_SIZE,
      fonts: await fonts,
    });
  } catch (error) {
    fonts = null;
    throw error;
  }
}
