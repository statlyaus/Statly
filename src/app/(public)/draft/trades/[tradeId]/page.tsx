import { notFound } from 'next/navigation';

import { DraftTradeDetail } from '@/components/draft/DraftTradeDetail';
import { getDraftTradeById } from '@/lib/draftTrades/firestore';

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

  return <DraftTradeDetail detail={detail} />;
}
