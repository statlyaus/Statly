import { notFound } from 'next/navigation';

import { DraftTradeDetail } from '@/components/draft/DraftTradeDetail';
import { getDraftTradeById } from '@/lib/draftTrades/read';
import { AFL_TRADE_PUBLIC_VALUE_SCOPE } from '@/server/aflTradeIntelligence/publication/publicationReadContracts';
import { parseAflTradePublicRouteParam } from '@/server/aflTradeIntelligence/runtime/publicTradeRouteParam';
import { getPublicAflTradeReadRuntime } from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';
import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

export const dynamic = 'force-dynamic';

export default async function DraftTradeDetailPage({
  params,
}: {
  params: Promise<{ tradeId: string }>;
}) {
  const { tradeId: encodedTradeId } = await params;
  const tradeId = parseAflTradePublicRouteParam(encodedTradeId);
  if (tradeId === null) notFound();
  const detail = await getDraftTradeById(tradeId);
  if (!detail) {
    notFound();
  }
  const runtime = await getPublicAflTradeReadRuntime();
  const [valueAnalysis, atTradeResponse, currentResponse] = await Promise.all([
    runtime.valueReadService.detail({
      scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
      tradeId,
      requestedViews: [...AFL_TRADE_VALUATION_VIEWS],
    }),
    runtime.valueReadService.list({
      scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
      requestedView: 'at_trade',
      tradeIds: [tradeId],
      limit: 1,
      cursor: null,
    }),
    runtime.valueReadService.list({
      scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
      requestedView: 'current',
      tradeIds: [tradeId],
      limit: 1,
      cursor: null,
    }),
  ]);
  const atTrade = atTradeResponse.items.find((item) => item.tradeId === tradeId)?.valuation;
  const current = currentResponse.items.find((item) => item.tradeId === tradeId)?.valuation;
  const statlyValues = atTrade && current ? { atTrade, current } : null;

  return (
    <DraftTradeDetail detail={detail} valueAnalysis={valueAnalysis} statlyValues={statlyValues} />
  );
}
