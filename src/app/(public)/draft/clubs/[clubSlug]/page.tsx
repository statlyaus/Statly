import { notFound } from 'next/navigation';

import {
  DraftClubTradeHistory,
  type DraftClubTradeStatlyValues,
} from '@/components/draft/DraftClubTradeHistory';
import { listDraftTradeRefsByClub } from '@/lib/draftTrades/read';
import { AFL_TRADE_PUBLIC_VALUE_SCOPE } from '@/server/aflTradeIntelligence/publication/prePublicationValueReadService';
import { getPublicAflTradeReadRuntime } from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';

export const dynamic = 'force-dynamic';

export default async function DraftClubDetailPage({
  params,
}: {
  params: Promise<{ clubSlug: string }>;
}) {
  const { clubSlug } = await params;
  const normalizedClubSlug = clubSlug.trim().toLowerCase();
  if (!normalizedClubSlug) {
    notFound();
  }

  const refs = await listDraftTradeRefsByClub(normalizedClubSlug);
  if (refs.length === 0) {
    notFound();
  }

  const clubName = refs[0]?.clubName ?? normalizedClubSlug;
  const exportYear = refs[0]?.year ?? null;
  const runtime = await getPublicAflTradeReadRuntime();
  const tradeIds = refs.map(({ tradeId }) => tradeId);
  const statlyValuesByTradeId: Record<string, DraftClubTradeStatlyValues> = {};

  for (let offset = 0; offset < tradeIds.length; offset += 100) {
    const tradeIdBatch = tradeIds.slice(offset, offset + 100);
    const [atTradeResponse, currentResponse] = await Promise.all([
      runtime.valueReadService.list({
        scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
        requestedView: 'at_trade',
        tradeIds: tradeIdBatch,
        limit: tradeIdBatch.length,
        cursor: null,
      }),
      runtime.valueReadService.list({
        scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
        requestedView: 'current',
        tradeIds: tradeIdBatch,
        limit: tradeIdBatch.length,
        cursor: null,
      }),
    ]);
    const currentByTradeId = new Map(
      currentResponse.items.map((item) => [item.tradeId, item.valuation])
    );
    for (const item of atTradeResponse.items) {
      const current = currentByTradeId.get(item.tradeId);
      if (current) {
        statlyValuesByTradeId[item.tradeId] = { atTrade: item.valuation, current };
      }
    }
  }

  return (
    <DraftClubTradeHistory
      clubSlug={normalizedClubSlug}
      clubName={clubName}
      refs={refs}
      exportYear={exportYear}
      statlyValuesByTradeId={statlyValuesByTradeId}
    />
  );
}
