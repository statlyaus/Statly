import { notFound } from 'next/navigation';

import { DraftTradeDetail } from '@/components/draft/DraftTradeDetail';
import { getDraftTradeById } from '@/lib/draftTrades/firestore';
import {
  AFL_TRADE_PUBLIC_VALUE_SCOPE,
  aflTradePrePublicationValueReadService,
} from '@/server/aflTradeIntelligence/publication/prePublicationValueReadService';
import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

export const dynamic = 'force-dynamic';

export default async function DraftTradeDetailPage({
  params,
}: {
  params: Promise<{ tradeId: string }>;
}) {
  const { tradeId } = await params;
  const detail = await getDraftTradeById(tradeId);
  if (!detail) {
    notFound();
  }
  const valueAnalysis = await aflTradePrePublicationValueReadService.detail({
    scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
    tradeId,
    requestedViews: [...AFL_TRADE_VALUATION_VIEWS],
  });

  return <DraftTradeDetail detail={detail} valueAnalysis={valueAnalysis} />;
}
